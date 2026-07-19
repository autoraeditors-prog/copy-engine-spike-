// Tradovate auth + user-sync spike (go/no-go gate for the copy engine)
// Proves: (1) Lucid-issued Tradovate credentials authenticate against the API,
//         (2) we can stream fills/orders/positions over the user-sync WebSocket.
//
// Env vars (set in Railway, never in code):
//   TDV_ENV       demo | live            (default: demo)
//   TDV_USER      Tradovate username
//   TDV_PASS      Tradovate password
//   TDV_CID       API key client id      (optional — see note A)
//   TDV_SEC       API key secret         (optional — see note A)
//   TDV_APP_ID    app name string        (default: "CopyEngineSpike")
//
// Note A: Officially, API keys (cid/sec) come from the paid API Access add-on.
// Third-party copiers connect to prop-issued accounts with username/password,
// so first run WITHOUT cid/sec. If auth returns 401/"Access denied", that tells
// us which path Lucid accounts require — that answer is the point of this spike.

import WebSocket from "ws";

const ENV = process.env.TDV_ENV === "live" ? "live" : "demo";
const BASE = `https://${ENV}.tradovateapi.com/v1`;
const WS_URL = `wss://${ENV}.tradovateapi.com/v1/websocket`;

const log = (tag, msg) =>
  console.log(`${new Date().toISOString()} [${tag}] ${msg}`);

function need(name) {
  const v = process.env[name];
  if (!v) { console.error(`Missing env var ${name}`); process.exit(1); }
  return v;
}

const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

// Never exit on failure — exiting makes Railway restart-loop us into
// Tradovate's penalty system. Log the verdict and idle instead.
async function holdOpen(reason) {
  log("halt", `${reason} — spike idle, stop the Railway service when done`);
  setInterval(() => {}, 2147483647); // real handle: keeps the event loop alive
  await new Promise(() => {});
}

async function authenticate() {
  const base = {
    name: need("TDV_USER"),
    password: need("TDV_PASS"),
    appId: process.env.TDV_APP_ID || "CopyEngineSpike",
    appVersion: "0.1.0",
    deviceId: "copy-engine-spike-001",
  };
  if (process.env.TDV_CID) {
    base.cid = Number(process.env.TDV_CID);
    base.sec = need("TDV_SEC");
  }

  let pTicket = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const body = pTicket ? { ...base, "p-ticket": pTicket } : base;
    const t0 = Date.now();
    let res, json;
    try {
      res = await fetch(`${BASE}/auth/accesstokenrequest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      json = await res.json().catch(() => ({}));
    } catch (e) {
      log("auth", `network error: ${e.message}, retrying in 30s`);
      await sleep(30);
      continue;
    }
    log("auth", `HTTP ${res.status} in ${Date.now() - t0}ms (attempt ${attempt})`);

    if (json["p-ticket"]) {
      const wait = Number(json["p-time"] || 60) + 3;
      if (json["p-captcha"]) {
        await holdOpen("Tradovate requires CAPTCHA — too many failed logins. Wait ~1h, verify credentials, redeploy once");
      }
      log("auth", `Rate-limited: waiting ${wait}s, then retrying with p-ticket`);
      pTicket = json["p-ticket"];
      await sleep(wait);
      continue;
    }
    if (json.errorText) await holdOpen(`REJECTED: ${json.errorText}`);
    if (!json.accessToken)
      await holdOpen(`Unexpected response: ${JSON.stringify(json).slice(0, 300)}`);

    log("auth", `OK. userId=${json.userId}, expires=${json.expirationTime}`);
    return json;
  }
  await holdOpen("auth failed after 3 attempts");
}

async function listAccounts(token) {
  const res = await fetch(`${BASE}/account/list`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const accounts = await res.json();
  for (const a of accounts) {
    log("acct", `id=${a.id} name=${a.name} type=${a.accountType} active=${a.active}`);
  }
  return accounts;
}

function openUserSync(token, userId) {
  const ws = new WebSocket(WS_URL);
  let reqId = 0;
  const send = (endpoint, query = "", body = "") => {
    reqId += 1;
    // Tradovate WS frame: "<endpoint>\n<id>\n<query>\n<body>"
    ws.send(`${endpoint}\n${reqId}\n${query}\n${body}`);
    return reqId;
  };

  ws.on("open", () => log("ws", "socket open, waiting for open-frame"));
  ws.on("close", (c) => log("ws", `closed (${c})`));
  ws.on("error", (e) => log("ws", `error: ${e.message}`));

  ws.on("message", (raw) => {
    const text = raw.toString();
    const kind = text[0];
    if (kind === "o") {                 // server open frame -> authorize
      send("authorize", "", token);
      log("ws", "sent authorize");
    } else if (kind === "h") {          // heartbeat -> echo empty frame
      ws.send("[]");
    } else if (kind === "a") {          // data frame: array of messages
      let msgs;
      try { msgs = JSON.parse(text.slice(1)); } catch { return; }
      for (const m of msgs) {
        if (m.i !== undefined) {
          log("ws", `response id=${m.i} status=${m.s}`);
          if (m.s === 200 && m.i === 1) {
            send("user/syncrequest", "", JSON.stringify({ users: [userId] }));
            log("ws", "sent user/syncrequest — place a demo trade now");
          }
        } else if (m.e === "props" && m.d) {
          const { entityType, eventType, entity } = m.d;
          if (entityType === "fill") {
            log("FILL", `${eventType} ${JSON.stringify(entity)} (latency test point)`);
          } else if (entityType === "order" || entityType === "position") {
            log(entityType.toUpperCase(), `${eventType} ${JSON.stringify(entity)}`);
          }
        } else if (m.e === "shutdown") {
          log("ws", `server shutdown: ${JSON.stringify(m.d)}`);
        }
      }
    }
  });

  // client heartbeat every 2.5s keeps the session alive
  setInterval(() => { if (ws.readyState === 1) ws.send("[]"); }, 2500);
}

const auth = await authenticate();
await listAccounts(auth.accessToken);
openUserSync(auth.accessToken, auth.userId);
log("main", "spike running — Ctrl+C / stop deploy to exit");
