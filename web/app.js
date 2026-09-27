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
  const list = $("stores");
  list.replaceChildren();
  for (const store of payload.stores) {
    const item = document.createElement("li");
    item.textContent = store.name + " (" + store.kind + ")";
    list.append(item);
  }
  renderStoreChoices(payload.stores);
}

async function refreshKeys() {
  const payload = await api(ROUTES.keys);
  const list = $("keys");
  list.replaceChildren();
  for (const entry of payload.keys) {
    const item = document.createElement("li");
    const line = document.createElement("span");
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
    if (entry.revokedAt !== null) {
      text += " — REVOKED " + entry.revokedAt;
      line.textContent = text;
      item.append(line);
    } else {
      line.textContent = text + " ";
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Revoke";
      button.addEventListener("click", () => {
        revokeKey(entry.id, entry.label).catch(showError);
      });
      item.append(line, button);
    }
    list.append(item);
  }
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
