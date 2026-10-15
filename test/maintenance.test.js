import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, promisify } from "node:util";
import pg from "pg";
import { buildApp } from "../server/app.js";

const run = promisify(execFile);
const databaseUrl = process.env.TEST_DATABASE_URL;
const password = "maintenance-test-password-only";
const req = (app, method, url, payload, cookie) =>
  app.inject({
    method,
    url,
    payload,
    headers: {
      "content-type": "application/json",
      "x-classroom-request": "1",
      ...(cookie ? { cookie } : {}),
    },
  });

async function command(script, args, values) {
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (
      key.startsWith("PG") ||
      ["DATABASE_URL", "DATABASE_SCHEMA", "DATA_DIR"].includes(key)
    )
      delete env[key];
  try {
    const { stdout } = await run(
      process.execPath,
      [
        fileURLToPath(new URL(`../scripts/${script}.js`, import.meta.url)),
        ...args,
      ],
      { env: { ...env, ...values }, timeout: 20000 },
    );
    return { code: 0, stdout };
  } catch (error) {
    // Never include generated passwords or connection strings in test diagnostics.
    return { code: error.code, stdout: error.stdout || "" };
  }
}

function directory(t) {
  const path = mkdtempSync(join(tmpdir(), "workshop-maintenance-"));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

async function snapshot(store, includeAuth = false) {
  const rows = {};
  for (const [table, order] of [
    ["rooms", "id"],
    ["participants", "id"],
    ["submissions", "id"],
    ["meta", "key"],
    ...(includeAuth ? [["teachers", "token"]] : []),
  ]) {
    const filter =
      table === "meta" && !includeAuth ? " WHERE key <> 'password'" : "";
    rows[table] = (
      await store.all(`SELECT * FROM ${table}${filter} ORDER BY ${order}`)
    ).map((row) => ({ ...row }));
  }
  return rows;
}

async function seed(options) {
  const app = await buildApp({
    initialPassword: password,
    serveStatic: false,
    ...options,
  });
  try {
    const login = await req(app, "POST", "/api/login", { password });
    assert.equal(login.statusCode, 200);
    const teacher = login.headers["set-cookie"].split(";")[0];
    const room = await app.store.room();
    await app.store.run(
      "INSERT INTO participants (id,room_id,token,name,school,expires) VALUES (?,?,?,?,?,?)",
      "maintenance-student",
      room.id,
      "synthetic-token",
      "维护测试同学",
      "测试学校",
      Date.now() + 86400000,
    );
    await app.store.run(
      "INSERT INTO submissions (room_id,participant_id,kind,content,created_at,activity_id) VALUES (?,?,?,?,?,?)",
      room.id,
      "maintenance-student",
      "judge",
      JSON.stringify({ answer: "true" }),
      Date.now(),
      "judge",
    );
    return {
      teacher,
      classroom: await snapshot(app.store),
      all: await snapshot(app.store, true),
    };
  } finally {
    await app.close();
  }
}

async function checkReset(options, env) {
  const original = await seed(options);
  const result = await command("reset-password", [], env);
  assert.equal(result.code, 0);
  const newPassword = result.stdout.match(/教师新密码（请保存）：(\S+)/)?.[1];
  assert.ok(newPassword, "命令应生成可用的新密码");
  const app = await buildApp({ serveStatic: false, ...options });
  try {
    assert.equal(
      (await req(app, "POST", "/api/login", { password })).statusCode,
      401,
    );
    assert.equal(
      (await req(app, "POST", "/api/login", { password: newPassword }))
        .statusCode,
      200,
    );
    assert.equal(
      (await req(app, "GET", "/api/teacher/state", undefined, original.teacher))
        .statusCode,
      401,
    );
    assert.ok(
      isDeepStrictEqual(await snapshot(app.store), original.classroom),
      "课堂、学生与提交应保持不变",
    );
  } finally {
    await app.close();
  }
}

test("密码重置 CLI 在未配置 PostgreSQL 时继续使用指定 SQLite 数据目录", async (t) => {
  const dataDir = directory(t);
  await checkReset(
    { dataDir, databaseUrl: "", usePostgres: false },
    { DATA_DIR: dataDir },
  );
});

function postgresEnvironment(mode) {
  const url = new URL(databaseUrl);
  const sslmode = url.searchParams.get("sslmode") || process.env.PGSSLMODE;
  const ssl = sslmode ? { PGSSLMODE: sslmode } : {};
  if (mode !== "PG*") return { [mode]: databaseUrl, ...ssl };
  return {
    ...ssl,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username) || process.env.USER,
    PGPASSWORD: decodeURIComponent(url.password),
  };
}

function postgresTarget(t) {
  const databaseSchema = `test_${randomUUID().replaceAll("-", "")}`;
  t.after(async () => {
    const pool = new pg.Pool({ connectionString: databaseUrl });
    try {
      await pool.query(`DROP SCHEMA IF EXISTS "${databaseSchema}" CASCADE`);
    } finally {
      await pool.end();
    }
  });
  return { databaseUrl, databaseSchema, usePostgres: true };
}

for (const mode of ["DATABASE_URL", "PGDATABASE_URL", "PG*"]) {
  test(
    `密码重置 CLI 仅配置 ${mode} 时修改 PostgreSQL 并撤销旧会话`,
    { skip: !databaseUrl },
    async (t) => {
      const dataDir = directory(t);
      const options = postgresTarget(t);
      await checkReset(options, {
        ...postgresEnvironment(mode),
        DATABASE_SCHEMA: options.databaseSchema,
        DATA_DIR: dataDir,
      });
      assert.equal(existsSync(join(dataDir, "classroom.sqlite")), false);
    },
  );

  test(
    `迁移 CLI 仅配置 ${mode} 时导入 PostgreSQL、保留源库并拒绝覆盖`,
    { skip: !databaseUrl },
    async (t) => {
      const dataDir = directory(t);
      const source = await seed({
        dataDir,
        databaseUrl: "",
        usePostgres: false,
      });
      const file = join(dataDir, "classroom.sqlite");
      const before = readFileSync(file);
      const options = postgresTarget(t);
      const env = {
        ...postgresEnvironment(mode),
        DATABASE_SCHEMA: options.databaseSchema,
      };
      const preview = await command("migrate-postgres", [file], env);
      assert.equal(preview.code, 0);
      assert.equal(JSON.parse(preview.stdout).applied, false);
      const result = await command("migrate-postgres", [file, "--apply"], env);
      assert.equal(result.code, 0);
      assert.equal(JSON.parse(result.stdout).applied, true);
      const retry = await command("migrate-postgres", [file, "--apply"], env);
      assert.equal(retry.code, 1);
      assert.ok(readFileSync(file).equals(before), "迁移不得修改 SQLite 源库");
      const app = await buildApp({ serveStatic: false, ...options });
      try {
        assert.ok(
          isDeepStrictEqual(await snapshot(app.store, true), source.all),
          "迁移应完整保留课堂、密码、会话及提交",
        );
        assert.equal(
          (
            await req(
              app,
              "GET",
              "/api/teacher/state",
              undefined,
              source.teacher,
            )
          ).statusCode,
          200,
        );
        assert.equal(
          (await req(app, "POST", "/api/login", { password })).statusCode,
          200,
        );
      } finally {
        await app.close();
      }
    },
  );
}
