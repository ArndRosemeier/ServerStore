# How storage actually works — a one-page overview

For anyone who wants to know **where the bytes live** without reading the code. Not a contract:
`docs/API.md` is the client contract, `docs/DECISION-LEDGER.md` is why things are the way they are,
`docs/SEAM-INDEX.md` is where each idea lives in the source.

Rewritten for slice 17 (**ledger rows 78/79**): the per-item blob files this page used to describe
are **gone**, and every byte of an entry now lives in the database.

## The short answer

**ONE SQLite database file holds everything: the stores, the access keys, the key scopes, AND each
entry's bytes.** There is no file per entry and no `stores/` directory.

```
/home/administrator/serverstore-data/     ← the data root (SERVERSTORE_DATA_ROOT)
├── serverstore.db                        ← SQLite: stores, entries AND their bytes, keys, scopes
├── serverstore.db-wal                    ← the write-ahead log: the newest commits live HERE first
└── serverstore.db-shm                    ← the WAL index (transient, rebuilt on open)
```

So: **a store is a set of rows, and an entry is one row whose `content` column IS the bytes.** A
store with a thousand entries is a thousand rows and no extra files. The `-wal` and `-shm` sidecars
exist while the database is in WAL mode (which it always is — see Concurrency below); SQLite
checkpoints the WAL back into `serverstore.db` on a checkpoint or a clean close.

## What the database holds

| Table | What it is |
| --- | --- |
| `stores` | the store list: name, kind (`bytes` today) |
| `objects` | one row per ENTRY: `(store, name)`, the content **hash**, the size, the created-at — **and `content`, the bytes themselves** |
| `access_keys` | one row per key: id, label, permissions, hashed secret, timestamps |
| `key_stores` | which stores each key may touch (a key's scope) |
| `store_kinds` | the kinds the code knows how to serve |

`sha256`, `size` and `created_at` are exactly what they were before slice 17: `sha256` is still
computed from the bytes (now the bytes in hand rather than a file) and is still served as
`x-serverstore-sha256`. `content` is the only column this slice added.

Deleting the database loses **everything** — names, keys, scopes and content. There is no second
copy on disk and no content-addressed file that could survive it.

## What happens on each operation

- **Write an entry** (`PUT /stores/{store}/objects/{name}`): the sha256 is computed from the body,
  and ONE upsert writes the row — name, hash, size, timestamp and content together. An existing
  name is **replaced** (content included). One statement, so SQLite makes it atomic on its own.
- **Read**: the row's `content` is the answer, checked against the row's `size` before it is served;
  `x-serverstore-sha256` is the row's hash. A row whose content is missing or the wrong length is a
  **loud 500**, never empty bytes.
- **The same content twice**: two names written with identical bytes are **two independent rows**.
  Nothing is shared, so deleting or overwriting one can never affect the other.
- **Delete an entry**: the row goes — and the bytes go with it, because they are the same thing.
  There is no reference count and nothing to reclaim afterwards.
- **Empty a store**: every row of the store goes, and with them every byte.
- **Delete a store**: its object rows and its registry row go in ONE `BEGIN IMMEDIATE` transaction.
  A store that any key's scope names is refused `409` before any of that (see `docs/API.md`).
- **Overwrite an entry**: the upsert replaces the row and therefore the previous content. **Nothing
  is orphaned**, so there is no garbage collector and no `POST /gc` route — the orphan-file class
  that used to need one was removed with the files (ledger rows 70(e), 79).

## Concurrency: why a wait is the worst case, and why a crash cannot corrupt

The database is opened with four settings, and each one is pinned
(`tests/concurrency.test.ts`, **PIN Y4–Y7**):

| Setting | Value | Why |
| --- | --- | --- |
| `journal_mode` | `WAL` | A READER never blocks on a WRITER. Measured on this box: in rollback-journal mode a reader hit the writer's lock on ~22% of reads; in WAL on 0% (ledger row 77). |
| `busy_timeout` | `5000` ms (`BUSY_TIMEOUT_MS`, a named constant) | A second WRITER **queues** instead of failing `database is locked`. SQLite still serialises writers — one at a time — but the loser waits. |
| `synchronous` | `FULL` | The WAL is fsynced on every commit: corruption-safety over write speed, the trade the owner chose (ledger row 78). |
| Transactions | `BEGIN IMMEDIATE` | Every **multi-statement** mutation (minting a key writes the key row plus its scope rows; deleting a store writes the object rows plus the registry row; the boot import writes a store's rows) takes the write lock when it STARTS, through the ONE seam `withImmediateTransaction()` — the one case `busy_timeout` does not retry is a lock upgrade. |

**The honest boundary of the corruption claim**, written down rather than implied: with WAL +
`synchronous = FULL`, a crash (including a `SIGKILL`) cannot corrupt the database and cannot leave a
half-applied transaction — `PRAGMA integrity_check` returns `ok` and the uncommitted rows are absent
(PIN Y6). A **power loss** may at worst lose the newest committed transaction; it never leaves a torn
row. Two processes writing at once both complete with every committed row present (PIN Y4).

## Backing it up — the one rule that changed

**NEVER copy `serverstore.db` alone.** With WAL on, the newest committed transactions live in
`serverstore.db-wal` until SQLite checkpoints them; a copy of the main file without its sidecars can
silently lose the most recent writes. Two correct ways:

```bash
# 1. Stop the service and copy ALL THREE files together.
systemctl --user stop serverstore
cp /home/administrator/serverstore-data/serverstore.db      <dest>/
cp /home/administrator/serverstore-data/serverstore.db-wal  <dest>/ 2>/dev/null || true
cp /home/administrator/serverstore-data/serverstore.db-shm  <dest>/ 2>/dev/null || true
systemctl --user start serverstore

# 2. Or let SQLite write a consistent single-file snapshot, service running or not.
sqlite3 /home/administrator/serverstore-data/serverstore.db \
  "VACUUM INTO '/path/to/serverstore-backup.db'"
```

`VACUUM INTO` produces one self-contained file with the WAL already folded in — the right shape for
an off-box copy. Every backup must be taken **before** a boot that runs a migration (see below).

## The boot import: a pre-slice-17 data root migrates once, loudly

A data root written by the older code has rows in `objects` with no `content` and the bytes as
files at `<dataRoot>/stores/<store>/blobs/<sha[0:2]>/<sha>`. On the FIRST boot of this code
(`src/storage/migrate.ts`, called by `createApp` before any request is served):

1. it looks at each store that still has either pending rows or a directory;
2. in ONE `BEGIN IMMEDIATE` transaction **per store**, for every row with no content it reads the
   legacy file, **re-verifies that the bytes hash to the row's `sha256`**, and only then writes them
   into the row;
3. only after that store's transaction COMMITS does it remove the store's blob tree;
4. after every store, the empty `stores/` root is removed — and if anything unexplained is left
   under it, it **refuses to boot** rather than deleting files no row describes.

A missing file, a size mismatch or a hash mismatch **stops the boot loudly** — the store rolls back
and no file is deleted, so the data root is either fully migrated or fully untouched. The import is
idempotent: a row is pending only while its `content IS NULL`, so a second boot does nothing, and a
re-run after an interruption resumes where it stopped. **Take the backup before the first boot.**

## What is deliberately simple, and what that costs

- **Local disk only.** No object storage, no replication, no backup service. A backup is a copy of
  the database (all three files) or `VACUUM INTO` — see the rule above.
- **Single process.** One service instance owns the data root. SQLite serialises writers, so a
  second instance is not possible; the measured consequence is that two processes QUEUE (never
  corrupt), which is what the owner asked for.
- **No compression, no encryption at rest beyond what the filesystem gives you.** Content is stored
  exactly as sent.
- **No per-entry history.** Overwriting an entry replaces the row and its bytes; the old content is
  not a version you can get back.
- **The file only grows, and space is reused inside it.** A delete frees pages for the next write
  (SQLite's freelist) but does not shrink the file on disk; `VACUUM` is what returns space to the
  filesystem, and it needs free space roughly equal to the database.
- **Limits:** an entry's name is up to 1024 characters from `[a-z0-9][a-z0-9._-]`, and a single
  request body is capped by `SERVERSTORE_MAX_BYTES` (64 MiB by default) — a larger body is refused
  before anything is written. SQLite itself allows a single value up to 1,000,000,000 bytes
  (`MAX_LENGTH`), i.e. the service's own cap binds first by a wide margin.
  The name bound is ONE constant (`NAME_MAX_LENGTH`, ledger row 87b) and it is the SAME rule for
  store names, entry names, the `prefix=` filter and key ids — pinned by Z1–Z3, and by PIN Z6
  (the number appears once under `src/`). A future NON-SQLite backend must decide what to do about
  names longer than its own key limit: LMDB keys cap around 511 bytes, so a 1024-character name
  would not fit there — the constraint is named here rather than left in a ledger row.

## How far does this actually scale? (measured on this box, 2026-09-28)

Read from the engine rather than from folklore — `node -e` against `node:sqlite` on this box:

| Limit | Value here | Does it bind? |
| --- | --- | --- |
| SQLite version | **3.53.4** (bundled with Node 24) | — |
| Page size | **4096 bytes** | — |
| `MAX_PAGE_COUNT` | **0xfffffffe** (4,294,967,294 pages) | The database file can reach **~16 TiB** before SQLite refuses a write; disk space binds long before this |
| `MAX_LENGTH` (one value) | **1,000,000,000 bytes** | No: the service caps a body at 64 MiB |
| `MAX_VARIABLE_NUMBER` | **32,766** | No: no statement binds more than a handful of parameters |

**The first wall a real workload hits is not the engine, it is THIS SERVICE:** `GET
/stores/{store}/objects` has **no pagination** (only the `prefix=` filter), so a store with a
million entries means a million-row JSON answer. The listing projects names and metadata only —
`content` is never selected by a listing — so the bytes are not in that response, but the row count
is. That is a limit of the API, recorded as debt (rows 28/61), and the fix is `limit=`/pagination.

The old page's filesystem analysis (inodes, 4 KiB blocks, directory fan-out) is **obsolete**: there
are no per-entry files to run out of. The data root shares one filesystem with the operating system,
so the service's real share is still smaller than the numbers above.

## Where this lives in the code

- `src/core/db.ts` — the schema (including `objects.content`), the pragmas, the add-if-absent
  migrations, and `withImmediateTransaction()`, the ONE transaction seam.
- `src/storage/kinds.ts` — the per-kind dispatch point and the `bytes` handler: every statement
  against `objects` for the running service. Swapping the medium is one handler plus a migration.
- `src/storage/migrate.ts` — the ONE boot import; `src/storage/legacy-blobs.ts` — the ONLY code
  that still knows the old blob paths, read-only, called by nothing else.
- `src/server/config.ts` — `SERVERSTORE_DATA_ROOT` and `SERVERSTORE_MAX_BYTES`.
- `docs/DEPLOYMENT.md` — where the data root is, and the runbook around it.
