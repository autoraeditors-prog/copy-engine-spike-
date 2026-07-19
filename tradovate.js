// lib/tradovate.js — Tradovate REST adapter for connection testing.
// One attempt per call, no retries: retry policy belongs to the caller/UI so
// we can never hammer Tradovate's penalty system from a button click.
//
// Tradovate quirk (learned from how mature copiers connect): the ACCESS TOKEN is
// obtained from a single auth endpoint, then account/entitlement data for LIVE
// accounts is fetched from the live host. Demo accounts use the demo host
// throughout. We therefore auth on the correct host and, on success, list
// accounts from that same host.

const HOST = (env) =>
  process.env.TDV_BASE_OVERRIDE ||
  `https://${env === "live" ? "live" : "demo"}.tradovateapi.com/v1`;

const AUTH_BODY = (username, password) => ({
  name: username,
  password,
  appId: "CopyEngine",
  appVersion: "0.1.0",
  deviceId: "copy-engine-dashboard",
});

async function authOn(host, username, password) {
  const res = await fetch(`${host}/auth/accesstokenrequest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(AUTH_BODY(username, password)),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

export async function testConnection({ env, username, password }) {
  const started = Date.now();
  const host = HOST(env);
  let r;
  try {
    r = await authOn(host, username, password);
  } catch (e) {
    return { status: "network_error", detail: e.message, ms: Date.now() - started };
  }
  const ms = Date.now() - started;
  const { json } = r;

  if (json["p-captcha"])
    return { status: "locked", detail: "Tradovate requires CAPTCHA after failed logins. Wait ~1 hour before testing again.", ms };
  if (json["p-ticket"])
    return { status: "rate_limited", detail: `Tradovate asks to wait ${json["p-time"] ?? "?"}s before the next attempt.`, ms };
  if (json.errorText)
    return { status: "rejected", detail: json.errorText, ms };
  if (!json.accessToken)
    return { status: "unexpected", detail: JSON.stringify(json).slice(0, 200), ms };

  // Authenticated — list the trading accounts under this login on the same host.
  let accounts = [];
  try {
    const a = await fetch(`${host}/account/list`, {
      headers: { Authorization: `Bearer ${json.accessToken}` },
    });
    if (a.ok) {
      const list = await a.json();
      accounts = list.map((x) => ({
        id: x.id, name: x.name, type: x.accountType, active: x.active,
      }));
    }
  } catch { /* best-effort */ }

  return { status: "connected", userId: json.userId, env, accounts, ms };
}
