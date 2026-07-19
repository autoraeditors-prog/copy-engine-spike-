# Copy Engine v0.1 — Deploy Guide

What this version is: the platform foundation. Log in to your own private console, add master/follower accounts like on Tradecopia, credentials stored encrypted, one-click connection tests against the real Tradovate API. The live copying engine plugs into this next.

## 1. New GitHub repo

Create a **private** repo named `copy-engine` (keep the spike repo separate or delete it). Upload the contents of the zip **preserving folders**:

```
package.json
server.js
.gitignore
lib/tradovate.js
lib/store.js
public/index.html
public/styles.css
public/app.js
```

Easiest way: unzip on your Mac → in GitHub click Add file → Upload files → drag the *contents* of the folder in (GitHub keeps the lib/ and public/ structure).

## 2. Railway service

1. Railway → New Project → Deploy from GitHub repo → `copy-engine`.
2. **Variables** — add:
   - `ADMIN_PASSWORD` = a strong password for the dashboard login (min 8 chars)
   - `ENCRYPTION_KEY` = a long random string (30+ chars — mash the keyboard; if ever lost, stored credentials become unreadable and must be re-added)
   - `DATA_DIR` = `/data`
3. **Volume** (so accounts survive redeploys): right-click the service (or ⌘K) → Add Volume → mount path `/data`.
4. **Domain**: service → Settings → Networking → Generate Domain. This is your platform URL — open it in any browser.

## 3. Use it

1. Open your Railway domain → enter your admin password.
2. "+ Add account" → add your master (the Lucid login you trade via TradingView). Environment: demo for the first test.
3. Click **Test connection**. The verdict appears on the account card:
   - **CONNECTED** — shows your actual Lucid sub-accounts next to the username. This is the green light for the whole project.
   - **REJECTED** — Tradovate refused the username/password. Verify at trader.tradovate.com in a browser first.
   - **RATE LIMITED / LOCKED** — too many recent failed attempts; wait the stated time (locked ≈ 1 hour).
4. Add your follower accounts the same way.

The console enforces 30 seconds between tests per account so you can't accidentally trigger Tradovate's penalty system from the UI.

## What's next (in order)

1. Master fill streaming (WebSocket) — live positions on the dashboard
2. Copy engine — followers mirror the master, with per-follower multipliers
3. Risk controls — daily loss caps, drawdown distance, kill switch, flatten all
