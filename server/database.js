import { DatabaseSync } from "node:sqlite";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync, chmodSync } from "node:fs";
import { resolve, join } from "node:path";
import pg from "pg";

// One checked-out connection per transaction. SQLite also serializes asynchronous
// operations so a different request cannot accidentally join an open transaction.
export async function openDatabase(directory, options = {}) {
  const context = new AsyncLocalStorage();
  if (options.usePostgres ?? Boolean(options.connectionString)) {
    const schema = options.schema || "public";
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema))
      throw new Error("数据库 schema 名称无效");
    const pool = new pg.Pool({
      connectionString: options.connectionString,
      max: options.poolSize || 10,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      statement_timeout: 10000,
      options: `-c search_path=${schema}`,
    });
    pool.on("error", (error) =>
      console.error("database_pool_error", error.code || "CONNECTION_ERROR"),
    );
    const convert = (sql) => {
      let index = 0;
      return sql
        .replaceAll("instr(", "strpos(")
        .replace(/\?/g, () => `$${++index}`);
    };
    const rows = (result) =>
      result.rows.map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => [
            key === "participantid"
              ? "participantId"
              : key === "createdat"
                ? "createdAt"
                : key,
            [
              "id",
              "expires",
              "created_at",
              "createdat",
              "deleted_at",
              "revision",
              "data_revision",
              "n",
            ].includes(key) &&
            typeof value === "string" &&
            /^\d+$/.test(value) &&
            Number.isSafeInteger(Number(value))
              ? Number(value)
              : value,
          ]),
        ),
      );
    const query = (sql, values) =>
      (context.getStore() || pool).query(convert(sql), values);
    const db = {
      dialect: "postgres",
      get: async (sql, ...values) => rows(await query(sql, values))[0],
      all: async (sql, ...values) => rows(await query(sql, values)),
      run: async (sql, ...values) => ({
        changes: (await query(sql, values)).rowCount,
      }),
      transaction: async (fn, { readOnly = false } = {}) => {
        if (context.getStore()) return fn();
        const client = await pool.connect();
        try {
          await client.query(
            readOnly
              ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"
              : "BEGIN",
          );
          const result = await context.run(client, fn);
          await client.query("COMMIT");
          return result;
        } catch (error) {
          await client.query("ROLLBACK").catch(() => {});
          throw error;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
    try {
      await db.transaction(async () => {
        // All replicas serialize schema initialization, including a first boot.
        await db.get("SELECT pg_advisory_xact_lock(741923)");
        await db.run(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
        await db.run(`
          CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS rooms (
            id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL,
            discover_open INTEGER NOT NULL DEFAULT 0, design_open INTEGER NOT NULL DEFAULT 0,
            created_at BIGINT NOT NULL, stage TEXT NOT NULL DEFAULT 'waiting',
            page_open INTEGER NOT NULL DEFAULT 0, paused INTEGER NOT NULL DEFAULT 0,
            revision INTEGER NOT NULL DEFAULT 0, data_revision INTEGER NOT NULL DEFAULT 0);
          CREATE TABLE IF NOT EXISTS teachers (token TEXT PRIMARY KEY, expires BIGINT NOT NULL);
          CREATE TABLE IF NOT EXISTS participants (
            id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id), token TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL DEFAULT '', school TEXT NOT NULL DEFAULT '', expires BIGINT NOT NULL);
          CREATE TABLE IF NOT EXISTS submissions (
            id BIGSERIAL PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id),
            participant_id TEXT NOT NULL REFERENCES participants(id), kind TEXT NOT NULL CHECK(kind IN ('discover','design')),
            content TEXT NOT NULL, created_at BIGINT NOT NULL, deleted_at BIGINT, UNIQUE(participant_id,kind));
          CREATE INDEX IF NOT EXISTS participants_room ON participants(room_id);
          CREATE INDEX IF NOT EXISTS submissions_room ON submissions(room_id,kind,id);
          CREATE INDEX IF NOT EXISTS teachers_expires ON teachers(expires);
        `);
      });
    } catch (error) {
      await pool.end();
      throw error;
    }
    return db;
  }
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
  // Upgrade the original independent switches without dropping rooms or answers.
  if (
    !db
      .prepare("PRAGMA table_info(rooms)")
      .all()
      .some((column) => column.name === "stage")
  ) {
    db.exec(`BEGIN IMMEDIATE;
      ALTER TABLE rooms ADD COLUMN stage TEXT NOT NULL DEFAULT 'waiting';
      ALTER TABLE rooms ADD COLUMN page_open INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE rooms ADD COLUMN paused INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE rooms ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
      UPDATE rooms SET page_open=CASE WHEN discover_open=1 OR design_open=1 THEN 1 ELSE 0 END,
        stage=CASE WHEN design_open=1 THEN 'design' WHEN discover_open=1 THEN 'discover' ELSE 'waiting' END;
      COMMIT;`);
  }
  if (
    !db
      .prepare("PRAGMA table_info(submissions)")
      .all()
      .some((column) => column.name === "deleted_at")
  ) {
    db.exec("ALTER TABLE submissions ADD COLUMN deleted_at INTEGER");
  }
  if (
    !db
      .prepare("PRAGMA table_info(rooms)")
      .all()
      .some((column) => column.name === "data_revision")
  )
    db.exec(
      "ALTER TABLE rooms ADD COLUMN data_revision INTEGER NOT NULL DEFAULT 0",
    );
  let pending = Promise.resolve();
  const exclusive = (fn) => {
    if (context.getStore()) return Promise.resolve().then(fn);
    const result = pending.then(() => context.run(true, fn));
    pending = result.catch(() => {});
    return result;
  };
  return {
    dialect: "sqlite",
    get: (sql, ...values) => exclusive(() => db.prepare(sql).get(...values)),
    all: (sql, ...values) => exclusive(() => db.prepare(sql).all(...values)),
    run: (sql, ...values) => exclusive(() => db.prepare(sql).run(...values)),
    transaction: (fn) =>
      exclusive(async () => {
        // Nested transactions reuse the outer transaction through the store API.
        db.exec("BEGIN IMMEDIATE");
        try {
          const result = await fn();
          db.exec("COMMIT");
          return result;
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      }),
    close: () => exclusive(() => db.close()),
  };
}
