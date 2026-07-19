// server.js — Copy Engine platform server (v0.1: account management + connection tests)
import Fastify from "fastify";
import { readFileSync } from "fs";
import { randomBytes, timingSafeEqual } from "crypto";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { accounts } from "./store.js";
import { testConnection } from "./tradovate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = Fastify({ logger: true });

// Flat layout: serve exactly the three UI assets, nothing else.
const asset = (f, type) => {
  const body = readFileSync(join(__dirname, f));
  return (req, reply) => reply.type(type).send(body);
};
app.get("/", asset("index.html", "text/html; charset=utf-8"));
app.get("/app.js", asset("app.js", "text/javascript; charset=utf-8"));
app.get("/styles.css", asset("styles.css", "text/css; charset=utf-8"));

// ---- admin auth (single-user, header token) --------------------------------
const ADMIN = process.env.ADMIN_PASSWORD;
if (!ADMIN || ADMIN.length < 8) {
  console.error("Set ADMIN_PASSWORD env var (min 8 chars) before starting.");
  process.exit(1);
}
const safeEq = (a, b) => {
  const ab = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ab.length === bb.length && timingSafeEqual(ab, bb);
};

// Session tokens: password is only ever sent once (login body); afterwards the
// browser holds a random hex token. Tokens live in memory — a redeploy simply
// asks you to log in again.
const sessions = new Set();

app.addHook("onRequest", async (req, reply) => {
  if (!req.url.startsWith("/api/")) return;
  if (req.url === "/api/login" || req.url === "/api/version") return;
  if (!sessions.has(req.headers["x-session"] || ""))
    return reply.code(401).send({ error: "unauthorized" });
});

app.get("/api/version", async () => ({ version: "0.1.3" }));

app.post("/api/login", async (req, reply) => {
  if (safeEq(req.body?.password || "", ADMIN)) {
    const token = randomBytes(24).toString("hex");
    sessions.add(token);
    return { ok: true, token };
  }
  return reply.code(401).send({ error: "Wrong password" });
});

// ---- accounts --------------------------------------------------------------
app.get("/api/accounts", async () => ({ accounts: accounts.list() }));

app.post("/api/accounts", async (req, reply) => {
  const { label, role, env, username, password } = req.body || {};
  if (!label || !username || !password)
    return reply.code(400).send({ error: "label, username and password are required" });
  if (!["master", "follower"].includes(role))
    return reply.code(400).send({ error: "role must be master or follower" });
  if (!["demo", "live"].includes(env))
    return reply.code(400).send({ error: "env must be demo or live" });
  if (role === "master" && accounts.list().some((a) => a.role === "master" && a.env === env))
    return reply.code(400).send({ error: "A master account already exists for this environment" });
  const id = accounts.add({ label, role, env, username, password });
  return { ok: true, id };
});

app.delete("/api/accounts/:id", async (req) => {
  return { ok: accounts.remove(Number(req.params.id)) > 0 };
});

// ---- connection test (guarded so UI clicks can never hammer Tradovate) -----
const lastTest = new Map(); // accountId -> epoch ms
const MIN_GAP_MS = 30_000;

app.post("/api/accounts/:id/test", async (req, reply) => {
  const id = Number(req.params.id);
  const creds = accounts.credentials(id);
  if (!creds) return reply.code(404).send({ error: "account not found" });

  const since = Date.now() - (lastTest.get(id) || 0);
  if (since < MIN_GAP_MS)
    return reply.code(429).send({
      error: `Wait ${Math.ceil((MIN_GAP_MS - since) / 1000)}s between tests — protects your login from Tradovate penalties`,
    });
  lastTest.set(id, Date.now());

  const result = await testConnection(creds);
  accounts.setStatus(id, result.status, result.detail || "", result.accounts);
  return { ...result };
});

app.get("/api/health", async () => ({ ok: true, version: "0.1.0" }));

const port = Number(process.env.PORT || 3000);
app.listen({ port, host: "0.0.0.0" });
