import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../server/app.js";
import { migrateSqlite } from "../scripts/migrate-postgres.js";
const databaseUrl = process.env.TEST_DATABASE_URL;
const password = "postgres-integration-test";
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
const cookie = (r) => r.headers["set-cookie"].split(";")[0];

test(
  "PostgreSQL 双实例初始化、乐观锁、共享会话、注销和重启",
  { skip: !databaseUrl },
  async (t) => {
    const schema = `test_${randomUUID().replaceAll("-", "")}`;
    const options = {
      databaseUrl,
      databaseSchema: schema,
      initialPassword: password,
      serveStatic: false,
    };
    const apps = await Promise.all([buildApp(options), buildApp(options)]);
    const pool = new pg.Pool({ connectionString: databaseUrl });
    t.after(async () => {
      await Promise.all(apps.map((app) => app.close()));
      await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
      await pool.end();
    });
    const [a, b] = apps;
    assert.equal((await a.store.room()).id, (await b.store.room()).id);
    const session = cookie(await req(a, "POST", "/api/login", { password }));
    const result = (
      await req(b, "GET", "/api/session?role=teacher", undefined, session)
    ).json();
    assert.ok(result.state);
    assert.equal(result.state.sync.mode, "polling");
    const room = result.state.room;
    const race = await Promise.all(
      apps.map((app) =>
        req(
          app,
          "POST",
          "/api/teacher/control",
          {
            roomId: room.id,
            revision: room.revision,
            action: "page",
            open: true,
          },
          session,
        ),
      ),
    );
    assert.deepEqual(race.map((r) => r.statusCode).sort(), [200, 409]);
    assert.equal(
      (await req(b, "GET", "/api/events?role=teacher", undefined, session))
        .statusCode,
      404,
    );
    await req(b, "POST", "/api/logout", {}, session);
    assert.deepEqual(
      (
        await req(a, "GET", "/api/session?role=teacher", undefined, session)
      ).json(),
      { state: null },
    );
  },
);

test(
  "SQLite 迁移到 PostgreSQL 保留课堂链接、密码、提交和删除回执，拒绝覆盖已有数据",
  { skip: !databaseUrl },
  async (t) => {
    const dataDir = mkdtempSync(join(tmpdir(), "class-migrate-"));
    const schema = `test_${randomUUID().replaceAll("-", "")}`;
    const source = await buildApp({
      dataDir,
      usePostgres: false,
      initialPassword: password,
      serveStatic: false,
    });
    const session = cookie(
      await req(source, "POST", "/api/login", { password }),
    );
    const room = await source.store.room();
    await source.store.run(
      "INSERT INTO participants (id,room_id,token,name,school,expires) VALUES (?,?,?,?,?,?)",
      "migration-student",
      room.id,
      "synthetic-token-hash",
      "迁移同学",
      "测试学校",
      Date.now() + 86400000,
    );
    await source.store.run(
      "INSERT INTO submissions (room_id,participant_id,kind,content,created_at,deleted_at) VALUES (?,?,?,?,?,?)",
      room.id,
      "migration-student",
      "discover",
      "{}",
      Date.now(),
      Date.now(),
    );
    await source.close();
    const pool = new pg.Pool({ connectionString: databaseUrl });
    t.after(async () => {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
      rmSync(dataDir, { recursive: true, force: true });
    });
    const options = { connectionString: databaseUrl, schema };
    const before = await migrateSqlite(
      join(dataDir, "classroom.sqlite"),
      options,
    );
    assert.equal(before.applied, false);
    const imported = await migrateSqlite(
      join(dataDir, "classroom.sqlite"),
      options,
      true,
    );
    assert.deepEqual(imported.counts, before.counts);
    await assert.rejects(
      migrateSqlite(join(dataDir, "classroom.sqlite"), options, true),
      /拒绝覆盖/,
    );
    const dest = await buildApp({
      databaseUrl,
      databaseSchema: schema,
      initialPassword: "must-not-replace",
      serveStatic: false,
    });
    try {
      assert.equal((await dest.store.room()).id, room.id);
      assert.equal(
        (
          await req(
            dest,
            "GET",
            "/api/session?role=teacher",
            undefined,
            session,
          )
        ).json().state.room.id,
        room.id,
      );
      assert.equal(
        (await req(dest, "POST", "/api/login", { password })).statusCode,
        200,
      );
      assert.deepEqual(await dest.store.counts(), {
        joined: 1,
        discover: 0,
        design: 0,
      });
      const deleted = await dest.store.get(
        "SELECT content,deleted_at FROM submissions",
      );
      assert.equal(deleted.content, "{}");
      assert.ok(deleted.deleted_at);
    } finally {
      await dest.close();
    }
  },
);

test("多实例配置缺少数据库时拒绝悄悄回落为 SQLite，HTTPS 配置自检", async () => {
  await assert.rejects(
    buildApp({
      usePostgres: false,
      requireSharedDatabase: true,
      serveStatic: false,
    }),
    /共享数据库/,
  );
  await assert.rejects(
    buildApp({
      publicUrl: "http://example.edu",
      secureCookie: true,
      serveStatic: false,
    }),
    /HTTPS/,
  );
});

test(
  "扣子标准 PG 环境变量自动启用共享存储",
  { skip: !databaseUrl },
  async (t) => {
    const schema = `test_${randomUUID().replaceAll("-", "")}`;
    const url = new URL(databaseUrl);
    const values = {
      PGHOST: url.hostname,
      PGPORT: url.port || "5432",
      PGDATABASE: url.pathname.slice(1),
      PGUSER: url.username || process.env.USER,
      PGPASSWORD: decodeURIComponent(url.password),
    };
    const before = Object.fromEntries(
      Object.keys(values).map((key) => [key, process.env[key]]),
    );
    Object.assign(process.env, values);
    const pool = new pg.Pool({ connectionString: databaseUrl });
    try {
      const app = await buildApp({
        databaseUrl: "",
        databaseSchema: schema,
        initialPassword: password,
        serveStatic: false,
      });
      try {
        assert.equal(app.store.dialect, "postgres");
        assert.equal(
          (await app.inject("/api/health")).json().syncMode,
          "polling",
        );
      } finally {
        await app.close();
      }
    } finally {
      for (const [key, value] of Object.entries(before)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
    }
  },
);
