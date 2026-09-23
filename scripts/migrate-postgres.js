import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createStore } from "../server/store.js";

export async function migrateSqlite(file, options, apply = false) {
  const source = new DatabaseSync(resolve(file), { readOnly: true });
  const tables = ["rooms", "teachers", "participants", "submissions", "meta"];
  let snapshot;
  try {
    source.exec("BEGIN");
    snapshot = Object.fromEntries(
      tables.map((table) => [
        table,
        source.prepare(`SELECT * FROM ${table}`).all(),
      ]),
    );
    source.exec("COMMIT");
  } finally {
    source.close();
  }
  if (
    !snapshot.meta.some((row) => row.key === "current") ||
    !snapshot.meta.some((row) => row.key === "password")
  )
    throw new Error("源数据库缺少课堂或教师密码，未执行迁移");
  const counts = Object.fromEntries(
    tables.map((table) => [table, snapshot[table].length]),
  );
  if (!apply) return { applied: false, counts };
  if (!options.connectionString && !options.usePostgres)
    throw new Error("请配置目标 PostgreSQL");
  const target = await createStore(null, options);
  try {
    await target.transaction(async () => {
      await target.get("SELECT pg_advisory_xact_lock(741924)");
      for (const table of tables) {
        if ((await target.get(`SELECT COUNT(*) n FROM ${table}`)).n !== 0)
          throw new Error(
            "目标数据库已有课堂数据，拒绝覆盖；请使用空数据库或空 schema",
          );
      }
      for (const table of tables) {
        for (const original of snapshot[table]) {
          const row = { ...original };
          if (table === "rooms") {
            row.stage ??= row.design_open
              ? "design"
              : row.discover_open
                ? "discover"
                : "waiting";
            row.page_open ??= Number(
              Boolean(row.discover_open || row.design_open),
            );
            row.paused ??= 0;
            row.revision ??= 0;
            row.data_revision ??= 0;
          }
          if (table === "submissions") row.deleted_at ??= null;
          const keys = Object.keys(row);
          // Column names come from SQLite schema, still quote and validate them.
          if (keys.some((key) => !/^\w+$/.test(key)))
            throw new Error("源数据库列名无效");
          await target.run(
            `INSERT INTO ${table} (${keys.map((k) => `"${k}"`).join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
            ...keys.map((key) => row[key]),
          );
        }
        if (
          (await target.get(`SELECT COUNT(*) n FROM ${table}`)).n !==
          counts[table]
        )
          throw new Error("迁移数量不一致，已回滚");
      }
      await target.get(
        "SELECT setval(pg_get_serial_sequence('submissions','id'), COALESCE((SELECT MAX(id) FROM submissions),1), EXISTS(SELECT 1 FROM submissions))",
      );
    });
    return { applied: true, counts };
  } finally {
    await target.close();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const file = process.argv[2];
  if (!file)
    throw new Error(
      "用法：node --env-file-if-exists=.env scripts/migrate-postgres.js /安全备份/classroom.sqlite [--apply]",
    );
  try {
    console.log(
      JSON.stringify(
        await migrateSqlite(
          file,
          {
            connectionString:
              process.env.DATABASE_URL || process.env.PGDATABASE_URL,
            usePostgres: Boolean(process.env.PGHOST && process.env.PGDATABASE),
            schema: process.env.DATABASE_SCHEMA,
          },
          process.argv.includes("--apply"),
        ),
      ),
    );
  } catch (error) {
    console.error("迁移失败：", error.code || error.message);
    process.exitCode = 1;
  }
}
