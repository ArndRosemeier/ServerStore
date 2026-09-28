# How storage actually works — a one-page overview

For anyone who wants to know **where the bytes live** without reading the code. Not a contract:
`docs/API.md` is the client contract, `docs/DECISION-LEDGER.md` is why things are the way they are,
`docs/SEAM-INDEX.md` is where each idea lives in the source.

## The short answer

**One database for all the names and metadata, plus one FILE PER ENTRY on disk.** Not one file per
store. The database says "store `colossus` has an entry called `game.x` whose content is the blob with
hash `9f3c…`", and the blob is a file whose NAME IS that hash.

```
/home/administrator/serverstore-data/          ← the data root (SERVERSTORE_DATA_ROOT)
├── serverstore.db                             ← SQLite: stores, entries, keys, key scopes
└── stores/
    └── colossus/                              ← one directory per store
        └── blobs/
            ├── 9f/                            ← sharded by the first 2 hex chars of the hash
            │   └── 9f3c1a…  (the bytes)       ← one file per distinct CONTENT, named by its sha256
            └── 0a/
                └── 0a77b2…
```

So: **a store is a directory of content-named files, and one database holds every name, every key and
every permission.** A store with a thousand entries has a thousand blob files (fewer if entries share
content — see below) and no per-store file of its own.

## What the database holds

| Table | What it is |
| --- | --- |
| `stores` | the store list: name, kind (`bytes` today) |
| `objects` | one row per ENTRY: `(store, name)` → content hash, size, created-at |
| `access_keys` | one row per key: id, label, permissions, hashed secret, timestamps |
| `key_stores` | which stores each key may touch (a key's scope) |
| `store_kinds` | the kinds the code knows how to serve |

The database holds **no content whatsoever** — only names pointing at content. Deleting the database
loses every name and key; deleting a blob file loses only that content, and any entry pointing at it
becomes a loud error rather than a silent empty value.

## What happens on each operation

- **Write an entry** (`PUT /stores/{store}/objects/{name}`): the bytes are written to a temp file in the
  same directory and then **renamed** into place, so a half-written file is never visible under a real
  hash; then the row is inserted (or updated, if the name already existed — an upsert).
- **Read**: the row gives the hash, the hash gives the path, and the file's size is checked against the
  row before anything is served.
- **The same content twice**: because the file is named after its content, storing identical bytes under
  two names in the SAME store creates **one** file that both entries point at. The same content in two
  different stores is two files (blobs are per store, so one store's data can never be reached from
  another).
- **Delete an entry**: the row goes, and its file goes **only if no other entry in that store still
  points at the same content** — otherwise the shared file must stay for the survivor.
- **Empty a store / delete a store**: every row goes and the store's bytes go with them.

## What is deliberately simple, and what that costs

- **Local disk only.** No object storage, no replication, no backup service. A backup means copying the
  data root — and honestly: copy it while the service is stopped, or copy the database with SQLite's own
  backup mechanism, because a plain copy of a database that is being written can be torn.
- **Single process.** One service instance owns the data root; nothing coordinates two writers.
- **No compression, no encryption at rest beyond what the filesystem gives you.** Content is stored
  exactly as sent.
- **No per-entry history.** Overwriting an entry replaces the row; the old content is not a version you
  can get back.
- **Limits:** an entry's name is up to 64 characters from `[a-z0-9][a-z0-9._-]`, and a single request
  body is capped by `SERVERSTORE_MAX_BYTES` (64 MiB by default) — a larger body is refused before
  anything is written.

## How far does "one file per entry" actually scale? (measured on this box, 2026-09-28)

The filesystem under the data root is **ext4 on `/dev/vda1`** (mounted with `discard`,
`errors=remount-ro`, `commit=30`). Its relevant limits, read from the filesystem itself and not from
folklore:

| Limit | Value here | Does it bind? |
| --- | --- | --- |
| **Free inodes** (one per file — the classic wall) | **73,783,154 free** of 75,138,560 (2% used) | Yes, at roughly **73 million entries** |
| Free space | **505 GiB** | Yes: each entry takes whole 4 KiB blocks, so it binds first once the average entry exceeds ~7 KiB |
| Name component length | 255 bytes | No — a blob file is named by a 64-character hash; entry NAMES never become filenames |
| Path length | 4096 bytes | No — the deepest path here is ~60 characters |
| Open files per process | 524,288 (the service's own limit) | No — one file is open per in-flight request, not per stored entry |
| Directories per store | 256 shards (`blobs/<first 2 hex chars>/`) | No, and it is deliberate: at 73M entries a shard holds ~288k files |
| Files in ONE directory | ext4 with `dir_index` (htree; **no** `large_dir`) | Not for us: 256-way sharding keeps every directory far below the ~10M-entry point where htree lookups degrade |

**What that means in practice.** The binding factor is the **average size of an entry**, because ext4
allocates whole 4 KiB blocks and one inode per file:

- small entries (a few hundred bytes to 4 KiB): **~73 million entries**, capped by inodes;
- 16 KiB average entries: **~33 million entries**, capped by space;
- 256 KiB average entries: **~2 million entries**;
- the crossover — where space starts to bind before inodes — is an average entry of **~7 KiB**.

Two costs that arrive before either limit, and both are worth knowing:

1. **The API lists a whole store in one response.** `GET /stores/{store}/objects` has no pagination
   (only the `prefix=` filter), so a store with a million entries means a million-row JSON answer. That
   is a limit of THIS SERVICE, not of the filesystem, and it is the first wall a real workload hits —
   the fix is `limit=`/pagination, recorded as debt (rows 28/61).
2. **Millions of small files are slow to copy.** A backup of the data root is fine with `tar`/`rsync`
   but painful with a naive per-file copy, and a tool that *watches* files (inotify) is capped at
   193,750 watches here — nothing in the service watches them, but a monitoring tool might.

Also stated plainly: the data root shares one filesystem with the operating system and everything else
on this box, so the service's real share is smaller than the numbers above; and the store currently
uses 873 KB of it.

## State on this box (measured 2026-09-28, service live)

`/home/administrator/serverstore-data` — 2 stores (`master`, `colossus`), **175 entries**, 177 blob
files, 873 KB. The two extra files are leftovers from deletes/overwrites done **before** reclamation
existed: with content-addressed storage, an overwrite leaves the previous content's file behind, and
nothing sweeps those. Reclaiming on delete, on emptying a store and on deleting a store is what the
destructive-lifecycle slice (ledger row 71) adds; **a sweep for files orphaned by earlier overwrites is
still not built**, and on a store that is rewritten often that is the number to watch
(`du -sh <dataRoot>`).

## Where this lives in the code

- `src/core/db.ts` — the schema and the idempotent migrations; foreign keys are ON.
- `src/storage/fs.ts` — the ONLY place bytes touch the disk: paths, the atomic write, the read with a
  size check, and blob removal.
- `src/storage/kinds.ts` — the per-kind dispatch point: today one kind, `bytes`, whose entry is a blob
  plus a row. Adding a kind means adding a handler, not a second storage system.
- `src/server/config.ts` — `SERVERSTORE_DATA_ROOT` and `SERVERSTORE_MAX_BYTES`.
- `docs/DEPLOYMENT.md` — where the data root is, and the runbook around it.
