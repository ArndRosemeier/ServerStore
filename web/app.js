/**
 * The ServerStore admin console — ONE ES module, plain JavaScript, no build step.
 *
 * The key lives in THIS module's `key` variable for the life of the page. It is never
 * written to any browser store, a cookie, the address bar, session history or the
 * console, and a reload forgets it. (PIN U2 scans these SERVED bytes for every one of
 * those APIs; the header comment is scanned too, so it does not name them either.)
 *
 * Every request goes to this page's own origin, and every path below is a route the
 * API registers. (PIN U3 parses the path literals out of these served bytes and
 * compares them to `createApp(...).routes`.)
 *
 * THE DESTRUCTIVE FLOWS (ledger row 81) have exactly TWO confirmation weights, and
 * they are different on purpose because the API's own blast radius is different:
 *
 *   - deleting ONE key or ONE entry needs a plain inline two-step (`armGuard`), because
 *     the API has no token for them;
 *   - emptying or deleting a WHOLE STORE needs the store name TYPED into a field that
 *     is NEVER pre-filled, and the typed text is what travels as the server's
 *     `?confirm=` token (`armTypedConfirm`). A mismatch is refused HERE, before any
 *     request is sent.
 *
 * A blocked store delete is DISPLAYED and never worked around: the `409` names the
 * blocking keys in its message, that message is rendered verbatim, and nothing is
 * parsed out of it and nothing is auto-deleted.
 */

/** The API paths this console calls. Path literals ONLY here, so PIN U3 can read them. */
const ROUTES = {
  whoami: "/whoami",
  stores: "/stores",
  keys: "/keys",
  // ONE path for the two methods on a key: `PATCH` edits it, `DELETE` removes it.
  key: (id) => `/keys/${encodeURIComponent(id)}`,
  keyRevoke: (id) => `/keys/${encodeURIComponent(id)}/revoke`,
  // ONE path for the two methods on a store's entries collection: `GET` lists them
  // (optionally narrowed by `prefix=`), `DELETE` empties the store.
  storeObjects: (store) => `/stores/${encodeURIComponent(store)}/objects`,
  storeObject: (store, name) =>
    `/stores/${encodeURIComponent(store)}/objects/${encodeURIComponent(name)}`,
  store: (store) => `/stores/${encodeURIComponent(store)}`,
};

/** The API's canonical permission order. */
const PERMISSIONS = ["read", "write", "delete", "admin"];

/** read + write are on by default; delete and admin are opt-in (ledger row 30). */
const DEFAULT_PERMISSIONS = ["read", "write"];

// THE key: a module variable, and nothing else. `null` means "no key entered".
let key = null;

// The /whoami answer for that key, or null while no key is proven.
let whoami = null;

// The stores last listed, and the label of every key last listed. The EDIT form reads
// `storeList` for its store checkboxes and `keyLabels` to render "changed … by <label>"
// from `updatedBy` — the id of the key that made the change (ledger row 52).
let storeList = [];
let keyLabels = {};

// Which store's entries are OPEN, and the prefix they were last fetched with. Both are
// memory only, like the key: nothing here is persisted anywhere. Entries are fetched
// ON DEMAND — when a store is opened or refreshed, never for every store on every
// `refreshAll()` (ledger row 81(c)) — and the prefix narrows the query SERVER-side.
let openStore = null;
let openPrefix = "";

/** One API failure, carrying the API's own error code when there is one. */
class UiError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "UiError";
    this.code = code;
  }
}

const $ = (id) => document.getElementById(id);

/** The ONLY place the key variable is assigned. */
function setKey(value) {
  key = value;
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function codeOf(error) {
  return error instanceof UiError ? error.code : "ui_error";
}

/**
 * Add query parameters to a path.
 *
 * The path literals stay TEMPLATE HOLES in `ROUTES` and the query is appended HERE, so
 * PIN U3 reads a registered route shape and never a `…/objects?prefix=:id` string it
 * could not match. An empty/absent value is OMITTED rather than sent: the API refuses a
 * present-but-empty `prefix=` loudly (400 `invalid_name`, ledger row 61), and a
 * present-but-empty token would be a request this console should never make.
 */
function withQuery(path, params) {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    query.set(name, String(value));
  }
  const rendered = query.toString();
  return rendered === "" ? path : path + "?" + rendered;
}

/** The listing path for `store`, narrowed SERVER-side when a prefix is present. */
function entriesPath(store, prefix) {
  return withQuery(ROUTES.storeObjects(store), { prefix });
}

/**
 * One request to this origin. The key travels in the `Authorization` header and
 * nowhere else. A non-2xx answer is turned into a UiError carrying the API's own
 * `{error:{code,message}}`, so no failure can pass silently.
 */
async function api(path, options = {}) {
  const headers = { accept: "application/json" };
  if (key !== null) headers.authorization = "Bearer " + key;
  if (options.body !== undefined) headers["content-type"] = "application/json";

  let response;
  try {
    response = await fetch(path, {
      method: options.method ?? "GET",
      headers,
      body: options.body,
    });
  } catch (cause) {
    throw new UiError("network", "the request could not be sent: " + cause.message);
  }

  const text = await response.text();
  let payload = null;
  if (text !== "") {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new UiError("bad_response", "the server answered with non-JSON (HTTP " + response.status + ")");
    }
  }

  if (!response.ok) {
    const error = payload !== null && typeof payload === "object" ? payload.error : null;
    if (error !== null && error !== undefined) {
      throw new UiError(String(error.code), String(error.message));
    }
    throw new UiError("http_" + response.status, "the server answered HTTP " + response.status);
  }
  return payload;
}

function showError(error) {
  const code = error instanceof UiError ? error.code : "ui_error";
  const message = error instanceof Error ? error.message : String(error);
  const box = $("error");
  box.textContent = code + ": " + message;
  box.hidden = false;
}

function clearError() {
  const box = $("error");
  box.textContent = "";
  box.hidden = true;
}

function showStatus(message) {
  const box = $("status");
  box.textContent = message;
  box.hidden = false;
}

function clearStatus() {
  const box = $("status");
  box.textContent = "";
  box.hidden = true;
}

/** Run one loader, surfacing ITS failure without skipping the others. */
async function guard(loader) {
  try {
    await loader();
  } catch (error) {
    showError(error);
  }
}

/**
 * THE outcome path of every destructive attempt.
 *
 * The affected pane is refreshed FIRST and the outcome is stated on the console's ONE
 * surface afterwards, so a row that is gone can never be left on screen looking like a
 * success, and a successful action whose refresh failed says so instead of quietly
 * showing a stale list. The action's own error is never replaced by a refresh error:
 * they are combined into the one message.
 */
async function finishDestructive(refresh, error, successMessage) {
  let refreshError = null;
  try {
    await refresh();
  } catch (caught) {
    refreshError = caught;
  }
  if (error !== null) {
    showError(
      refreshError === null
        ? error
        : new UiError(
            codeOf(error),
            messageOf(error) + " (and the list could not be refreshed: " + messageOf(refreshError) + ")",
          ),
    );
    return;
  }
  if (refreshError !== null) {
    showError(
      new UiError(
        "refresh_failed",
        "the change was applied, but the list could not be refreshed: " + messageOf(refreshError),
      ),
    );
    return;
  }
  showStatus(successMessage);
}

function renderSession() {
  const session = $("session");
  const forget = $("forget");
  const app = $("app");
  if (whoami === null) {
    session.textContent = "No key entered. Nothing is fetched until a key is proven with whoami.";
    forget.hidden = true;
    app.hidden = true;
    return;
  }
  session.textContent =
    "key " +
    whoami.id +
    " — label " +
    whoami.label +
    " — stores " +
    whoami.stores.join(", ") +
    " — permissions " +
    whoami.perms.join(", ");
  forget.hidden = false;
  app.hidden = false;
}

async function proveKey(event) {
  event.preventDefault();
  clearError();
  clearStatus();
  const input = $("key-input");
  const value = input.value.trim();
  if (value === "") {
    showError(new UiError("no_key", "enter a key first"));
    return;
  }
  setKey(value);
  try {
    whoami = await api(ROUTES.whoami);
  } catch (error) {
    setKey(null);
    whoami = null;
    renderSession();
    showError(error);
    return;
  }
  // The field's value is not a store, but there is no reason to leave the key sitting
  // in the DOM once the module variable holds it.
  input.value = "";
  renderSession();
  await refreshAll();
}

function forgetKey() {
  setKey(null);
  whoami = null;
  openStore = null;
  openPrefix = "";
  refreshEntries().catch(showError);
  $("key-input").value = "";
  $("minted-key").value = "";
  $("minted-panel").hidden = true;
  clearError();
  clearStatus();
  renderSession();
}

function selectedStores() {
  if ($("scope-all").checked) return ["*"];
  return Array.from(document.querySelectorAll('input[data-store="yes"]'))
    .filter((input) => input.checked)
    .map((input) => input.value);
}

function syncScope() {
  const all = $("scope-all").checked;
  for (const input of document.querySelectorAll('input[data-store="yes"]')) {
    input.disabled = all;
  }
  const admin = $("perm-admin");
  admin.disabled = !all;
  if (!all) admin.checked = false;
  $("scope-note").textContent = all
    ? "Scope: every store, including ones created later."
    : "Scope: the checked stores.";
  $("admin-note").textContent = all
    ? ""
    : "— admin is refused unless the scope is every store";
}

function renderStoreChoices(stores) {
  const box = $("store-choices");
  const previous = new Set(
    Array.from(document.querySelectorAll('input[data-store="yes"]'))
      .filter((input) => input.checked)
      .map((input) => input.value),
  );
  box.replaceChildren();
  for (const store of stores) {
    const label = document.createElement("label");
    label.className = "inline";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = store.name;
    input.setAttribute("data-store", "yes");
    input.checked = previous.has(store.name);
    label.append(input, document.createTextNode(" " + store.name));
    box.append(label);
  }
  syncScope();
}

/**
 * One store's row: what it is, and the three things this console may do to it.
 *
 * `Open` shows the store's entries below the list (fetched ON DEMAND); `Empty…` and
 * `Delete…` open the typed-name confirmation, which is the ONLY place a whole-store
 * destruction can be started from.
 */
function storeRow(store) {
  const item = document.createElement("li");
  item.setAttribute("data-store-row", store.name);

  const summary = document.createElement("span");
  summary.className = "store-summary";
  summary.textContent = store.name + " (" + store.kind + ")";

  const actions = document.createElement("span");
  actions.className = "actions";

  const open = document.createElement("button");
  open.type = "button";
  open.setAttribute("data-store-open", "yes");
  open.textContent = openStore === store.name ? "Close" : "Open";
  open.addEventListener("click", () => {
    toggleStore(store.name).catch(showError);
  });
  actions.append(open);

  const empty = document.createElement("button");
  empty.type = "button";
  empty.className = "danger";
  empty.setAttribute("data-store-action", "empty");
  empty.textContent = "Empty…";
  empty.addEventListener("click", () => {
    armTypedConfirm(item, store.name, "empty").catch(showError);
  });
  actions.append(empty);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "danger";
  remove.setAttribute("data-store-action", "delete");
  remove.textContent = "Delete…";
  remove.addEventListener("click", () => {
    armTypedConfirm(item, store.name, "delete").catch(showError);
  });
  actions.append(remove);

  item.append(summary, actions);
  return item;
}

async function refreshStores() {
  const payload = await api(ROUTES.stores);
  storeList = payload.stores;
  const list = $("stores");
  list.replaceChildren();
  for (const store of payload.stores) list.append(storeRow(store));
  renderStoreChoices(payload.stores);
  // The open store may have just been deleted: stop showing a pane for a store that is
  // no longer there BEFORE the pane is refreshed.
  if (openStore !== null && !payload.stores.some((store) => store.name === openStore)) {
    openStore = null;
    openPrefix = "";
  }
  await refreshEntries();
}

/** Open/close one store's entries pane. Opening starts from NO prefix. */
async function toggleStore(name) {
  openStore = openStore === name ? null : name;
  openPrefix = "";
  await refreshStores();
}

/** A compact rendering of a content address: enough to compare, not a wall of hex. */
function abbreviateSha(sha) {
  return sha.slice(0, 12) + "…";
}

/** ONE entry's row: its NAME, its size/created time, its abbreviated hash, and Delete. */
function entryRow(entry, storeName) {
  const item = document.createElement("li");
  item.setAttribute("data-entry-row", entry.name);

  const name = document.createElement("span");
  name.className = "entry-name";
  name.textContent = entry.name;

  const meta = document.createElement("span");
  meta.className = "muted entry-meta";
  meta.textContent =
    entry.size +
    " bytes — created " +
    entry.createdAt +
    " — sha256 " +
    abbreviateSha(entry.sha256);

  const actions = document.createElement("span");
  actions.className = "actions";
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "danger";
  remove.textContent = "Delete";
  armGuard(remove, {
    question: 'Delete the entry "' + entry.name + '" from ' + storeName + "?",
    confirmLabel: "Confirm delete",
    onConfirm: () => deleteEntry(storeName, entry.name),
  });
  actions.append(remove);

  item.append(name, meta, actions);
  return item;
}

/**
 * Fetch and render the OPEN store's entries, narrowed SERVER-side by `openPrefix`.
 *
 * The whole store is NEVER shipped to the browser to be filtered here: the request
 * carries `prefix=` and the API does the narrowing (ledger row 61, the point of the
 * slice). An empty prefix means "no filter" and the parameter is omitted entirely.
 */
async function refreshEntries() {
  const pane = $("entries");
  if (openStore === null) {
    pane.hidden = true;
    pane.replaceChildren();
    return;
  }
  const storeName = openStore;

  const heading = document.createElement("h3");
  heading.textContent = "Entries — " + storeName;

  const form = document.createElement("form");
  form.autocomplete = "off";
  form.className = "row";
  const label = document.createElement("label");
  label.textContent = "Prefix (narrows the query on the server)";
  const input = document.createElement("input");
  input.type = "text";
  input.setAttribute("data-prefix", "yes");
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = "e.g. room-";
  input.value = openPrefix;
  label.append(input);
  const filter = document.createElement("button");
  filter.type = "submit";
  filter.className = "primary";
  filter.textContent = "Filter";
  const clear = document.createElement("button");
  clear.type = "button";
  clear.textContent = "Clear";
  clear.addEventListener("click", () => {
    openPrefix = "";
    input.value = "";
    refreshEntries().catch(showError);
  });
  form.append(label, filter, clear);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    openPrefix = input.value.trim();
    refreshEntries().catch(showError);
  });

  const count = document.createElement("p");
  count.className = "muted";
  count.setAttribute("data-entry-count", "yes");
  const list = document.createElement("ul");
  list.className = "entry-list";

  pane.replaceChildren(heading, form, count, list);
  pane.hidden = false;

  const payload = await api(entriesPath(storeName, openPrefix));
  const objects = payload.objects;
  count.textContent =
    openPrefix === ""
      ? objects.length + (objects.length === 1 ? " entry" : " entries")
      : objects.length +
        " of " +
        storeName +
        "’s entries match the prefix " +
        JSON.stringify(openPrefix) +
        " (filtered by the server)";
  list.replaceChildren();
  if (objects.length === 0) {
    const none = document.createElement("li");
    none.className = "muted";
    none.textContent =
      openPrefix === "" ? "this store has no entries" : "no entry matches that prefix";
    list.append(none);
    return;
  }
  for (const entry of objects) list.append(entryRow(entry, storeName));
}

/**
 * "changed <when> by <label>" for one key — or "never changed".
 *
 * `updatedBy` is the id of the key that made the last change. It is resolved against
 * the keys already loaded; when the editor is not in this inventory (a scoped admin
 * sees only its own set) the raw ID is shown, so the audit line never becomes blank
 * and never claims a change came from nowhere. A key with no `updatedAt` has NEVER
 * been changed: it says so rather than inventing a date from `createdAt`.
 */
function changedLine(entry) {
  if (entry.updatedAt === null) return "never changed";
  const by = entry.updatedBy === null ? "an unknown key" : keyLabels[entry.updatedBy] ?? entry.updatedBy;
  return "changed " + entry.updatedAt + " by " + by;
}

/** One key's row: what it holds, when it last changed, and its Edit/Revoke/Delete. */
function keyRow(entry) {
  const item = document.createElement("li");

  const summary = document.createElement("span");
  summary.className = "key-summary";
  let text =
    entry.label +
    " — " +
    entry.prefix +
    " — stores " +
    entry.stores.join(", ") +
    " — permissions " +
    entry.perms.join(", ") +
    " — created " +
    entry.createdAt;
  if (entry.revokedAt !== null) text += " — REVOKED " + entry.revokedAt;
  summary.textContent = text;

  const changed = document.createElement("span");
  changed.className = "muted changed";
  changed.textContent = changedLine(entry);

  const actions = document.createElement("span");
  actions.className = "actions";

  const edit = document.createElement("button");
  edit.type = "button";
  edit.textContent = "Edit";
  if (entry.revokedAt !== null) {
    // A revoked key cannot be edited back to life: the API refuses it, so the console
    // does not offer it. (U1-U4 do not execute this; docs/TESTING.md says so.)
    edit.disabled = true;
    edit.title = "This key is revoked. Revocation cannot be undone — mint a new key instead.";
  } else {
    edit.addEventListener("click", () => {
      openEditor(item, entry).catch(showError);
    });
  }
  actions.append(edit);

  if (entry.revokedAt === null) {
    const revoke = document.createElement("button");
    revoke.type = "button";
    revoke.textContent = "Revoke";
    armGuard(revoke, {
      question: 'Revoke the key "' + entry.label + '"? This cannot be undone.',
      confirmLabel: "Confirm revoke",
      onConfirm: () => revokeKey(entry.id),
    });
    actions.append(revoke);
  }

  // DELETE, on EVERY row including a REVOKED one (ledger row 70(a)): this is the
  // owner's actual complaint — a revoked key still clutters the inventory. A key is one
  // item, so the API needs no token and the console's plain two-step is the guard; the
  // server still refuses the LAST live admin key with a `409` that is rendered verbatim.
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "danger";
  remove.setAttribute("data-key-delete", "yes");
  remove.textContent = "Delete";
  armGuard(remove, {
    question: 'Delete the key "' + entry.label + '" (' + entry.id + ")? This removes the row for good.",
    confirmLabel: "Confirm delete",
    onConfirm: () => deleteKey(entry),
  });
  actions.append(remove);

  item.append(summary, changed, actions);
  return item;
}

async function refreshKeys() {
  const payload = await api(ROUTES.keys);
  keyLabels = {};
  for (const entry of payload.keys) keyLabels[entry.id] = entry.label;
  const list = $("keys");
  list.replaceChildren();
  for (const entry of payload.keys) list.append(keyRow(entry));
}

/**
 * Turn ONE row into its editor: rename, store checkboxes, permission toggles, Save and
 * Cancel. The key's VALUE is not here and cannot be: the console only ever edits what
 * the key HOLDS, and the API keeps the credential itself untouched (pin E6).
 */
function openEditor(item, entry) {
  item.classList.add("editing");
  const form = document.createElement("div");
  form.className = "edit-form";

  const heading = document.createElement("p");
  heading.className = "muted";
  heading.textContent =
    "Editing key " + entry.id + " (" + entry.prefix + ") — the key itself is not shown and cannot be changed, only what it holds.";
  form.append(heading);

  if (whoami !== null && entry.id === whoami.id) {
    const warning = document.createElement("p");
    warning.className = "warning inline-warning";
    warning.textContent =
      "This is the key you are using. Saving changes or removes the permissions this page runs on, and it takes effect immediately — a later call here may be refused.";
    form.append(warning);
  }

  const labelField = document.createElement("label");
  labelField.textContent = "Label (blank means “unlabelled”, exactly as at mint)";
  const labelInput = document.createElement("input");
  labelInput.type = "text";
  labelInput.value = entry.label;
  labelInput.setAttribute("data-edit-label", "yes");
  labelField.append(labelInput);
  form.append(labelField);

  const scope = document.createElement("fieldset");
  const scopeLegend = document.createElement("legend");
  scopeLegend.textContent = "Scope";
  scope.append(scopeLegend);

  const allLabel = document.createElement("label");
  allLabel.className = "inline";
  const allBox = document.createElement("input");
  allBox.type = "checkbox";
  allBox.setAttribute("data-scope-all", "yes");
  allBox.checked = entry.stores.length === 1 && entry.stores[0] === "*";
  allLabel.append(allBox, document.createTextNode(" Every store (master scope)"));
  scope.append(allLabel);

  const choices = document.createElement("div");
  choices.className = "choices";
  for (const store of storeList) {
    const storeLabel = document.createElement("label");
    storeLabel.className = "inline";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.value = store.name;
    box.setAttribute("data-edit-store", "yes");
    box.checked = entry.stores.includes(store.name);
    storeLabel.append(box, document.createTextNode(" " + store.name));
    choices.append(storeLabel);
  }
  scope.append(choices);
  const scopeNote = document.createElement("p");
  scopeNote.className = "muted";
  scope.append(scopeNote);
  form.append(scope);

  const perms = document.createElement("fieldset");
  const permsLegend = document.createElement("legend");
  permsLegend.textContent = "Permissions";
  perms.append(permsLegend);
  for (const permission of PERMISSIONS) {
    const permLabel = document.createElement("label");
    permLabel.className = "inline";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.value = permission;
    box.setAttribute("data-edit-perm", "yes");
    box.checked = entry.perms.includes(permission);
    permLabel.append(box, document.createTextNode(" " + permission));
    perms.append(permLabel);
  }
  const permNote = document.createElement("p");
  permNote.className = "muted";
  permNote.textContent =
    "admin is refused by the API unless the scope is every store; the refusal is shown here.";
  perms.append(permNote);
  form.append(perms);

  // `admin` is NOT force-unchecked when the scope is a named set (unlike the mint form):
  // an out-of-band store-scoped admin key keeps its `admin` through a rename, and a
  // checkbox that silently cleared it would strip a permission the operator never
  // touched. An invalid combination is refused by the API and rendered as an error.
  const sync = () => {
    const all = allBox.checked;
    for (const box of choices.querySelectorAll('input[data-edit-store="yes"]')) box.disabled = all;
    scopeNote.textContent = all
      ? "Scope: every store, including ones created later."
      : "Scope: the checked stores.";
  };
  allBox.addEventListener("change", sync);
  sync();

  const row = document.createElement("div");
  row.className = "row";
  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary";
  save.textContent = "Save";
  save.addEventListener("click", () => {
    saveEdit(entry.id, form).catch(showError);
  });
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => {
    refreshKeys().catch(showError);
  });
  row.append(save, cancel);
  form.append(row);

  item.replaceChildren(form);
}

/** Read the editor's fields, validate them locally, and PATCH the key. */
async function saveEdit(id, form) {
  clearError();
  clearStatus();
  // The label is always sent, blank included: the API's rule (a blank label means
  // "unlabelled", exactly as at mint) is applied rather than silently keeping the old
  // label when the operator cleared the field.
  const body = { label: form.querySelector('input[data-edit-label="yes"]').value.trim() };
  body.stores = form.querySelector('input[data-scope-all="yes"]').checked
    ? ["*"]
    : Array.from(form.querySelectorAll('input[data-edit-store="yes"]'))
        .filter((input) => input.checked)
        .map((input) => input.value);
  body.perms = PERMISSIONS.filter(
    (permission) =>
      form.querySelector('input[data-edit-perm="yes"][value="' + permission + '"]').checked,
  );
  if (body.stores.length === 0) {
    showError(new UiError("no_stores", "check at least one store, or every store"));
    return;
  }
  if (body.perms.length === 0) {
    showError(new UiError("no_perms", "check at least one permission"));
    return;
  }
  await api(ROUTES.key(id), { method: "PATCH", body: JSON.stringify(body) });
  showStatus(
    "Key " + id + " updated. Its value is unchanged — whoever holds the key keeps using the same key.",
  );
  await guard(refreshKeys);
}

// --- the destructive actions -------------------------------------------------

/** Delete ONE key. A REVOKED key is deletable too — that is the owner's ask. */
async function deleteKey(entry) {
  clearError();
  clearStatus();
  let error = null;
  try {
    await api(ROUTES.key(entry.id), { method: "DELETE" });
  } catch (caught) {
    error = caught;
  }
  await finishDestructive(
    refreshKeys,
    error,
    "Key " + entry.id + " deleted. Its credential is refused on its next request.",
  );
}

async function revokeKey(id) {
  clearError();
  clearStatus();
  await api(ROUTES.keyRevoke(id), { method: "POST" });
  showStatus("Key " + id + " revoked. It is refused on its next request.");
  await guard(refreshKeys);
}

/** Delete ONE entry from the open store. */
async function deleteEntry(storeName, name) {
  clearError();
  clearStatus();
  let error = null;
  try {
    await api(ROUTES.storeObject(storeName, name), { method: "DELETE" });
  } catch (caught) {
    error = caught;
  }
  await finishDestructive(refreshEntries, error, "Entry " + name + " deleted from " + storeName + ".");
}

/** Empty a whole store. `typed` is the name the operator typed, and it IS the token. */
async function emptyStore(storeName, typed) {
  clearError();
  clearStatus();
  let error = null;
  let outcome = null;
  try {
    outcome = await api(withQuery(ROUTES.storeObjects(storeName), { confirm: typed }), {
      method: "DELETE",
    });
  } catch (caught) {
    error = caught;
  }
  const deleted = outcome === null ? 0 : outcome.deleted;
  await finishDestructive(
    refreshStores,
    error,
    "Store " +
      storeName +
      " emptied — " +
      deleted +
      (deleted === 1 ? " entry deleted." : " entries deleted."),
  );
}

/** Delete a whole store. `typed` is the name the operator typed, and it IS the token. */
async function deleteStore(storeName, typed) {
  clearError();
  clearStatus();
  let error = null;
  try {
    await api(withQuery(ROUTES.store(storeName), { confirm: typed }), { method: "DELETE" });
  } catch (caught) {
    error = caught;
  }
  await finishDestructive(refreshStores, error, "Store " + storeName + " deleted.");
}

/**
 * The PRIVATE confirmation for a single item: an inline two-step, never a native dialog.
 *
 * Clicking the destructive button reveals one question and a Confirm/Cancel pair beside
 * it; nothing is sent until Confirm is clicked, and a second click cannot stack a second
 * question. This is the ONE place a one-item destruction is armed, for keys and entries
 * alike (the two whole-store actions use `armTypedConfirm`, a different weight on
 * purpose — ledger row 81(a)).
 */
function armGuard(button, options) {
  button.addEventListener("click", () => {
    const holder = button.parentElement;
    if (holder === null) {
      showError(new UiError("ui_error", "the destructive button has no row to confirm in"));
      return;
    }
    if (holder.querySelector(".confirm-row") !== null) return;
    const panel = document.createElement("span");
    panel.className = "confirm-row";
    panel.setAttribute("role", "group");
    const note = document.createElement("span");
    note.className = "danger-note";
    note.textContent = options.question;
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "danger";
    confirm.setAttribute("data-confirm", "yes");
    confirm.textContent = options.confirmLabel;
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => panel.remove());
    confirm.addEventListener("click", () => {
      panel.remove();
      options.onConfirm().catch(showError);
    });
    panel.append(note, confirm, cancel);
    holder.append(panel);
  });
}

/**
 * The CONFIRMATION FOR A WHOLE STORE: the store name TYPED into a never-prefilled field.
 *
 * The typed text — not a string this module already has — is what is sent as the
 * server's `?confirm=` token, and a mismatch is refused HERE with nothing sent. There is
 * no way to arm this from a stored value and no pre-filled field to submit blind.
 */
async function armTypedConfirm(item, storeName, kind) {
  const existing = item.querySelector(".typed-confirm");
  if (existing !== null) {
    existing.remove();
    return;
  }
  const verb = kind === "empty" ? "empty" : "delete";
  const box = document.createElement("form");
  box.className = "typed-confirm";
  box.autocomplete = "off";

  const note = document.createElement("p");
  note.className = "muted";
  note.textContent =
    "To " +
    verb +
    " " +
    storeName +
    ", type its name below. The typed text is sent to the server as the confirmation token.";

  const label = document.createElement("label");
  label.textContent = "Store name (type it exactly)";
  const input = document.createElement("input");
  input.type = "text";
  input.setAttribute("data-typed-confirm", "yes");
  input.autocomplete = "off";
  input.spellcheck = false;
  input.value = "";
  label.append(input);

  const row = document.createElement("div");
  row.className = "row";
  const go = document.createElement("button");
  go.type = "submit";
  go.className = "danger";
  go.setAttribute("data-typed-confirm-go", "yes");
  go.textContent = kind === "empty" ? "Empty store" : "Delete store";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => box.remove());
  row.append(go, cancel);

  box.append(note, label, row);
  box.addEventListener("submit", (event) => {
    event.preventDefault();
    const typed = input.value.trim();
    if (typed !== storeName) {
      showError(
        new UiError(
          "confirm_mismatch",
          "the typed name " +
            JSON.stringify(typed) +
            " does not match the store " +
            JSON.stringify(storeName) +
            " — nothing was sent.",
        ),
      );
      return;
    }
    box.remove();
    const action = kind === "empty" ? emptyStore(storeName, typed) : deleteStore(storeName, typed);
    action.catch(showError);
  });
  item.append(box);
}

async function refreshAll() {
  clearError();
  await guard(refreshStores);
  await guard(refreshKeys);
}

async function createStore(event) {
  event.preventDefault();
  clearError();
  clearStatus();
  const name = $("store-name").value.trim();
  if (name === "") {
    showError(new UiError("no_name", "enter a store name"));
    return;
  }
  try {
    await api(ROUTES.stores, { method: "POST", body: JSON.stringify({ name }) });
  } catch (error) {
    showError(error);
    return;
  }
  $("store-name").value = "";
  showStatus("Store " + name + " created.");
  await guard(refreshStores);
}

async function mintKey(event) {
  event.preventDefault();
  clearError();
  clearStatus();
  const stores = selectedStores();
  const perms = PERMISSIONS.filter((permission) => $("perm-" + permission).checked);
  if (stores.length === 0) {
    showError(new UiError("no_stores", "check at least one store"));
    return;
  }
  if (perms.length === 0) {
    showError(new UiError("no_perms", "check at least one permission"));
    return;
  }

  const body = { stores, perms };
  const label = $("label-input").value.trim();
  if (label !== "") body.label = label;
  const expires = $("expires-input").value;
  if (expires !== "") {
    const parsed = new Date(expires);
    if (Number.isNaN(parsed.getTime())) {
      showError(new UiError("bad_expiry", "the expiry is not a valid date and time"));
      return;
    }
    body.expiresAt = parsed.toISOString();
  }

  let minted;
  try {
    minted = await api(ROUTES.keys, { method: "POST", body: JSON.stringify(body) });
  } catch (error) {
    showError(error);
    return;
  }

  // THE one and only time this console ever sees the raw key.
  $("minted-key").value = minted.key;
  $("minted-warning").textContent =
    "Copy this key NOW. It is shown once and can never be shown again — the server " +
    "stores only its hash, so a lost key can only be replaced, never recovered.";
  $("minted-meta").textContent =
    "id " +
    minted.id +
    " — stores " +
    minted.stores.join(", ") +
    " — permissions " +
    minted.perms.join(", ") +
    " — expires " +
    (minted.expiresAt ?? "never");
  $("minted-panel").hidden = false;
  $("minted-key").focus();
  $("minted-key").select();
  await guard(refreshKeys);
}

async function copyKey() {
  clearError();
  clearStatus();
  const field = $("minted-key");
  if (field.value === "") {
    showError(new UiError("nothing_to_copy", "there is no key to copy"));
    return;
  }
  try {
    await navigator.clipboard.writeText(field.value);
    showStatus("Key copied to the clipboard.");
  } catch {
    // A visible fallback, never a silent failure: the key is selected for a manual copy.
    field.focus();
    field.select();
    showError(new UiError("copy_failed", "the clipboard was refused — the key is selected, press Ctrl/Cmd+C"));
  }
}

function init() {
  $("key-form").addEventListener("submit", proveKey);
  $("forget").addEventListener("click", forgetKey);
  $("scope-all").addEventListener("change", syncScope);
  $("mint-form").addEventListener("submit", mintKey);
  $("copy-key").addEventListener("click", copyKey);
  $("create-store-form").addEventListener("submit", createStore);
  $("refresh").addEventListener("click", () => {
    refreshAll().catch(showError);
  });
  for (const permission of DEFAULT_PERMISSIONS) {
    $(`perm-${permission}`).checked = true;
  }
  renderSession();
}

init();
