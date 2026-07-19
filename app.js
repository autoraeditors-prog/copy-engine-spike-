// public/app.js — console client
const $ = (id) => document.getElementById(id);
let KEY = sessionStorage.getItem("ck") || "";

const api = async (path, opts = {}) => {
  const headers = { "x-session": KEY, ...(opts.headers || {}) };
  if (opts.body) headers["Content-Type"] = "application/json";
  const res = await fetch(path, {
    ...opts,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/api/login") { logout(); throw new Error("Session expired"); }
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
};

function logout() { KEY = ""; sessionStorage.removeItem("ck"); $("console").hidden = true; $("login").hidden = false; }

// ---- login -----------------------------------------------------------------
$("login-btn").onclick = async () => {
  const pass = $("login-pass").value;
  $("login-err").hidden = true;
  try {
    const r = await api("/api/login", { method: "POST", body: { password: pass } });
    KEY = r.token;
    sessionStorage.setItem("ck", KEY);
    $("login").hidden = true; $("console").hidden = false;
    refresh();
  } catch (e) { KEY = ""; $("login-err").textContent = e.message; $("login-err").hidden = false; }
};
$("login-pass").addEventListener("keydown", (e) => { if (e.key === "Enter") $("login-btn").click(); });

// ---- accounts board --------------------------------------------------------
const STATUS_LABEL = {
  untested: "UNTESTED", connected: "CONNECTED", rejected: "REJECTED",
  rate_limited: "RATE LIMITED", locked: "LOCKED", network_error: "NETWORK ERROR", unexpected: "UNEXPECTED",
};

async function refresh() {
  const { accounts } = await api("/api/accounts");
  $("stat-accounts").textContent = accounts.length;
  const connected = accounts.filter((a) => a.last_status === "connected").length;
  $("stat-connected").textContent = connected;
  const envs = [...new Set(accounts.map((a) => a.env))];
  $("stat-env").textContent = envs.length ? envs.join("+").toUpperCase() : "—";

  const list = $("acct-list");
  list.innerHTML = "";
  $("acct-empty").hidden = accounts.length > 0;

  for (const a of accounts) {
    const t = document.createElement("div");
    t.className = `ticket ${a.role}`;
    const broker = (a.broker_accounts || [])
      .map((b) => `${b.name}${b.active ? "" : " (inactive)"}`).join(" · ");
    t.innerHTML = `
      <div class="rail"></div>
      <div class="ticket-main">
        <div class="ticket-top">
          <span class="label"></span>
          <span class="role">${a.role}</span>
          <span class="env">${a.env}</span>
          <span class="pill ${a.last_status}">${STATUS_LABEL[a.last_status] || a.last_status}</span>
        </div>
        <div class="ticket-sub">${escapeHtml(a.username)}${broker ? " → " + escapeHtml(broker) : ""}</div>
        ${a.last_detail ? `<div class="detail">${escapeHtml(a.last_detail)}</div>` : ""}
        ${a.last_checked_at ? `<div class="detail">Last check: ${a.last_checked_at} UTC</div>` : ""}
      </div>
      <div class="ticket-actions">
        <button class="btn btn-sm btn-primary" data-test="${a.id}">Test connection</button>
        <button class="btn btn-sm" data-del="${a.id}">Remove</button>
      </div>`;
    t.querySelector(".label").textContent = a.label;
    list.appendChild(t);
  }
  $("stat-engine").textContent = connected > 0 ? "READY" : "STANDBY";
  $("stat-engine").className = connected > 0 ? "green" : "amber";
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

document.addEventListener("click", async (e) => {
  const test = e.target.dataset?.test, del = e.target.dataset?.del;
  if (test) {
    e.target.disabled = true; e.target.textContent = "Testing…";
    try { await api(`/api/accounts/${test}/test`, { method: "POST" }); }
    catch (err) { alert(err.message); }
    await refresh();
  }
  if (del) {
    if (!confirm("Remove this account and its stored credentials?")) return;
    await api(`/api/accounts/${del}`, { method: "DELETE" });
    await refresh();
  }
});

// ---- add-account modal -----------------------------------------------------
$("add-btn").onclick = () => { $("modal").hidden = false; $("modal-err").hidden = true; };
$("modal-cancel").onclick = () => ($("modal").hidden = true);
$("modal-save").onclick = async () => {
  $("modal-err").hidden = true;
  try {
    await api("/api/accounts", {
      method: "POST",
      body: {
        label: $("f-label").value.trim(), role: $("f-role").value, env: $("f-env").value,
        username: $("f-user").value.trim(), password: $("f-pass").value,
      },
    });
    ["f-label", "f-user", "f-pass"].forEach((id) => ($(id).value = ""));
    $("modal").hidden = true;
    refresh();
  } catch (err) { $("modal-err").textContent = err.message; $("modal-err").hidden = false; }
};

// ---- boot ------------------------------------------------------------------
if (KEY) { $("login").hidden = true; $("console").hidden = false; refresh().catch(logout); }
