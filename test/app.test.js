import test from "node:test";
import pg from "pg";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { buildApp } from "../server/app.js";
import { hash } from "../server/store.js";

const password = "isolated-test-password-only";
const schools = JSON.parse(
  readFileSync(new URL("../config/schools.json", import.meta.url), "utf8"),
);
const school = schools[0];
const profile = (name = "测试同学") => ({ name, school });
const discovery = (name = "测试同学") => ({
  ...profile(name),
  field: "交通",
  scenario: "公交到站预测",
  value: "减少候车时间",
});
const design = {
  scenario: "校园雨天接送",
  function: "预测放学时的降雨并提醒带伞",
};
const cookie = (r) => r.headers["set-cookie"]?.split(";")[0];
function request(app, method, url, payload, session, extra = {}) {
  return app.inject({
    method,
    url,
    ...(payload === undefined ? {} : { payload }),
    headers: {
      ...(payload === undefined
        ? {}
        : { "content-type": "application/json", "x-classroom-request": "1" }),
      ...(session ? { cookie: session } : {}),
      ...extra,
    },
  });
}
async function fixture(t, options = {}) {
  if (process.env.TEST_DATABASE_URL && options.databaseUrl !== "")
    options = {
      databaseUrl: process.env.TEST_DATABASE_URL,
      databaseSchema: `test_${randomUUID().replaceAll("-", "")}`,
      ...options,
    };
  options.usePostgres = Boolean(options.databaseUrl);
  const dataDir = mkdtempSync(join(tmpdir(), "ai-workshop-test-"));
  let app = await buildApp({
    dataDir,
    initialPassword: password,
    serveStatic: false,
    ...options,
  });
  t.after(async () => {
    await app.close();
    if (options.databaseUrl) {
      const pool = new pg.Pool({ connectionString: options.databaseUrl });
      try {
        await pool.query(`DROP SCHEMA "${options.databaseSchema}" CASCADE`);
      } finally {
        await pool.end();
      }
    }
    rmSync(dataDir, { recursive: true, force: true });
  });
  const teacher = cookie(
    await request(app, "POST", "/api/login", { password }),
  );
  const student = async () => {
    const r = await request(app, "POST", "/api/join", {
      classroomId: (await app.store.room()).id,
    });
    assert.equal(r.statusCode, 200, r.body);
    return cookie(r);
  };
  const control = async (change) => {
    const room = await app.store.room();
    const r = await request(
      app,
      "POST",
      "/api/teacher/control",
      { roomId: room.id, revision: room.revision, ...change },
      teacher,
    );
    assert.equal(r.statusCode, 200, r.body);
    return r.json();
  };
  const start = async (stage = "discover") => {
    await control({ action: "page", open: true });
    return control({ action: "stage", stage });
  };
  const submit = (session, kind, body) =>
    request(app, "POST", `/api/student/submit/${kind}`, body, session);
  const board = (session, kind = "discover", query = "") =>
    request(app, "GET", `/api/board?kind=${kind}${query}`, undefined, session);
  return {
    get app() {
      return app;
    },
    dataDir,
    teacher,
    student,
    control,
    start,
    submit,
    board,
    moderate: async (ids, action = "delete", session = teacher, extra = {}) =>
      request(
        app,
        "POST",
        "/api/teacher/submissions/moderate",
        {
          roomId: (await app.store.room()).id,
          ids,
          action,
          ...extra,
        },
        session,
      ),
    restart: async () => {
      await app.close();
      app = await buildApp({
        dataDir,
        initialPassword: "should-not-replace-password",
        serveStatic: false,
        ...options,
      });
    },
  };
}

test("教师鉴权、固定课堂链接、学生隔离和同源写入", async (t) => {
  const f = await fixture(t),
    s = await f.student();
  const session = await request(f.app, "GET", "/api/session?role=teacher");
  assert.equal(session.statusCode, 200);
  assert.deepEqual(session.json(), { state: null });
  for (const url of [
    "/api/teacher/state",
    "/api/teacher/share",
    "/api/teacher/export",
    "/api/board?kind=discover",
  ])
    assert.equal((await request(f.app, "GET", url)).statusCode, 401);
  assert.equal((await f.board(s, "discover", "&role=teacher")).statusCode, 401);
  assert.equal(
    (await request(f.app, "POST", "/api/login", { password: "wrong" }))
      .statusCode,
    401,
  );
  assert.equal(
    (await request(f.app, "POST", "/api/auth/setup", { password })).statusCode,
    404,
  );
  assert.equal(
    (
      await request(
        f.app,
        "POST",
        "/api/join",
        { classroomId: (await f.app.store.room()).id },
        undefined,
        { "x-classroom-request": "" },
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await request(
        f.app,
        "POST",
        "/api/join",
        { classroomId: (await f.app.store.room()).id },
        undefined,
        { origin: "https://unrelated.example" },
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await request(f.app, "POST", "/api/join", {
        classroomId: "unknown-classroom",
      })
    ).statusCode,
    404,
  );
  assert.match(
    (await request(f.app, "GET", "/api/student/state", undefined, s)).headers[
      "set-cookie"
    ],
    /HttpOnly; SameSite=Strict/,
  );
});

test("页面总开关与课前等候阻止提交和读取同学分享", async (t) => {
  const f = await fixture(t),
    s = await f.student();
  assert.equal((await f.app.store.room()).pageOpen, false);
  assert.equal((await f.app.store.room()).stage, "waiting");
  assert.equal((await f.submit(s, "discover", discovery())).statusCode, 409);
  assert.equal((await f.board(s)).statusCode, 403);
  await f.control({ action: "stage", stage: "discover" });
  assert.equal((await f.submit(s, "discover", discovery())).statusCode, 409);
  await f.control({ action: "page", open: true });
  assert.equal((await f.submit(s, "discover", discovery())).statusCode, 200);
  assert.equal((await f.board(s)).statusCode, 200);
  await f.control({ action: "page", open: false });
  assert.equal((await f.board(s)).statusCode, 403);
  assert.equal(
    (await f.board(f.teacher, "discover", "&role=teacher")).json().total,
    1,
  );
  await f.control({ action: "page", open: true });
  assert.equal((await f.board(s)).json().total, 1);
});

test("先提交再看：未提交者不能经列表、搜索、分页或状态接口读取他人内容", async (t) => {
  const f = await fixture(t),
    a = await f.student(),
    b = await f.student();
  await f.start();
  const answer = {
    ...discovery("学生甲"),
    scenario: "只有提交后才能看到的独立想法",
  };
  assert.equal((await f.submit(a, "discover", answer)).statusCode, 200);
  for (const suffix of ["", "&q=学生甲", "&page=2"])
    assert.equal((await f.board(b, "discover", suffix)).statusCode, 403);
  const state = await request(f.app, "GET", "/api/student/state", undefined, b);
  assert.ok(!state.body.includes(answer.scenario));
  assert.ok(!state.body.includes(answer.name));
  const session = await request(
    f.app,
    "GET",
    "/api/session?role=student",
    undefined,
    b,
  );
  assert.ok(!session.body.includes(answer.scenario));
  assert.equal(
    (await f.submit(b, "discover", discovery("学生乙"))).statusCode,
    200,
  );
  assert.equal((await f.board(b)).json().total, 2);
  assert.ok(
    (await f.board(b)).json().rows.some((r) => r.scenario === answer.scenario),
  );
});

test("老师切换主题后所有人同步，未交第一份也能直接提交设计并首次填写身份", async (t) => {
  const f = await fixture(t),
    a = await f.student(),
    b = await f.student();
  await f.start();
  await f.submit(a, "discover", discovery("学生甲"));
  await f.control({ action: "stage", stage: "design" });
  for (const session of [a, b]) {
    const state = (
      await request(f.app, "GET", "/api/student/state", undefined, session)
    ).json();
    assert.equal(state.room.stage, "design");
    assert.equal(state.room.discoverOpen, false);
    assert.equal(state.room.designOpen, true);
    assert.equal((await f.board(session, "design")).statusCode, 403);
    assert.equal((await f.board(session, "discover")).statusCode, 403);
  }
  assert.equal(
    (await f.submit(b, "discover", discovery("学生乙"))).statusCode,
    409,
  );
  assert.equal((await f.submit(a, "design", design)).statusCode, 200);
  assert.equal(
    (await f.submit(b, "design", { ...design, ...profile("学生乙") }))
      .statusCode,
    200,
  );
  const board = (await f.board(b, "design")).json();
  assert.equal(board.total, 2);
  assert.equal(board.rows.find((r) => r.name === "学生甲").school, school);
  const state = (
    await request(f.app, "GET", "/api/student/state", undefined, b)
  ).json();
  assert.equal(state.submissions.discover, undefined);
  assert.ok(state.submissions.design);
});

test("每个主题独立解锁，老师回到上一主题时恢复原来的提交状态", async (t) => {
  const f = await fixture(t),
    a = await f.student();
  await f.start("design");
  await f.submit(a, "design", { ...design, ...profile("先到设计") });
  await f.control({ action: "stage", stage: "discover" });
  assert.equal((await f.board(a, "discover")).statusCode, 403);
  assert.equal((await f.board(a, "design")).statusCode, 403);
  const { name, school: omitted, ...answer } = discovery();
  assert.equal((await f.submit(a, "discover", answer)).statusCode, 200);
  assert.equal((await f.board(a)).json().rows[0].name, "先到设计");
  await f.control({ action: "stage", stage: "design" });
  assert.equal((await f.board(a, "design")).json().total, 1);
});

test("暂停和恢复填写：暂停不泄露未解锁分享，也不隐藏已经解锁的分享", async (t) => {
  const f = await fixture(t),
    a = await f.student(),
    b = await f.student();
  await f.start();
  await f.submit(a, "discover", discovery("学生甲"));
  await f.control({ action: "pause", paused: true });
  assert.equal(
    (await f.submit(b, "discover", discovery("学生乙"))).statusCode,
    409,
  );
  assert.equal((await f.board(b)).statusCode, 403);
  assert.equal((await f.board(a)).statusCode, 200);
  await f.control({ action: "pause", paused: false });
  assert.equal(
    (await f.submit(b, "discover", discovery("学生乙"))).statusCode,
    200,
  );
});

test("结束课堂关闭学生写入和分享，老师保留记录且不能重开已结束主题", async (t) => {
  const f = await fixture(t),
    a = await f.student(),
    b = await f.student();
  await f.start();
  await f.submit(a, "discover", discovery());
  await f.control({ action: "end" });
  assert.equal((await f.app.store.room()).stage, "ended");
  assert.equal((await f.submit(b, "discover", discovery())).statusCode, 409);
  assert.equal((await f.board(a)).statusCode, 403);
  assert.equal(
    (await f.board(f.teacher, "discover", "&role=teacher")).json().total,
    1,
  );
  const lateJoin = await request(f.app, "POST", "/api/join", {
    classroomId: (await f.app.store.room()).id,
  });
  assert.equal(lateJoin.statusCode, 200);
  assert.deepEqual(lateJoin.json(), { state: null, ended: true });
  assert.equal(lateJoin.headers["set-cookie"], undefined);
  const room = await f.app.store.room();
  assert.equal(
    (
      await request(
        f.app,
        "POST",
        "/api/teacher/control",
        {
          roomId: room.id,
          revision: room.revision,
          action: "stage",
          stage: "design",
        },
        f.teacher,
      )
    ).statusCode,
    409,
  );
});

test("重复并发提交与关闭后的成功请求重试不重复计数", async (t) => {
  const f = await fixture(t),
    a = await f.student();
  await f.start();
  const responses = await Promise.all(
    Array.from({ length: 10 }, () => f.submit(a, "discover", discovery())),
  );
  responses.forEach((r) => assert.equal(r.statusCode, 200));
  assert.equal((await f.app.store.counts()).discover, 1);
  await f.control({ action: "page", open: false });
  assert.equal(
    (await f.submit(a, "discover", discovery())).json().repeated,
    true,
  );
  assert.equal(
    (await f.submit(a, "discover", { ...discovery(), value: "改写" }))
      .statusCode,
    409,
  );
});

test("学校、必填、长度及身份变更由服务端校验", async (t) => {
  const f = await fixture(t),
    a = await f.student();
  await f.start();
  for (const patch of [
    { school: "未列出学校" },
    { name: " " },
    { field: "" },
    { scenario: 42 },
    { value: "文".repeat(501) },
  ])
    assert.equal(
      (await f.submit(a, "discover", { ...discovery(), ...patch })).statusCode,
      400,
    );
  assert.equal((await f.app.store.counts()).discover, 0);
  assert.equal((await f.submit(a, "unknown", {})).statusCode, 404);
  await f.submit(a, "discover", discovery());
  await f.control({ action: "stage", stage: "design" });
  for (const name of [null, 123, "其他名字"])
    assert.equal(
      (await f.submit(a, "design", { ...design, name })).statusCode,
      409,
    );
  assert.equal((await f.submit(a, "design", design)).statusCode, 200);
});

test("过期的教师控制请求不能覆盖新的课堂节奏", async (t) => {
  const f = await fixture(t);
  const stale = await f.app.store.room();
  await f.start();
  assert.equal(
    (
      await request(
        f.app,
        "POST",
        "/api/teacher/control",
        {
          roomId: stale.id,
          revision: stale.revision,
          action: "stage",
          stage: "design",
        },
        f.teacher,
      )
    ).statusCode,
    409,
  );
  assert.equal((await f.app.store.room()).stage, "discover");
  const current = await f.app.store.room();
  assert.equal(
    (
      await request(
        f.app,
        "POST",
        "/api/teacher/control",
        {
          roomId: current.id,
          revision: current.revision,
          action: "page",
          open: "false",
        },
        f.teacher,
      )
    ).statusCode,
    400,
  );
});

test("重启恢复课堂主题、暂停状态、身份、登录和两份记录", async (t) => {
  const f = await fixture(t),
    a = await f.student();
  await f.start();
  await f.submit(a, "discover", discovery());
  await f.control({ action: "stage", stage: "design" });
  await f.submit(a, "design", design);
  await f.control({ action: "pause", paused: true });
  const room = await f.app.store.room();
  await f.restart();
  assert.deepEqual(await f.app.store.room(), room);
  const state = (
    await request(f.app, "GET", "/api/student/state", undefined, a)
  ).json();
  assert.equal(Object.keys(state.submissions).length, 2);
  assert.equal(state.me.name, "测试同学");
  assert.equal((await f.board(a, "design")).statusCode, 200);
  assert.equal(
    (await request(f.app, "GET", "/api/teacher/state", undefined, f.teacher))
      .statusCode,
    200,
  );
  assert.equal(
    (await request(f.app, "POST", "/api/login", { password })).statusCode,
    200,
  );
});

test("开始新课隔离旧学生和控制请求，旧记录仍保留", async (t) => {
  const f = await fixture(t),
    a = await f.student(),
    old = await f.app.store.room();
  await f.start();
  await f.submit(a, "discover", discovery());
  assert.equal(
    (
      await request(
        f.app,
        "POST",
        "/api/teacher/new-room",
        { roomId: old.id },
        f.teacher,
      )
    ).statusCode,
    409,
  );
  await f.control({ action: "end" });
  assert.equal(
    (
      await request(
        f.app,
        "POST",
        "/api/teacher/new-room",
        { roomId: old.id },
        f.teacher,
      )
    ).statusCode,
    200,
  );
  assert.notEqual((await f.app.store.room()).id, old.id);
  assert.equal((await f.app.store.room()).stage, "waiting");
  assert.equal((await f.app.store.room()).pageOpen, false);
  assert.equal(
    (await request(f.app, "GET", "/api/student/state", undefined, a))
      .statusCode,
    401,
  );
  assert.equal((await f.board(a)).statusCode, 401);
  assert.equal((await f.app.store.counts()).discover, 0);
  assert.equal(
    (await f.app.store.get("SELECT COUNT(*) n FROM submissions")).n,
    1,
  );
  assert.equal(
    (
      await request(
        f.app,
        "POST",
        "/api/teacher/control",
        { roomId: old.id, revision: 0, action: "stage", stage: "design" },
        f.teacher,
      )
    ).statusCode,
    409,
  );
});

test("500 个同出口参与端随老师完成 1000 次提交，分页和搜索完整", async (t) => {
  const f = await fixture(t);
  await f.start();
  const students = await Promise.all(
    Array.from({ length: 500 }, () => f.student()),
  );
  await Promise.all(
    students.map(async (s, i) =>
      assert.equal(
        (
          await f.submit(
            s,
            "discover",
            discovery(`同学${String(i).padStart(3, "0")}`),
          )
        ).statusCode,
        200,
      ),
    ),
  );
  await f.control({ action: "stage", stage: "design" });
  await Promise.all(
    students.map(async (s) =>
      assert.equal((await f.submit(s, "design", design)).statusCode, 200),
    ),
  );
  assert.deepEqual(await f.app.store.counts(), {
    joined: 500,
    discover: 500,
    design: 500,
  });
  const ids = new Set();
  for (let page = 1; page <= 10; page++) {
    const result = (
      await f.board(students[0], "design", `&page=${page}`)
    ).json();
    assert.equal(result.total, 500);
    assert.equal(result.rows.length, 50);
    result.rows.forEach((r) => {
      assert.equal(r.token, undefined);
      assert.equal(r.expires, undefined);
      ids.add(r.id);
    });
  }
  assert.equal(ids.size, 500);
  const filtered = (
    await f.board(students[0], "design", "&q=" + encodeURIComponent("同学001"))
  ).json();
  assert.equal(filtered.total, 1);
  assert.equal(filtered.rows[0].name, "同学001");
  assert.equal(
    (await f.board(students[0], "design", "&page=-1")).statusCode,
    400,
  );
});

test("教师按主题、学校和关键词组合筛选，删除后任何列表均不返回原内容", async (t) => {
  const f = await fixture(t),
    a = await f.student(),
    b = await f.student(),
    c = await f.student();
  await f.start();
  await f.submit(a, "discover", discovery("甲同学"));
  await f.submit(b, "discover", { ...discovery("乙同学"), school: schools[1] });
  await f.submit(c, "discover", {
    ...discovery("丙同学"),
    scenario: "植物识别",
  });
  await f.control({ action: "stage", stage: "design" });
  await f.submit(a, "design", design);
  await f.control({ action: "stage", stage: "discover" });
  const filtered = (
    await f.board(
      f.teacher,
      "discover",
      `&role=teacher&school=${encodeURIComponent(school)}&q=${encodeURIComponent("公交")}`,
    )
  ).json();
  assert.deepEqual(
    filtered.rows.map((row) => row.name),
    ["甲同学"],
  );
  assert.equal(
    (await f.board(f.teacher, "design", "&role=teacher")).json().total,
    1,
  );
  const id = filtered.rows[0].id;
  assert.equal((await f.moderate([id])).statusCode, 200);
  assert.equal(
    (await f.board(f.teacher, "discover", "&role=teacher")).json().total,
    2,
  );
  const removed = (
    await f.board(
      f.teacher,
      "discover",
      `&role=teacher&school=${encodeURIComponent(school)}&q=${encodeURIComponent("甲同学")}`,
    )
  ).json();
  assert.equal(removed.total, 0);
  for (const query of [
    "&status=deleted",
    "&role=teacher&status=deleted",
    `&school=${encodeURIComponent(school)}`,
  ])
    assert.ok(
      [401, 403].includes((await f.board(a, "discover", query)).statusCode),
    );
  assert.equal(
    (await f.board(f.teacher, "discover", "&role=teacher&status=unknown"))
      .statusCode,
    400,
  );
});

test("删除清除正文并隐藏学生内容、搜索、数量和导出，重启后也不能重交或恢复", async (t) => {
  const f = await fixture(t),
    a = await f.student(),
    b = await f.student(),
    locked = await f.student();
  await f.start();
  const answer = { ...discovery("甲同学"), scenario: "应隐藏的独有内容" };
  await f.submit(a, "discover", answer);
  await f.submit(b, "discover", discovery("乙同学"));
  const id = (
    await f.board(a, "discover", `&q=${encodeURIComponent("甲同学")}`)
  ).json().rows[0].id;
  assert.deepEqual((await f.moderate([id])).json(), { ok: true, changed: 1 });
  assert.equal((await f.moderate([id])).json().changed, 0);
  for (const session of [a, b]) {
    const list = await f.board(session);
    assert.equal(list.json().total, 1);
    assert.ok(!list.body.includes(answer.scenario));
    assert.equal(
      (
        await f.board(
          session,
          "discover",
          `&q=${encodeURIComponent(answer.scenario)}`,
        )
      ).json().total,
      0,
    );
  }
  assert.equal((await f.board(locked)).statusCode, 403);
  const beforeRestart = await request(
    f.app,
    "GET",
    "/api/student/state",
    undefined,
    a,
  );
  const saved = beforeRestart.json().submissions.discover;
  assert.deepEqual(Object.keys(saved).sort(), ["createdAt", "removed"]);
  assert.equal(saved.removed, true);
  assert.ok(!beforeRestart.body.includes(answer.scenario));
  assert.equal(beforeRestart.json().counts.discover, 1);
  assert.equal((await f.submit(a, "discover", answer)).statusCode, 409);
  assert.equal(
    (await f.submit(a, "discover", { ...answer, scenario: "绕过删除" }))
      .statusCode,
    409,
  );
  const csv = await request(
    f.app,
    "GET",
    "/api/teacher/export",
    undefined,
    f.teacher,
  );
  assert.ok(!csv.body.includes(answer.scenario));
  assert.ok(csv.body.includes("乙同学"));
  assert.equal(
    (await f.app.store.get("SELECT content FROM submissions WHERE id=?", id))
      .content,
    "{}",
  );
  await f.restart();
  assert.equal((await f.board(b)).json().total, 1);
  assert.equal((await f.moderate([id], "restore")).statusCode, 400);
  assert.equal((await f.submit(a, "discover", answer)).statusCode, 409);
  const restarted = (
    await request(f.app, "GET", "/api/student/state", undefined, a)
  ).json();
  assert.equal(restarted.submissions.discover.scenario, undefined);
  assert.equal(restarted.submissions.discover.removed, true);
  assert.equal(restarted.counts.discover, 1);
  assert.equal(
    (await f.app.store.get("SELECT content FROM submissions WHERE id=?", id))
      .content,
    "{}",
  );
  assert.equal(
    (await f.board(f.teacher, "discover", "&role=teacher&status=deleted"))
      .statusCode,
    400,
  );
});

test("批量管理校验教师权限、同源、数量和课堂归属，错误时整批不改变", async (t) => {
  const f = await fixture(t),
    oldStudent = await f.student();
  await f.start();
  await f.submit(oldStudent, "discover", discovery("旧课堂"));
  const oldId = (await f.board(oldStudent)).json().rows[0].id;
  const oldRoomId = (await f.app.store.room()).id;
  await f.control({ action: "page", open: false });
  await request(
    f.app,
    "POST",
    "/api/teacher/new-room",
    { roomId: oldRoomId },
    f.teacher,
  );
  const s = await f.student();
  await f.start();
  await f.submit(s, "discover", discovery());
  const id = (await f.board(s)).json().rows[0].id;
  for (const session of [s, ""])
    for (const action of ["delete", "restore"])
      assert.equal((await f.moderate([id], action, session)).statusCode, 401);
  for (const ids of [
    [],
    [id, id],
    ["1"],
    [0],
    [1.2],
    Array.from({ length: 51 }, (_, i) => i + 1),
  ])
    assert.equal((await f.moderate(ids)).statusCode, 400);
  assert.equal((await f.moderate([id], "purge")).statusCode, 400);
  assert.equal(
    (await f.moderate([id], "delete", f.teacher, { roomId: oldRoomId }))
      .statusCode,
    409,
  );
  assert.equal((await f.moderate([id, oldId])).statusCode, 409);
  assert.equal((await f.moderate([id, 999999])).statusCode, 409);
  assert.equal(
    (
      await request(
        f.app,
        "POST",
        "/api/teacher/submissions/moderate",
        {
          roomId: (await f.app.store.room()).id,
          ids: [id],
          action: "delete",
        },
        f.teacher,
        { origin: "https://other.example" },
      )
    ).statusCode,
    403,
  );
  assert.equal((await f.board(s)).json().total, 1);
  assert.equal(
    (
      await f.app.store.get(
        "SELECT COUNT(*) n FROM submissions WHERE deleted_at IS NOT NULL",
      )
    ).n,
    0,
  );
  assert.equal(
    (
      await f.app.store.get(
        "SELECT deleted_at FROM submissions WHERE id=?",
        oldId,
      )
    ).deleted_at,
    null,
  );
});

test("批量删除只清除选中记录的正文，分页在删除末页后回到有效页", async (t) => {
  const f = await fixture(t);
  await f.start();
  for (let i = 0; i < 52; i++) {
    const s = await f.student();
    assert.equal(
      (await f.submit(s, "discover", discovery(`分页同学${i}`))).statusCode,
      200,
    );
  }
  const first = (await f.board(f.teacher, "discover", "&role=teacher")).json();
  const last = (
    await f.board(f.teacher, "discover", "&role=teacher&page=2")
  ).json();
  assert.equal(last.rows.length, 2);
  assert.equal(
    (await f.moderate(last.rows.map((row) => row.id))).json().changed,
    2,
  );
  const clamped = (
    await f.board(f.teacher, "discover", "&role=teacher&page=2")
  ).json();
  assert.equal(clamped.page, 1);
  assert.equal(clamped.total, 50);
  assert.deepEqual(
    clamped.rows.map((row) => row.id),
    first.rows.map((row) => row.id),
  );
  assert.equal(
    (await f.moderate(first.rows.map((row) => row.id))).json().changed,
    50,
  );
  assert.equal(
    (await f.board(f.teacher, "discover", "&role=teacher")).json().total,
    0,
  );
  assert.equal(
    (
      await f.app.store.get(
        "SELECT COUNT(*) n FROM submissions WHERE content!='{}'",
      )
    ).n,
    0,
  );
  assert.equal(
    (
      await f.app.store.get(
        "SELECT COUNT(*) n FROM submissions WHERE deleted_at IS NOT NULL",
      )
    ).n,
    52,
  );
});

test("CSV 导出包含中文、换行和两阶段记录，并转义公式", async (t) => {
  const f = await fixture(t),
    s = await f.student();
  await f.start();
  await f.submit(s, "discover", {
    ...discovery("=1+1"),
    scenario: "第一行\n第二行",
    value: '有"帮助",真的',
  });
  await f.control({ action: "stage", stage: "design" });
  await f.submit(s, "design", design);
  await f.control({ action: "end" });
  const r = await request(
    f.app,
    "GET",
    "/api/teacher/export",
    undefined,
    f.teacher,
  );
  assert.equal(r.statusCode, 200);
  assert.ok(r.body.startsWith("\uFEFF"));
  assert.match(r.body, /"'=1\+1"/);
  assert.match(r.body, /"第一行\n第二行"/);
  assert.match(r.body, /"有""帮助"",真的"/);
  assert.match(r.body, /一起设计/);
  assert.equal(
    (await request(f.app, "GET", "/api/teacher/export", undefined, s))
      .statusCode,
    401,
  );
});

test("学生不能控制课堂，教师退出后会话失效", async (t) => {
  const f = await fixture(t),
    s = await f.student(),
    room = await f.app.store.room();
  assert.equal(
    (
      await request(
        f.app,
        "POST",
        "/api/teacher/control",
        {
          roomId: room.id,
          revision: room.revision,
          action: "page",
          open: true,
        },
        s,
      )
    ).statusCode,
    401,
  );
  assert.equal(
    (await request(f.app, "POST", "/api/logout", {}, f.teacher)).statusCode,
    200,
  );
  assert.equal(
    (await request(f.app, "GET", "/api/teacher/state", undefined, f.teacher))
      .statusCode,
    401,
  );
});

test("学校配置可替换，错误配置使服务停止启动", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ai-schools-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "schools.json");
  writeFileSync(file, "[]");
  await assert.rejects(
    buildApp({ dataDir: dir, schoolsFile: file, serveStatic: false }),
    /学校配置/,
  );
  writeFileSync(file, JSON.stringify(["第一学校", "第二学校", "第一学校"]));
  const app = await buildApp({
    dataDir: dir,
    schoolsFile: file,
    usePostgres: false,
    serveStatic: false,
    initialPassword: password,
  });
  try {
    const r = await request(app, "POST", "/api/join", {
      classroomId: (await app.store.room()).id,
    });
    assert.deepEqual(r.json().state.schools, ["第一学校", "第二学校"]);
  } finally {
    await app.close();
  }
});

test("旧数据库迁移保留课堂、学生与作品，两个旧开关同时开放时进入设计", async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "ai-migration-test-"));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const db = new DatabaseSync(join(dataDir, "classroom.sqlite"));
  db.exec(`CREATE TABLE rooms(id TEXT PRIMARY KEY,code TEXT UNIQUE NOT NULL,discover_open INTEGER NOT NULL DEFAULT 0,design_open INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL);
    CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE participants(id TEXT PRIMARY KEY,room_id TEXT NOT NULL REFERENCES rooms(id),token TEXT UNIQUE NOT NULL,name TEXT NOT NULL DEFAULT '',school TEXT NOT NULL DEFAULT '',expires INTEGER NOT NULL);
    CREATE TABLE submissions(id INTEGER PRIMARY KEY AUTOINCREMENT,room_id TEXT NOT NULL REFERENCES rooms(id),participant_id TEXT NOT NULL REFERENCES participants(id),kind TEXT NOT NULL,content TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(participant_id,kind));`);
  db.prepare("INSERT INTO rooms VALUES (?,?,?,?,?)").run(
    "legacy-room",
    "123456",
    1,
    1,
    Date.now(),
  );
  db.prepare("INSERT INTO meta VALUES (?,?)").run(
    "current",
    JSON.stringify("legacy-room"),
  );
  db.prepare("INSERT INTO participants VALUES (?,?,?,?,?,?)").run(
    "legacy-student",
    "legacy-room",
    hash("legacy-test-cookie"),
    "旧同学",
    school,
    Date.now() + 86400000,
  );
  db.prepare(
    "INSERT INTO submissions(room_id,participant_id,kind,content,created_at) VALUES (?,?,?,?,?)",
  ).run(
    "legacy-room",
    "legacy-student",
    "discover",
    JSON.stringify({ field: "交通", scenario: "保留的旧作品", value: "价值" }),
    Date.now(),
  );
  db.close();
  const app = await buildApp({
    dataDir,
    usePostgres: false,
    serveStatic: false,
    initialPassword: password,
  });
  try {
    assert.equal((await app.store.room()).id, "legacy-room");
    assert.equal((await app.store.room()).stage, "design");
    assert.equal((await app.store.room()).pageOpen, true);
    assert.equal((await app.store.room()).discoverOpen, false);
    const state = (
      await request(
        app,
        "GET",
        "/api/student/state",
        undefined,
        "workshop_student=legacy-test-cookie",
      )
    ).json();
    assert.equal(state.me.name, "旧同学");
    assert.equal(state.submissions.discover.scenario, "保留的旧作品");
    assert.equal(
      (await app.store.get("SELECT deleted_at FROM submissions")).deleted_at,
      null,
    );
    assert.equal((await app.store.counts()).discover, 1);
    assert.equal("code" in state.room, false);
  } finally {
    await app.close();
  }
});

test(
  "真实 HTTP SSE 通知提交、删除及主题切换，断线后的状态仍受阅读门槛保护",
  { timeout: 15000 },
  async (t) => {
    const f = await fixture(t, { databaseUrl: "" }),
      a = await f.student(),
      b = await f.student();
    await f.start();
    await f.app.listen({ port: 0, host: "127.0.0.1" });
    const base = `http://127.0.0.1:${f.app.server.address().port}`;
    const abort = new AbortController();
    const response = await fetch(base + "/api/events?role=student", {
      headers: { cookie: b },
      signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]),
    });
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    async function until(text) {
      let content = "";
      while (!content.includes(text)) {
        const chunk = await reader.read();
        if (chunk.done) throw Error("SSE 提前关闭");
        content += decoder.decode(chunk.value);
      }
    }
    try {
      await until("event: ready");
      await f.submit(a, "discover", discovery("学生甲"));
      await until("event: update");
      assert.equal(
        (
          await fetch(base + "/api/board?kind=discover", {
            headers: { cookie: b },
          })
        ).status,
        403,
      );
      await f.submit(b, "discover", discovery("学生乙"));
      assert.equal((await f.board(b)).json().total, 2);
      await until("event: update");
      const id = (await f.board(b)).json().rows[0].id;
      await f.moderate([id]);
      await until("event: update");
      assert.equal((await f.board(b)).json().total, 1);
      await f.control({ action: "stage", stage: "design" });
      await until("event: update");
      const state = await fetch(base + "/api/student/state", {
        headers: { cookie: b },
      });
      assert.equal((await state.json()).room.stage, "design");
      assert.equal((await f.board(b, "design")).statusCode, 403);
    } finally {
      await reader.cancel();
      abort.abort();
    }
  },
);

test(
  "教师实时连接通过鉴权后立即发送事件及心跳，注销时关闭连接",
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t, { databaseUrl: "" }),
      student = await f.student();
    await f.app.listen({ port: 0, host: "127.0.0.1" });
    const base = `http://127.0.0.1:${f.app.server.address().port}`;
    for (const session of ["", student]) {
      const denied = await fetch(base + "/api/events?role=teacher", {
        headers: { cookie: session },
      });
      assert.equal(denied.status, 401);
    }
    const response = await fetch(base + "/api/events?role=teacher", {
      headers: { cookie: f.teacher, "accept-encoding": "gzip" },
      signal: AbortSignal.timeout(27000),
    });
    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("content-type"),
      "text/event-stream; charset=utf-8",
    );
    assert.equal(response.headers.get("content-encoding"), "identity");
    assert.equal(response.headers.get("x-accel-buffering"), "no");
    assert.match(response.headers.get("cache-control"), /no-store/);
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    try {
      const first = await reader.read();
      assert.match(decoder.decode(first.value), /event: ready/);
      let content = "";
      while (!content.includes("event: heartbeat")) {
        const next = await reader.read();
        assert.equal(next.done, false);
        content += decoder.decode(next.value);
      }
      await request(f.app, "POST", "/api/logout", {}, f.teacher);
      assert.equal((await reader.read()).done, true);
    } finally {
      await reader.cancel();
    }
  },
);

test("HTTPS 代理下分享使用浏览器实际地址，固定 PUBLIC_URL 优先且拒绝畸形地址", async (t) => {
  const f = await fixture(t);
  const share = await request(
    f.app,
    "GET",
    "/api/teacher/share?origin=https%3A%2F%2Fclassroom.example.edu",
    undefined,
    f.teacher,
    { host: "internal:3218" },
  );
  assert.equal(
    share.json().url,
    `https://classroom.example.edu/classroom/${(await f.app.store.room()).id}`,
  );
  for (const origin of [
    "javascript:alert(1)",
    "https://user:secret@example.edu",
    "https://example.edu/path",
    "https://example.edu/?q=1",
    "invalid",
  ]) {
    assert.equal(
      (
        await request(
          f.app,
          "GET",
          `/api/teacher/share?origin=${encodeURIComponent(origin)}`,
          undefined,
          f.teacher,
        )
      ).statusCode,
      400,
    );
  }
  const fixed = await fixture(t, { publicUrl: "https://students.example.edu" });
  const result = await request(
    fixed.app,
    "GET",
    "/api/teacher/share?origin=https%3A%2F%2Fteacher.example.edu",
    undefined,
    fixed.teacher,
  );
  assert.equal(
    result.json().url,
    `https://students.example.edu/classroom/${(await fixed.app.store.room()).id}`,
  );
});

test("另一份数据库生成的课堂链接不会被悄悄替换为当前课堂", async (t) => {
  const source = await fixture(t),
    deployed = await fixture(t);
  const originalId = (await source.app.store.room()).id;
  const invalid = await request(deployed.app, "POST", "/api/join", {
    classroomId: originalId,
  });
  assert.equal(invalid.statusCode, 404);
  assert.match(invalid.json().error, /当前网站找不到这节课堂/);
  assert.equal((await deployed.app.store.counts()).joined, 0);
  const valid = await request(deployed.app, "POST", "/api/join", {
    classroomId: (await deployed.app.store.room()).id,
  });
  assert.equal(valid.statusCode, 200);
  assert.equal(
    valid.json().state.room.id,
    (await deployed.app.store.room()).id,
  );
});

test("固定学生链接在反复复制、切换、暂停、关闭、结束和服务重启后保持不变", async (t) => {
  const f = await fixture(t);
  const share = async () => {
    const response = await request(
      f.app,
      "GET",
      "/api/teacher/share",
      undefined,
      f.teacher,
    );
    assert.equal(response.statusCode, 200);
    return response.json();
  };
  const first = await share();
  assert.equal(
    new URL(first.url).pathname,
    `/classroom/${(await f.app.store.room()).id}`,
  );
  assert.equal(new URL(first.url).search, "");
  assert.match(first.qr, /^data:image\/png;base64,/);
  assert.equal((await f.app.store.room()).code, undefined);
  for (const url of ["/", "/?source=shared"]) {
    for (const session of [undefined, f.teacher]) {
      const root = await request(f.app, "GET", url, undefined, session);
      assert.equal(root.statusCode, 302);
      assert.equal(root.headers.location, "/teacher");
      assert.equal(root.headers["cache-control"], "no-store");
      assert.equal(root.headers["set-cookie"], undefined);
    }
  }
  assert.equal((await f.app.store.counts()).joined, 0);
  for (const change of [
    { action: "page", open: true },
    { action: "stage", stage: "discover" },
    { action: "stage", stage: "design" },
    { action: "pause", paused: true },
    { action: "page", open: false },
    { action: "end" },
  ]) {
    await f.control(change);
    assert.deepEqual(await share(), first);
  }
  await f.restart();
  assert.deepEqual(await share(), first);
});

test("按链接自动加入复用身份，无效链接和结束链接不创建参与者", async (t) => {
  const f = await fixture(t),
    classroomId = (await f.app.store.room()).id;
  for (const payload of [
    {},
    { code: "123456" },
    { classroomId: null },
    { classroomId: 123 },
    { classroomId: "missing" },
  ]) {
    assert.equal(
      (await request(f.app, "POST", "/api/join", payload)).statusCode,
      404,
    );
  }
  assert.equal((await f.app.store.counts()).joined, 0);
  const first = await request(f.app, "POST", "/api/join", { classroomId });
  const s = cookie(first);
  assert.equal(first.json().state.room.id, classroomId);
  const again = await request(f.app, "POST", "/api/join", { classroomId }, s);
  assert.equal(again.json().state.me.id, first.json().state.me.id);
  assert.equal(cookie(again), s);
  assert.equal((await f.app.store.counts()).joined, 1);
  await f.control({ action: "end" });
  assert.deepEqual(
    (await request(f.app, "POST", "/api/join", { classroomId })).json(),
    { state: null, ended: true },
  );
  assert.equal((await f.app.store.counts()).joined, 1);
  assert.equal(
    (await request(f.app, "POST", "/api/join", { classroomId }, s)).json().state
      .room.stage,
    "ended",
  );
});

test("创建新课堂后旧链接仍显示结束，已有新课堂 Cookie 也不能串入旧链接", async (t) => {
  const f = await fixture(t),
    old = await f.app.store.room();
  const oldStudent = await f.student();
  await f.start();
  await f.submit(oldStudent, "discover", discovery());
  await f.control({ action: "end" });
  const next = await request(
    f.app,
    "POST",
    "/api/teacher/new-room",
    { roomId: old.id },
    f.teacher,
  );
  const current = next.json().room;
  assert.notEqual(current.id, old.id);
  assert.equal((await f.app.store.room(old.id)).stage, "ended");
  const s = await f.student();
  await f.start();
  await f.submit(s, "discover", discovery("新课堂学生"));
  const oldSession = await request(
    f.app,
    "GET",
    `/api/session?role=student&classroomId=${old.id}`,
    undefined,
    s,
  );
  assert.deepEqual(oldSession.json(), { state: null });
  const oldJoin = await request(
    f.app,
    "POST",
    "/api/join",
    { classroomId: old.id },
    s,
  );
  assert.deepEqual(oldJoin.json(), { state: null, ended: true });
  assert.equal(oldJoin.headers["set-cookie"], undefined);
  assert.equal((await f.app.store.counts()).joined, 1);
  assert.equal(
    (await f.board(s, "discover", `&classroomId=${old.id}`)).statusCode,
    401,
  );
  assert.equal(
    (
      await request(
        f.app,
        "POST",
        `/api/student/submit/design?classroomId=${old.id}`,
        design,
        s,
      )
    ).statusCode,
    401,
  );
  const currentSession = await request(
    f.app,
    "GET",
    `/api/session?role=student&classroomId=${current.id}`,
    undefined,
    s,
  );
  assert.equal(currentSession.json().state.me.name, "新课堂学生");
  assert.equal(
    (await f.app.store.get("SELECT COUNT(*) n FROM submissions")).n,
    2,
  );
});

test("旧版已经发出的链接自动跳到原课堂，新课堂和重启不改变对应关系", async (t) => {
  const f = await fixture(t),
    old = await f.app.store.room();
  await f.app.store.run("UPDATE rooms SET code=? WHERE id=?", "123456", old.id);
  const resolve = () => request(f.app, "GET", "/?code=123456");
  assert.equal((await resolve()).headers.location, `/classroom/${old.id}`);
  await request(
    f.app,
    "POST",
    "/api/teacher/new-room",
    { roomId: old.id },
    f.teacher,
  );
  await f.restart();
  assert.equal((await resolve()).headers.location, `/classroom/${old.id}`);
  assert.equal(
    (await request(f.app, "GET", "/?code=wrong")).headers.location,
    "/classroom/unavailable",
  );
  const currentShare = await request(
    f.app,
    "GET",
    "/api/teacher/share",
    undefined,
    f.teacher,
  );
  assert.notEqual(
    new URL(currentShare.json().url).pathname,
    `/classroom/${old.id}`,
  );
});
