import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../server/app.js";

const password = "isolated-test-password-only";
const school = JSON.parse(
  readFileSync(new URL("../config/schools.json", import.meta.url), "utf8"),
)[0];
const discovery = (name = "测试同学") => ({
  school,
  name,
  field: "交通",
  scenario: "公交到站预测",
  value: "减少候车时间",
});
const design = {
  scenario: "校园雨天接送",
  function: "预测放学时的降雨并提醒带伞",
};
const cookie = (response) => response.headers["set-cookie"]?.split(";")[0];
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
  const login = await request(app, "POST", "/api/login", { password });
  assert.equal(login.statusCode, 200);
  const teacher = cookie(login),
    code = app.store.room().code;
  const student = async () => {
    const result = await request(app, "POST", "/api/join", { code });
    assert.equal(result.statusCode, 200);
    return cookie(result);
  };
  const control = async (kind, open = true) => {
    const result = await request(
      app,
      "POST",
      "/api/teacher/control",
      { kind, open, roomId: app.store.room().id },
      teacher,
    );
    assert.equal(result.statusCode, 200, result.body);
    return result;
  };
  return {
    get app() {
      return app;
    },
    teacher,
    code,
    student,
    control,
    dataDir,
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

test("教师鉴权、学生隔离、同源写入与无远程初始化入口", async (t) => {
  const f = await fixture(t),
    student = await f.student();
  const session = await request(f.app, "GET", "/api/session?role=teacher");
  assert.equal(session.statusCode, 200);
  assert.deepEqual(session.json(), { state: null });
  assert.equal(
    (
      await request(
        f.app,
        "GET",
        "/api/session?role=student",
        undefined,
        student,
      )
    ).json().state.room.code,
    f.code,
  );
  for (const url of [
    "/api/teacher/state",
    "/api/teacher/share",
    "/api/teacher/export",
    "/api/board?kind=discover",
  ])
    assert.equal((await request(f.app, "GET", url)).statusCode, 401);
  assert.equal(
    (await request(f.app, "GET", "/api/teacher/state", undefined, student))
      .statusCode,
    401,
  );
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
      await request(f.app, "POST", "/api/join", { code: f.code }, undefined, {
        "x-classroom-request": "",
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await request(f.app, "POST", "/api/join", { code: f.code }, undefined, {
        origin: "https://unrelated.example",
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await request(f.app, "POST", "/api/join", { code: "000000" })).statusCode,
    404,
  );
  assert.match(
    (await request(f.app, "GET", "/api/student/state", undefined, student))
      .headers["set-cookie"],
    /HttpOnly; SameSite=Strict/,
  );
});

test("两次提交、独立开关、学校姓名沿用、同学可见与关闭后保留列表", async (t) => {
  const f = await fixture(t),
    a = await f.student(),
    b = await f.student();
  assert.equal(
    (
      await request(
        f.app,
        "POST",
        "/api/student/submit/discover",
        discovery(),
        a,
      )
    ).statusCode,
    409,
  );
  await f.control("discover");
  assert.equal(
    (
      await request(
        f.app,
        "POST",
        "/api/student/submit/discover",
        discovery(),
        a,
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (await request(f.app, "POST", "/api/student/submit/design", design, a))
      .statusCode,
    409,
  );
  await f.control("discover", false);
  await f.control("design");
  assert.equal(
    (await request(f.app, "POST", "/api/student/submit/design", design, b))
      .statusCode,
    409,
  );
  assert.equal(
    (
      await request(
        f.app,
        "POST",
        "/api/student/submit/design",
        { ...design, name: "试图改名", school: "未知学校" },
        a,
      )
    ).statusCode,
    200,
  );
  await f.control("design", false);
  for (const kind of ["discover", "design"]) {
    const board = await request(
      f.app,
      "GET",
      `/api/board?kind=${kind}`,
      undefined,
      b,
    );
    assert.equal(board.statusCode, 200);
    assert.equal(board.json().rows[0].name, "测试同学");
    assert.equal(board.json().rows[0].school, school);
    assert.equal(board.json().total, 1);
  }
  const state = (
    await request(f.app, "GET", "/api/student/state", undefined, a)
  ).json();
  assert.ok(state.submissions.discover);
  assert.ok(state.submissions.design);
  assert.deepEqual(state.counts, { joined: 2, discover: 1, design: 1 });
});

test("重复并发点击与网络重试只保存一份，已关闭时允许回读同一成功提交", async (t) => {
  const f = await fixture(t),
    a = await f.student();
  await f.control("discover");
  const responses = await Promise.all(
    Array.from({ length: 10 }, () =>
      request(f.app, "POST", "/api/student/submit/discover", discovery(), a),
    ),
  );
  responses.forEach((r) => assert.equal(r.statusCode, 200));
  assert.equal(f.app.store.counts().discover, 1);
  await f.control("discover", false);
  assert.equal(
    (
      await request(
        f.app,
        "POST",
        "/api/student/submit/discover",
        discovery(),
        a,
      )
    ).json().repeated,
    true,
  );
  assert.equal(
    (
      await request(
        f.app,
        "POST",
        "/api/student/submit/discover",
        { ...discovery(), value: "覆盖原答案" },
        a,
      )
    ).statusCode,
    409,
  );
});

test("服务端验证学校、必填、长度、环节类型与课堂版本", async (t) => {
  const f = await fixture(t),
    a = await f.student();
  await f.control("discover");
  for (const patch of [
    { school: "不在列表中" },
    { name: " " },
    { field: "" },
    { scenario: 42 },
    { value: "文".repeat(501) },
  ])
    assert.equal(
      (
        await request(
          f.app,
          "POST",
          "/api/student/submit/discover",
          { ...discovery(), ...patch },
          a,
        )
      ).statusCode,
      400,
    );
  assert.equal(f.app.store.counts().discover, 0);
  assert.equal(
    (await request(f.app, "POST", "/api/student/submit/unknown", {}, a))
      .statusCode,
    404,
  );
  assert.equal(
    (
      await request(
        f.app,
        "POST",
        "/api/teacher/control",
        { kind: "discover", open: "false", roomId: f.app.store.room().id },
        f.teacher,
      )
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await request(
        f.app,
        "POST",
        "/api/teacher/control",
        { kind: "discover", open: true, roomId: "old" },
        f.teacher,
      )
    ).statusCode,
    409,
  );
});

test("服务器重启后课堂、开关、登录与两次记录均恢复", async (t) => {
  const f = await fixture(t),
    a = await f.student();
  await f.control("discover");
  await f.control("design");
  await request(f.app, "POST", "/api/student/submit/discover", discovery(), a);
  await request(f.app, "POST", "/api/student/submit/design", design, a);
  const room = f.app.store.room();
  await f.restart();
  assert.deepEqual(f.app.store.room(), room);
  const state = await request(f.app, "GET", "/api/student/state", undefined, a);
  assert.equal(state.statusCode, 200);
  assert.equal(Object.keys(state.json().submissions).length, 2);
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

test("开始新课保留旧记录、更换课堂码并隔离旧学生和旧控制请求", async (t) => {
  const f = await fixture(t),
    a = await f.student(),
    oldRoom = f.app.store.room();
  await f.control("discover");
  await request(f.app, "POST", "/api/student/submit/discover", discovery(), a);
  assert.equal(
    (
      await request(
        f.app,
        "POST",
        "/api/teacher/new-room",
        { roomId: oldRoom.id },
        f.teacher,
      )
    ).statusCode,
    409,
  );
  await f.control("discover", false);
  assert.equal(
    (
      await request(
        f.app,
        "POST",
        "/api/teacher/new-room",
        { roomId: oldRoom.id },
        f.teacher,
      )
    ).statusCode,
    200,
  );
  assert.notEqual(f.app.store.room().code, oldRoom.code);
  assert.equal(
    (await request(f.app, "GET", "/api/student/state", undefined, a))
      .statusCode,
    401,
  );
  assert.equal(
    (await request(f.app, "GET", "/api/board?kind=discover", undefined, a))
      .statusCode,
    401,
  );
  assert.equal(
    (await request(f.app, "POST", "/api/join", { code: oldRoom.code }, a))
      .statusCode,
    404,
  );
  assert.equal(f.app.store.counts().discover, 0);
  assert.equal(f.app.store.get("SELECT COUNT(*) n FROM submissions").n, 1);
  assert.equal(
    (
      await request(
        f.app,
        "POST",
        "/api/teacher/control",
        { roomId: oldRoom.id, kind: "design", open: true },
        f.teacher,
      )
    ).statusCode,
    409,
  );
});

test("150 个同出口参与端完成两次提交，列表分页、搜索、总数与公开字段正确", async (t) => {
  const f = await fixture(t);
  await f.control("discover");
  await f.control("design");
  const students = await Promise.all(
    Array.from({ length: 150 }, () => f.student()),
  );
  await Promise.all(
    students.map(async (s, i) => {
      assert.equal(
        (
          await request(
            f.app,
            "POST",
            "/api/student/submit/discover",
            discovery(`同学${String(i).padStart(3, "0")}`),
            s,
          )
        ).statusCode,
        200,
      );
      assert.equal(
        (await request(f.app, "POST", "/api/student/submit/design", design, s))
          .statusCode,
        200,
      );
    }),
  );
  assert.deepEqual(f.app.store.counts(), {
    joined: 150,
    discover: 150,
    design: 150,
  });
  const ids = new Set();
  for (let page = 1; page <= 3; page++) {
    const result = (
      await request(
        f.app,
        "GET",
        `/api/board?kind=discover&page=${page}`,
        undefined,
        students[0],
      )
    ).json();
    assert.equal(result.total, 150);
    assert.equal(result.rows.length, 50);
    assert.equal(result.pages, 3);
    result.rows.forEach((r) => {
      assert.equal(r.token, undefined);
      assert.equal(r.expires, undefined);
      ids.add(r.id);
    });
  }
  assert.equal(ids.size, 150);
  const filtered = (
    await request(
      f.app,
      "GET",
      "/api/board?kind=discover&q=" + encodeURIComponent("同学001"),
      undefined,
      students[1],
    )
  ).json();
  assert.equal(filtered.total, 1);
  assert.equal(filtered.rows[0].name, "同学001");
  assert.equal(
    (
      await request(
        f.app,
        "GET",
        "/api/board?kind=discover&page=-1",
        undefined,
        students[0],
      )
    ).statusCode,
    400,
  );
});

test("完整 CSV 导出保留换行与中文，并阻止单元格公式执行", async (t) => {
  const f = await fixture(t),
    a = await f.student();
  await f.control("discover");
  const payload = {
    ...discovery("=1+1"),
    scenario: "第一行\n第二行",
    value: '有"帮助",真的',
  };
  await request(f.app, "POST", "/api/student/submit/discover", payload, a);
  const response = await request(
    f.app,
    "GET",
    "/api/teacher/export",
    undefined,
    f.teacher,
  );
  assert.equal(response.statusCode, 200);
  assert.ok(response.body.startsWith("\uFEFF"));
  assert.match(response.body, /"'=1\+1"/);
  assert.match(response.body, /"第一行\n第二行"/);
  assert.match(response.body, /"有""帮助"",真的"/);
  assert.equal(
    (await request(f.app, "GET", "/api/teacher/export", undefined, a))
      .statusCode,
    401,
  );
});

test("教师退出使会话失效，学生不能操作教师开关", async (t) => {
  const f = await fixture(t),
    a = await f.student();
  assert.equal(
    (
      await request(
        f.app,
        "POST",
        "/api/teacher/control",
        { roomId: f.app.store.room().id, kind: "discover", open: true },
        a,
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

test("学校配置可替换，错误配置使服务明确停止启动", async (t) => {
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
    const joined = await request(app, "POST", "/api/join", {
      code: app.store.room().code,
    });
    assert.deepEqual(joined.json().schools, ["第一学校", "第二学校"]);
  } finally {
    await app.close();
  }
});

test(
  "真实 HTTP SSE 将开关变化及他人提交通知给学生",
  { timeout: 15000 },
  async (t) => {
    const f = await fixture(t),
      a = await f.student(),
      b = await f.student();
    await f.app.listen({ port: 0, host: "127.0.0.1" });
    const base = `http://127.0.0.1:${f.app.server.address().port}`;
    const abort = new AbortController();
    const response = await fetch(base + "/api/events?role=student", {
      headers: { cookie: b },
      signal: abort.signal,
    });
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    async function until(text) {
      let result = "";
      while (!result.includes(text)) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error("SSE 提前关闭");
        result += decoder.decode(chunk.value);
      }
    }
    try {
      await until("event: ready");
      await f.control("discover");
      await until("event: update");
      await request(
        f.app,
        "POST",
        "/api/student/submit/discover",
        discovery(),
        a,
      );
      await until("event: update");
      const board = await fetch(base + "/api/board?kind=discover", {
        headers: { cookie: b },
      });
      assert.equal((await board.json()).rows[0].scenario, "公交到站预测");
    } finally {
      await reader.cancel();
      abort.abort();
    }
  },
);
