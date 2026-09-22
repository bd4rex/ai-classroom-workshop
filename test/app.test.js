import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { buildApp } from "../server/app.js";
import { hash } from "../server/store.js";

const password = "isolated-test-password-only";
const school = JSON.parse(
  readFileSync(new URL("../config/schools.json", import.meta.url), "utf8"),
)[0];
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
async function fixture(t) {
  const dataDir = mkdtempSync(join(tmpdir(), "ai-workshop-test-"));
  let app = await buildApp({
    dataDir,
    initialPassword: password,
    serveStatic: false,
  });
  t.after(async () => {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  const teacher = cookie(
    await request(app, "POST", "/api/login", { password }),
  );
  const student = async () => {
    const r = await request(app, "POST", "/api/join", {
      code: app.store.room().code,
    });
    assert.equal(r.statusCode, 200, r.body);
    return cookie(r);
  };
  const control = async (change) => {
    const room = app.store.room();
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
    restart: async () => {
      await app.close();
      app = await buildApp({
        dataDir,
        initialPassword: "should-not-replace-password",
        serveStatic: false,
      });
    },
  };
}

test("教师鉴权、课堂码、学生隔离和同源写入", async (t) => {
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
        { code: f.app.store.room().code },
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
        { code: f.app.store.room().code },
        undefined,
        { origin: "https://unrelated.example" },
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (await request(f.app, "POST", "/api/join", { code: "000000" })).statusCode,
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
  assert.equal(f.app.store.room().pageOpen, false);
  assert.equal(f.app.store.room().stage, "waiting");
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
  assert.equal(f.app.store.room().stage, "ended");
  assert.equal((await f.submit(b, "discover", discovery())).statusCode, 409);
  assert.equal((await f.board(a)).statusCode, 403);
  assert.equal(
    (await f.board(f.teacher, "discover", "&role=teacher")).json().total,
    1,
  );
  assert.equal(
    (
      await request(f.app, "POST", "/api/join", {
        code: f.app.store.room().code,
      })
    ).statusCode,
    409,
  );
  const room = f.app.store.room();
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
  assert.equal(f.app.store.counts().discover, 1);
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
  assert.equal(f.app.store.counts().discover, 0);
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
  const stale = f.app.store.room();
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
  assert.equal(f.app.store.room().stage, "discover");
  const current = f.app.store.room();
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
  const room = f.app.store.room();
  await f.restart();
  assert.deepEqual(f.app.store.room(), room);
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
    old = f.app.store.room();
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
  assert.notEqual(f.app.store.room().code, old.code);
  assert.equal(f.app.store.room().stage, "waiting");
  assert.equal(f.app.store.room().pageOpen, false);
  assert.equal(
    (await request(f.app, "GET", "/api/student/state", undefined, a))
      .statusCode,
    401,
  );
  assert.equal((await f.board(a)).statusCode, 401);
  assert.equal(f.app.store.counts().discover, 0);
  assert.equal(f.app.store.get("SELECT COUNT(*) n FROM submissions").n, 1);
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

test("150 个同出口参与端随老师完成 300 次提交，分页和搜索完整", async (t) => {
  const f = await fixture(t);
  await f.start();
  const students = await Promise.all(
    Array.from({ length: 150 }, () => f.student()),
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
  assert.deepEqual(f.app.store.counts(), {
    joined: 150,
    discover: 150,
    design: 150,
  });
  const ids = new Set();
  for (let page = 1; page <= 3; page++) {
    const result = (
      await f.board(students[0], "design", `&page=${page}`)
    ).json();
    assert.equal(result.total, 150);
    assert.equal(result.rows.length, 50);
    result.rows.forEach((r) => {
      assert.equal(r.token, undefined);
      assert.equal(r.expires, undefined);
      ids.add(r.id);
    });
  }
  assert.equal(ids.size, 150);
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
    room = f.app.store.room();
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
    serveStatic: false,
    initialPassword: password,
  });
  try {
    const r = await request(app, "POST", "/api/join", {
      code: app.store.room().code,
    });
    assert.deepEqual(r.json().schools, ["第一学校", "第二学校"]);
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
    serveStatic: false,
    initialPassword: password,
  });
  try {
    assert.equal(app.store.room().id, "legacy-room");
    assert.equal(app.store.room().stage, "design");
    assert.equal(app.store.room().pageOpen, true);
    assert.equal(app.store.room().discoverOpen, false);
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
  } finally {
    await app.close();
  }
});

test(
  "真实 HTTP SSE 通知提交及主题切换，断线后的状态仍受阅读门槛保护",
  { timeout: 15000 },
  async (t) => {
    const f = await fixture(t),
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
