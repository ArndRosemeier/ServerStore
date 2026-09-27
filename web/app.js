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
 */

/** The API paths this console calls. Path literals ONLY here, so PIN U3 can read them. */
const ROUTES = {
  whoami: "/whoami",
  stores: "/stores",
  keys: "/keys",
  keyEdit: (id) => `/keys/${encodeURIComponent(id)}`,
  keyRevoke: (id) => `/keys/${encodeURIComponent(id)}/revoke`,
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

async function refreshStores() {
  const payload = await api(ROUTES.stores);
  storeList = payload.stores;
  const list = $("stores");
  list.replaceChildren();
  for (const store of payload.stores) {
    const item = document.createElement("li");
    item.textContent = store.name + " (" + store.kind + ")";
    list.append(item);
  }
  renderStoreChoices(payload.stores);
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

/** One key's row: what it holds, when it last changed, and its Edit/Revoke buttons. */
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
    revoke.addEventListener("click", () => {
      revokeKey(entry.id, entry.label).catch(showError);
    });
    actions.append(revoke);
  }

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
  await api(ROUTES.keyEdit(id), { method: "PATCH", body: JSON.stringify(body) });
  showStatus(
    "Key " + id + " updated. Its value is unchanged — whoever holds the key keeps using the same key.",
  );
  await guard(refreshKeys);
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

async function revokeKey(id, label) {
  if (!window.confirm('Revoke the key "' + label + '"? This cannot be undone.')) return;
  clearError();
  clearStatus();
  await api(ROUTES.keyRevoke(id), { method: "POST" });
  showStatus("Key " + id + " revoked. It is refused on its next request.");
  await guard(refreshKeys);
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
