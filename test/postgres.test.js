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
    let releaseLate, entered;
    const started = new Promise((resolve) => {
      entered = resolve;
    });
    const held = new Promise((resolve) => {
      releaseLate = resolve;
    });
    const late = a.store.transaction(async () => {
      await a.store.touch(room.id);
      entered();
      await held;
    });
    await started;
    try {
      await b.store.transaction(() => b.store.touch(room.id));
      const firstVersion = (await b.store.room()).dataRevision;
      releaseLate();
      await late;
      assert.equal(
        (await b.store.room()).dataRevision,
        firstVersion + 1,
        "晚提交的变化必须继续刷新列表",
      );
    } finally {
      releaseLate();
      await late;
    }
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
  "SQLite 迁移到 PostgreSQL 保留课堂链接、密码、重复类型活动及删除回执，拒绝覆盖已有数据",
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
      "INSERT INTO submissions (room_id,participant_id,kind,content,created_at,deleted_at,activity_id) VALUES (?,?,?,?,?,?,?)",
      room.id,
      "migration-student",
      "discover",
      "{}",
      Date.now(),
      Date.now(),
      "discover",
    );
    const activityList = await source.store.activities();
    activityList.push({
      ...structuredClone(activityList[0]),
      id: "migration-judge",
      question: "同类型迁移题目",
    });
    await source.store.setMeta(`activities:${room.id}`, activityList);
    for (const id of ["judge", "migration-judge"])
      await source.store.run(
        "INSERT INTO submissions (room_id,participant_id,kind,content,created_at,activity_id) VALUES (?,?,?,?,?,?)",
        room.id,
        "migration-student",
        "judge",
        JSON.stringify({ answer: "true" }),
        Date.now(),
        id,
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
        judge: 1,
        "migration-judge": 1,
        choice: 0,
        wordcloud: 0,
      });
      assert.deepEqual(await dest.store.activities(), activityList);
      const deleted = await dest.store.get(
        "SELECT content,deleted_at,activity_id FROM submissions WHERE kind='discover'",
      );
      assert.equal(deleted.content, "{}");
      assert.ok(deleted.deleted_at);
      assert.equal(deleted.activity_id, "discover");
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

test(
  "0.5 PostgreSQL 的旧类型约束可并发升级，新活动在两个实例间共享",
  { skip: !databaseUrl },
  async (t) => {
    const schema = `test_${randomUUID().replaceAll("-", "")}`;
    const options = {
      databaseUrl,
      databaseSchema: schema,
      initialPassword: password,
      serveStatic: false,
    };
    const initial = await buildApp(options);
    const room = await initial.store.room();
    const teacher = cookie(
      await req(initial, "POST", "/api/login", { password }),
    );
    const student = cookie(
      await req(initial, "POST", "/api/join", { classroomId: room.id }),
    );
    await initial.close();
    const pool = new pg.Pool({ connectionString: databaseUrl });
    const apps = [];
    t.after(async () => {
      await Promise.all(apps.map((app) => app.close()));
      await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
      await pool.end();
    });
    await pool.query(`ALTER TABLE "${schema}".submissions DROP CONSTRAINT submissions_kind_check;
    ALTER TABLE "${schema}".submissions ADD CONSTRAINT submissions_kind_check CHECK(kind IN ('discover','design'))`);
    apps.push(...(await Promise.all([buildApp(options), buildApp(options)])));
    const [a, b] = apps;
    for (const change of [
      { action: "page", open: true },
      { action: "stage", stage: "judge" },
    ]) {
      const current = await a.store.room();
      assert.equal(
        (
          await req(
            a,
            "POST",
            "/api/teacher/control",
            { roomId: current.id, revision: current.revision, ...change },
            teacher,
          )
        ).statusCode,
        200,
      );
    }
    const state = (
      await req(b, "GET", "/api/teacher/state", undefined, teacher)
    ).json();
    const submitted = await req(
      b,
      "POST",
      "/api/student/submit/judge",
      {
        name: "升级学生",
        school: state.schools[0],
        answer: "true",
        activityRevision: 1,
      },
      student,
    );
    assert.equal(submitted.statusCode, 200, submitted.body);
    assert.equal(
      (
        await req(a, "GET", "/api/results?kind=judge", undefined, student)
      ).json().total,
      1,
    );
    assert.equal((await a.store.room()).id, room.id);
  },
);

test(
  "0.6 PostgreSQL 双实例升级保留答案，活动排序与删除提交的并发不产生串题或残留",
  { skip: !databaseUrl },
  async (t) => {
    const schema = `test_${randomUUID().replaceAll("-", "")}`;
    const options = {
      databaseUrl,
      databaseSchema: schema,
      initialPassword: password,
      serveStatic: false,
    };
    const initial = await buildApp(options),
      apps = [initial];
    const pool = new pg.Pool({ connectionString: databaseUrl });
    t.after(async () => {
      await Promise.all(apps.map((app) => app.close()));
      await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
      await pool.end();
    });
    const room = await initial.store.room();
    const teacher = cookie(
      await req(initial, "POST", "/api/login", { password }),
    );
    const joined = await req(initial, "POST", "/api/join", {
      classroomId: room.id,
    });
    const student = cookie(joined),
      school = joined.json().state.schools[0];
    const send = async (app, url, body) => {
      const current = await app.store.room();
      return req(
        app,
        "POST",
        url,
        { roomId: current.id, revision: current.revision, ...body },
        teacher,
      );
    };
    await send(initial, "/api/teacher/control", { action: "page", open: true });
    await send(initial, "/api/teacher/control", {
      action: "stage",
      stage: "judge",
    });
    assert.equal(
      (
        await req(
          initial,
          "POST",
          "/api/student/submit/judge",
          { name: "并发迁移同学", school, answer: "true", activityRevision: 1 },
          student,
        )
      ).statusCode,
      200,
    );
    await initial.store.setMeta(
      `activities:${room.id}`,
      await initial.store.activitySettings(),
    );
    await initial.close();
    await pool.query(`ALTER TABLE "${schema}".submissions DROP COLUMN activity_id;
    ALTER TABLE "${schema}".submissions ADD CONSTRAINT submissions_participant_id_kind_key UNIQUE(participant_id,kind);`);
    const [a, b] = await Promise.all([buildApp(options), buildApp(options)]);
    apps.push(a, b);
    assert.equal(
      (
        await req(b, "GET", "/api/results?kind=judge", undefined, student)
      ).json().total,
      1,
    );
    const added = await send(a, "/api/teacher/activities", {
      action: "add",
      kind: "judge",
    });
    assert.equal(added.statusCode, 200, added.body);
    const id = added.json().createdActivityId,
      current = added.json().room;
    const order = added.json().activities.map((x) => x.id);
    const reordered = await Promise.all(
      [a, b].map((app) =>
        req(
          app,
          "POST",
          "/api/teacher/activities",
          {
            roomId: current.id,
            revision: current.revision,
            action: "reorder",
            order: [...order].reverse(),
          },
          teacher,
        ),
      ),
    );
    assert.deepEqual(reordered.map((x) => x.statusCode).sort(), [200, 409]);
    assert.deepEqual(
      (await b.store.activities()).map((x) => x.id),
      [...order].reverse(),
    );
    await send(a, "/api/teacher/control", { action: "stage", stage: id });
    assert.equal(
      (await req(b, "GET", `/api/results?kind=${id}`, undefined, student))
        .statusCode,
      403,
    );
    const race = await Promise.all([
      req(
        b,
        "POST",
        `/api/student/submit/${id}`,
        { answer: "false", activityRevision: 1 },
        student,
      ),
      send(a, "/api/teacher/activities", {
        action: "delete",
        id,
        confirm: true,
      }),
    ]);
    assert.ok([200, 404].includes(race[0].statusCode), race[0].body);
    assert.equal(race[1].statusCode, 200, race[1].body);
    assert.equal(
      (
        await b.store.get(
          "SELECT COUNT(*) n FROM submissions WHERE activity_id=?",
          id,
        )
      ).n,
      0,
    );
    assert.equal((await b.store.room()).stage, "waiting");
    assert.equal(
      (
        await req(
          b,
          "GET",
          `/api/results?kind=${id}&role=teacher`,
          undefined,
          teacher,
        )
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await b.store.get(
          "SELECT COUNT(*) n FROM submissions WHERE activity_id='judge'",
        )
      ).n,
      1,
    );
  },
);
