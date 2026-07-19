// lib/tradovate.js — minimal Tradovate REST adapter for connection testing.
// One attempt per call, no retries: retry policy belongs to the caller/UI so
// we can never hammer Tradovate's penalty system from a button click.

const BASE = (env) =>
  process.env.TDV_BASE_OVERRIDE ||
  `https://${env === "live" ? "live" : "demo"}.tradovateapi.com/v1`;

export async function testConnection({ env, username, password }) {
  const started = Date.now();
  let res, json;
  try {
    res = await fetch(`${BASE(env)}/auth/accesstokenrequest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: username,
        password,
        appId: "CopyEngine",
        appVersion: "0.1.0",
        deviceId: "copy-engine-dashboard",
      }),
    });
    json = await res.json().catch(() => ({}));
  } catch (e) {
    return { status: "network_error", detail: e.message, ms: Date.now() - started };
  }
  const ms = Date.now() - started;

  if (json["p-captcha"])
    return { status: "locked", detail: "Tradovate requires CAPTCHA after failed logins. Wait ~1 hour before testing again.", ms };
  if (json["p-ticket"])
    return { status: "rate_limited", detail: `Tradovate asks to wait ${json["p-time"] ?? "?"}s before the next attempt.`, ms };
  if (json.errorText)
    return { status: "rejected", detail: json.errorText, ms };
  if (!json.accessToken)
    return { status: "unexpected", detail: JSON.stringify(json).slice(0, 200), ms };

  // Authenticated — list the trading accounts under this login.
  let accounts = [];
  try {
    const r = await fetch(`${BASE(env)}/account/list`, {
      headers: { Authorization: `Bearer ${json.accessToken}` },
    });
    if (r.ok) {
      const list = await r.json();
      accounts = list.map((a) => ({
        id: a.id, name: a.name, type: a.accountType, active: a.active,
      }));
    }
  } catch { /* account list is best-effort for a connection test */ }

  return { status: "connected", userId: json.userId, accounts, ms };
}
