import { DatabaseSync } from "node:sqlite";
import { randomUUID, randomInt, createHash } from "node:crypto";
import { mkdirSync, chmodSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";

export class AppError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}
export const hash = (value) => createHash("sha256").update(value).digest("hex");
export function str(value, label, max = 500) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    throw new AppError(`${label}请填写 1–${max} 个字符`);
  return value.trim();
}
export function loadSchools(file) {
  const schools = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(schools) || !schools.length || schools.length > 500)
    throw new Error("学校配置应为包含 1–500 所学校的 JSON 数组");
  return [...new Set(schools.map((school) => str(school, "学校", 100)))];
}

export function createStore(directory) {
  const root = resolve(directory);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const file = join(root, "classroom.sqlite");
  const db = new DatabaseSync(file);
  chmodSync(file, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL,
      discover_open INTEGER NOT NULL DEFAULT 0, design_open INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS teachers (token TEXT PRIMARY KEY, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS participants (
      id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id), token TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL DEFAULT '', school TEXT NOT NULL DEFAULT '', expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, room_id TEXT NOT NULL REFERENCES rooms(id),
      participant_id TEXT NOT NULL REFERENCES participants(id), kind TEXT NOT NULL CHECK(kind IN ('discover','design')),
      content TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(participant_id,kind));
    CREATE INDEX IF NOT EXISTS participants_room ON participants(room_id);
    CREATE INDEX IF NOT EXISTS submissions_room ON submissions(room_id,kind,id);`);
  const get = (sql, ...values) => db.prepare(sql).get(...values);
  const all = (sql, ...values) => db.prepare(sql).all(...values);
  const run = (sql, ...values) => db.prepare(sql).run(...values);
  const meta = (key) => {
    const entry = get("SELECT value FROM meta WHERE key=?", key);
    return entry ? JSON.parse(entry.value) : null;
  };
  const setMeta = (key, value) =>
    run("INSERT OR REPLACE INTO meta VALUES (?,?)", key, JSON.stringify(value));
  function transaction(fn) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  function newRoom() {
    return transaction(() => {
      run("UPDATE rooms SET discover_open=0,design_open=0");
      let code;
      do {
        code = String(randomInt(100000, 1000000));
      } while (get("SELECT id FROM rooms WHERE code=?", code));
      const id = randomUUID();
      run(
        "INSERT INTO rooms (id,code,created_at) VALUES (?,?,?)",
        id,
        code,
        Date.now(),
      );
      setMeta("current", id);
      return room();
    });
  }
  function room() {
    const value = get("SELECT * FROM rooms WHERE id=?", meta("current"));
    return {
      id: value.id,
      code: value.code,
      discoverOpen: !!value.discover_open,
      designOpen: !!value.design_open,
      createdAt: value.created_at,
    };
  }
  function counts() {
    const id = meta("current");
    return {
      joined: get("SELECT COUNT(*) n FROM participants WHERE room_id=?", id).n,
      discover: get(
        "SELECT COUNT(*) n FROM submissions WHERE room_id=? AND kind='discover'",
        id,
      ).n,
      design: get(
        "SELECT COUNT(*) n FROM submissions WHERE room_id=? AND kind='design'",
        id,
      ).n,
    };
  }
  if (!meta("current")) newRoom();
  return {
    get,
    all,
    run,
    meta,
    setMeta,
    room,
    newRoom,
    counts,
    transaction,
    close: () => db.close(),
  };
}
