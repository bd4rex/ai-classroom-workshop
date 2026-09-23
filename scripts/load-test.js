// Intentionally local-only: this creates and removes an isolated synthetic schema.
import { fork } from "node:child_process";
import { once } from "node:events";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import pg from "pg";
const databaseUrl = process.env.TEST_DATABASE_URL;
if (
  !databaseUrl ||
  !["127.0.0.1", "localhost", "[::1]"].includes(new URL(databaseUrl).hostname)
)
  throw new Error("压测只允许 TEST_DATABASE_URL 指向本地隔离 PostgreSQL");
const schema = `load_${randomUUID().replaceAll("-", "")}`;
const pool = new pg.Pool({ connectionString: databaseUrl });
const password = "synthetic-load-test-only";
const school = JSON.parse(
  readFileSync(new URL("../config/schools.json", import.meta.url)),
)[0];
const samples = {},
  errors = [],
  workers = [],
  students = [];
let sequence = 0,
  active = 0,
  maxActive = 0,
  stopped = false;
async function launch() {
  const worker = fork(new URL("./load-worker.js", import.meta.url), {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      DATABASE_SCHEMA: schema,
      TEACHER_PASSWORD: password,
      SYNC_MODE: "polling",
    },
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  workers.push(worker);
  const [message] = await once(worker, "message");
  worker.base = `http://127.0.0.1:${message.port}`;
  return worker;
}
async function request(label, path, cookie, body, expected = 200) {
  const worker = workers[sequence++ % workers.length];
  const started = performance.now();
  active++;
  maxActive = Math.max(maxActive, active);
  try {
    const response = await fetch(worker.base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body === undefined
          ? {}
          : { "Content-Type": "application/json", "X-Classroom-Request": "1" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const result = await response.json();
    (samples[label] ||= []).push(performance.now() - started);
    if (response.status !== expected) {
      errors.push({ label, status: response.status, error: result.error });
      throw new Error(`${label}: ${response.status}`);
    }
    return {
      data: result,
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  } finally {
    active--;
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  await Promise.all([launch(), launch()]);
  const teacher = (await request("login", "/api/login", null, { password }))
    .cookie;
  let state = (
    await request("teacher-state", "/api/session?role=teacher", teacher)
  ).data.state;
  const roomId = state.room.id;
  for (let i = 0; i < 20; i++)
    assert.equal(
      (
        await request(
          "cross-instance-session",
          "/api/session?role=teacher",
          teacher,
        )
      ).data.state.room.id,
      roomId,
    );
  const control = async (change) => {
    state = (
      await request("teacher-state", "/api/session?role=teacher", teacher)
    ).data.state;
    state = (
      await request("control", "/api/teacher/control", teacher, {
        roomId,
        revision: state.room.revision,
        ...change,
      })
    ).data;
  };
  await control({ action: "page", open: true });
  await control({ action: "stage", stage: "discover" });
  console.log("Load: 500 concurrent joins");
  await Promise.all(
    Array.from({ length: 500 }, async (_, i) => {
      const r = await request("join", "/api/join", null, {
        classroomId: roomId,
      });
      assert.equal(r.data.state.room.id, roomId);
      assert.equal(r.data.state.sync.mode, "polling");
      students[i] = r.cookie;
    }),
  );
  const loops = students.map(async (cookie) => {
    await sleep(Math.random() * 3000);
    while (!stopped) {
      await request(
        "poll",
        "/api/session?role=student&classroomId=" + roomId,
        cookie,
      );
      await sleep(2500 + Math.random() * 1000);
    }
  });
  await Promise.all(
    students.map((cookie) =>
      request(
        "gated-board",
        "/api/board?kind=discover",
        cookie,
        undefined,
        403,
      ),
    ),
  );
  console.log("Load: 500 concurrent discovery submissions with polling active");
  await Promise.all(
    students.map((cookie, i) =>
      request("submit-discover", "/api/student/submit/discover", cookie, {
        name: `压测学生${i}`,
        school,
        field: "交通",
        scenario: `公交预测${i}`,
        value: "减少等待",
      }),
    ),
  );
  await Promise.all(
    students.map((cookie) =>
      request("board", "/api/board?kind=discover", cookie).then((r) =>
        assert.equal(r.data.total, 500),
      ),
    ),
  );
  await control({ action: "stage", stage: "design" });
  await Promise.all(
    students.map((cookie) =>
      request("stage-follow", "/api/session?role=student", cookie).then((r) =>
        assert.equal(r.data.state.room.stage, "design"),
      ),
    ),
  );
  await Promise.all(
    students.map((cookie) =>
      request("gated-design", "/api/board?kind=design", cookie, undefined, 403),
    ),
  );
  console.log("Load: 500 concurrent design submissions");
  await Promise.all(
    students.map((cookie, i) =>
      request("submit-design", "/api/student/submit/design", cookie, {
        scenario: `雨天校园${i}`,
        function: "预测降雨并提醒带伞",
      }),
    ),
  );
  const rows = (
    await request(
      "teacher-board",
      "/api/board?kind=design&role=teacher",
      teacher,
    )
  ).data.rows;
  await request("moderate", "/api/teacher/submissions/moderate", teacher, {
    roomId,
    ids: [rows[0].id],
    action: "delete",
  });
  await Promise.all(
    students
      .slice(0, 20)
      .map((cookie) =>
        request("moderation-visible", "/api/board?kind=design", cookie).then(
          (r) => assert.equal(r.data.total, 499),
        ),
      ),
  );
  await sleep(Number(process.env.LOAD_HOLD_MS || 30000));
  stopped = true;
  await Promise.all(loops);
  state = (await request("teacher-state", "/api/session?role=teacher", teacher))
    .data.state;
  assert.deepEqual(state.counts, { joined: 500, discover: 500, design: 499 });
  // Restart both workers: the shared classroom, identities and teacher session survive.
  for (const worker of [...workers]) {
    worker.send("stop");
    await once(worker, "exit");
  }
  workers.length = 0;
  await Promise.all([launch(), launch()]);
  assert.equal(
    (await request("restart-session", "/api/session?role=teacher", teacher))
      .data.state.room.id,
    roomId,
  );
  assert.equal(
    (await request("restart-student", "/api/session?role=student", students[0]))
      .data.state.me.name,
    "压测学生0",
  );
  const metrics = Object.fromEntries(
    Object.entries(samples).map(([label, values]) => {
      const sorted = values.sort((a, b) => a - b),
        p = (q) =>
          Math.round(
            sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))],
          );
      return [
        label,
        {
          requests: values.length,
          p50Ms: p(0.5),
          p95Ms: p(0.95),
          p99Ms: p(0.99),
          maxMs: p(1),
        },
      ];
    }),
  );
  const report = {
    at: new Date().toISOString(),
    scope:
      "local PostgreSQL, 2 separate Node processes, 500 student sessions, polling plus simultaneous bursts",
    maxActive,
    errors,
    counts: state.counts,
    metrics,
  };
  mkdirSync("output/load-test", { recursive: true });
  writeFileSync(
    "output/load-test/result.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  stopped = true;
  for (const worker of workers) {
    if (worker.exitCode === null) {
      worker.send("stop");
      await once(worker, "exit");
    }
  }
  await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await pool.end();
}
