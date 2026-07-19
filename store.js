// lib/store.js — SQLite persistence with envelope-encrypted credentials.
// Passwords are AES-256-GCM encrypted; the key is derived from ENCRYPTION_KEY
// (env var, set in Railway) and never stored anywhere.

import Database from "better-sqlite3";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { mkdirSync } from "fs";
import { join } from "path";

const DATA_DIR = process.env.DATA_DIR || "./data";
mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(join(DATA_DIR, "copy-engine.db"));
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('master','follower')),
    env TEXT NOT NULL CHECK (env IN ('demo','live')),
    username TEXT NOT NULL,
    enc_password TEXT NOT NULL,
    last_status TEXT DEFAULT 'untested',
    last_detail TEXT DEFAULT '',
    last_checked_at TEXT,
    broker_accounts TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

function key() {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret || secret.length < 16)
    throw new Error("ENCRYPTION_KEY env var missing or too short (min 16 chars)");
  return createHash("sha256").update(secret).digest();
}

export function encrypt(plain) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}

export function decrypt(blob) {
  const [iv, tag, data] = blob.split(".").map((s) => Buffer.from(s, "base64"));
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString("utf8");
}

export const accounts = {
  list: () =>
    db.prepare(`SELECT id,label,role,env,username,last_status,last_detail,
                last_checked_at,broker_accounts,created_at FROM accounts
                ORDER BY role DESC, id`).all()
      .map((a) => ({ ...a, broker_accounts: JSON.parse(a.broker_accounts) })),

  add: ({ label, role, env, username, password }) =>
    db.prepare(`INSERT INTO accounts (label,role,env,username,enc_password)
                VALUES (?,?,?,?,?)`)
      .run(label, role, env, username, encrypt(password)).lastInsertRowid,

  remove: (id) => db.prepare("DELETE FROM accounts WHERE id = ?").run(id).changes,

  credentials: (id) => {
    const row = db.prepare("SELECT env,username,enc_password FROM accounts WHERE id = ?").get(id);
    return row ? { env: row.env, username: row.username, password: decrypt(row.enc_password) } : null;
  },

  setStatus: (id, status, detail, brokerAccounts) =>
    db.prepare(`UPDATE accounts SET last_status=?, last_detail=?,
                last_checked_at=datetime('now'),
                broker_accounts=COALESCE(?, broker_accounts) WHERE id=?`)
      .run(status, detail, brokerAccounts ? JSON.stringify(brokerAccounts) : null, id),
};
