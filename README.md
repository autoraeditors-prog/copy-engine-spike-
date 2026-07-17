# Tradovate Auth Spike — Run Instructions (browser-only)

Goal: prove your Lucid Tradovate credentials authenticate against the Tradovate API and that fills stream over the user-sync WebSocket. This is the go/no-go gate for the copy engine.

## 1. Create the repo (GitHub web)

Create a new **private** repo `copy-engine-spike`. Add three files via the web editor: `package.json`, `index.js`, and this `README.md` (contents provided by Claude).

## 2. Deploy on Railway

1. railway.app → New Project → **Deploy from GitHub repo** → pick `copy-engine-spike`.
2. Region: choose a **US** region.
3. In the service → **Variables**, add:
   - `TDV_ENV` = `demo`
   - `TDV_USER` = your Tradovate username
   - `TDV_PASS` = your Tradovate password  ← typed directly into Railway, never in chat/git
4. Deploy. Open **Logs**.

## 3. Read the result

**Success looks like:**
```
[auth] HTTP 200 ... [auth] OK. userId=...
[acct] id=... name=...
[ws] sent user/syncrequest — place a demo trade now
```
Then open Tradovate's demo in another tab, place 1 MNQ market order, and watch for a `[FILL]` line in Railway logs. If it appears → **GO**: the whole architecture is proven viable.

**Failure modes and what they mean:**
- `[auth] REJECTED: ...` with an access-denied message → Lucid credentials likely require API-key auth (cid/sec). Next move: check whether your Tradovate Application Settings shows an API Access tab, or ask Lucid support "do your Tradovate accounts support direct API access for personal trade copying?" (their Discord answers fast; CEO is active there).
- `Rate-limited (p-ticket)` → wait the stated seconds; too many auth attempts.
- `HTTP 200` but no `[FILL]` on trades → the sync subscription shape needs adjusting; send Claude the last ~20 log lines (they contain no secrets).

## 4. Cleanup

Stop/delete the Railway service when done. Nothing else to tear down.

**Security notes:** password lives only in Railway env vars; repo is private and contains no secrets; the script only reads account data and never places orders.
