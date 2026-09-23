import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import { openDatabase } from "./database.js";

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

export async function createStore(directory, options = {}) {
  const db = await openDatabase(directory, options);
  const { get, all, run } = db;
  const active = new AsyncLocalStorage();
  const transaction = (fn, options) =>
    active.getStore()
      ? fn()
      : db.transaction(() => active.run(true, fn), options);
  const meta = async (key) => {
    const entry = await get("SELECT value FROM meta WHERE key=?", key);
    return entry ? JSON.parse(entry.value) : null;
  };
  const setMeta = (key, value) =>
    run(
      "INSERT INTO meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      key,
      JSON.stringify(value),
    );
  async function lockCurrent(exclusive = false) {
    if (!active.getStore()) throw new Error("课堂锁必须在事务中获取");
    await get(
      `SELECT key FROM meta WHERE key='current'${db.dialect === "postgres" ? (exclusive ? " FOR UPDATE" : " FOR SHARE") : ""}`,
    );
  }
  async function lockParticipant(id) {
    if (!active.getStore()) throw new Error("学生锁必须在事务中获取");
    await get(
      `SELECT id FROM participants WHERE id=?${db.dialect === "postgres" ? " FOR UPDATE" : ""}`,
      id,
    );
  }
  async function newRoom() {
    return transaction(async () => {
      await lockCurrent(true);
      await run(
        "UPDATE rooms SET discover_open=0,design_open=0,page_open=0,stage='ended',paused=1,revision=revision+1",
      );
      const id = randomUUID();
      await run(
        "INSERT INTO rooms (id,code,created_at) VALUES (?,?,?)",
        id,
        id,
        Date.now(),
      );
      await setMeta("current", id);
      return room(id);
    });
  }
  async function room(id) {
    const value = await get(
      db.dialect === "postgres"
        ? "SELECT r.*, (SELECT COUNT(*) FROM room_changes c WHERE c.room_id=r.id) AS data_revision FROM rooms r WHERE id=?"
        : "SELECT * FROM rooms WHERE id=?",
      id ?? (await meta("current")),
    );
    if (!value) return null;
    return {
      id: value.id,
      stage: value.stage,
      pageOpen: !!value.page_open,
      paused: !!value.paused,
      revision: value.revision,
      dataRevision: value.data_revision,
      discoverOpen:
        !!value.page_open && !value.paused && value.stage === "discover",
      designOpen:
        !!value.page_open && !value.paused && value.stage === "design",
      createdAt: value.created_at,
    };
  }
  async function control(next) {
    await run(
      "UPDATE rooms SET stage=?,page_open=?,paused=?,revision=revision+1,discover_open=?,design_open=? WHERE id=?",
      next.stage,
      Number(next.pageOpen),
      Number(next.paused),
      Number(next.pageOpen && !next.paused && next.stage === "discover"),
      Number(next.pageOpen && !next.paused && next.stage === "design"),
      next.id,
    );
  }
  // Append-only change receipts avoid serializing every student on one room row.
  // COUNT observes late commits too; MAX(sequence) alone could miss them.
  const touch = (id) =>
    db.dialect === "postgres"
      ? run("INSERT INTO room_changes (room_id) VALUES (?)", id)
      : run("UPDATE rooms SET data_revision=data_revision+1 WHERE id=?", id);
  async function counts(id) {
    id ??= await meta("current");
    const rows = await all(
      "SELECT kind,COUNT(*) n FROM submissions WHERE room_id=? AND deleted_at IS NULL GROUP BY kind",
      id,
    );
    return {
      joined: (
        await get("SELECT COUNT(*) n FROM participants WHERE room_id=?", id)
      ).n,
      discover: rows.find((r) => r.kind === "discover")?.n || 0,
      design: rows.find((r) => r.kind === "design")?.n || 0,
    };
  }
  async function initialize(passwordFactory) {
    return transaction(async () => {
      if (db.dialect === "postgres")
        await get("SELECT pg_advisory_xact_lock(741924)");
      let generated = null;
      if (!(await meta("password")) && passwordFactory) {
        const created = await passwordFactory();
        await setMeta("password", created.hash);
        generated = created.password;
      }
      if (!(await meta("current"))) await newRoom();
      return generated;
    });
  }
  return {
    get,
    all,
    run,
    meta,
    setMeta,
    room,
    control,
    newRoom,
    counts,
    transaction,
    lockCurrent,
    lockParticipant,
    touch,
    initialize,
    dialect: db.dialect,
    close: db.close,
  };
}
