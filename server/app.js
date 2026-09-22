import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import QRCode from "qrcode";
import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { createStore, AppError, hash, str, loadSchools } from "./store.js";
import { token, passwordHash, verifyPassword } from "./auth.js";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const cookieValue = (request, name) =>
  request.headers.cookie
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${name}=`))
    ?.slice(name.length + 1);
const kinds = ["discover", "design"];
const csvCell = (value) => {
  let text = String(value ?? "");
  if (/^[\s\uFEFF]*[=+@-]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};

export async function buildApp({
  dataDir = process.env.DATA_DIR || resolve(projectRoot, "data"),
  schoolsFile = process.env.SCHOOLS_FILE ||
    resolve(projectRoot, "config/schools.json"),
  initialPassword = process.env.TEACHER_PASSWORD,
  publicUrl = process.env.PUBLIC_URL || "",
  secureCookie = process.env.COOKIE_SECURE === "true",
  serveStatic = true,
  dev = false,
} = {}) {
  const schools = loadSchools(schoolsFile);
  if (publicUrl) {
    const parsed = new URL(publicUrl);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      parsed.username ||
      parsed.password
    )
      throw new Error("PUBLIC_URL 请填写不带路径的 HTTP(S) 访问地址");
    publicUrl = parsed.origin;
  }
  const app = Fastify({ logger: false, bodyLimit: 8192 });
  const store = createStore(dataDir);
  app.decorate("store", store);
  let generatedPassword = null;
  if (!store.meta("password")) {
    generatedPassword =
      initialPassword || randomBytes(12).toString("base64url");
    try {
      str(generatedPassword, "教师密码", 128);
      if (generatedPassword.length < 8)
        throw new Error("教师密码至少 8 个字符");
      store.setMeta("password", await passwordHash(generatedPassword));
    } catch (error) {
      store.close();
      throw error;
    }
  }
  app.decorate("initialPassword", generatedPassword);
  const clients = new Set(),
    limits = new Map();
  let pendingBroadcast,
    vite,
    passwordJobs = 0;
  function limit(key, max, window = 60000) {
    const existing = limits.get(key);
    if (existing && existing.until > Date.now()) {
      if (++existing.count > max)
        throw new AppError("操作较频繁，请稍后再试", 429);
    } else {
      if (limits.size >= 10000) throw new AppError("服务繁忙，请稍后再试", 429);
      limits.set(key, { count: 1, until: Date.now() + window });
    }
  }
  function setCookie(reply, name, value, age = 86400) {
    reply.header(
      "Set-Cookie",
      `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secureCookie ? "; Secure" : ""}`,
    );
  }
  function teacher(request) {
    const value = cookieValue(request, "workshop_teacher");
    const session =
      value &&
      store.get(
        "SELECT * FROM teachers WHERE token=? AND expires>?",
        hash(value),
        Date.now(),
      );
    if (!session) throw new AppError("请先登录教师端", 401);
    return session;
  }
  function student(request) {
    const value = cookieValue(request, "workshop_student");
    const person =
      value &&
      store.get(
        "SELECT * FROM participants WHERE token=? AND expires>?",
        hash(value),
        Date.now(),
      );
    if (!person || person.room_id !== store.meta("current"))
      throw new AppError("请重新输入课堂码加入课堂", 401);
    return person;
  }
  function audience(request) {
    return request.query.role === "teacher"
      ? teacher(request)
      : student(request);
  }
  function broadcast() {
    if (pendingBroadcast) return;
    pendingBroadcast = setTimeout(() => {
      pendingBroadcast = null;
      for (const client of clients) {
        if (
          !client.res.destroyed &&
          !client.res.write("event: update\ndata: changed\n\n")
        )
          client.res.end();
      }
    }, 200);
    pendingBroadcast.unref();
  }
  function own(person) {
    return Object.fromEntries(
      store
        .all(
          "SELECT kind,content,created_at FROM submissions WHERE participant_id=?",
          person.id,
        )
        .map((s) => [
          s.kind,
          { ...JSON.parse(s.content), createdAt: s.created_at },
        ]),
    );
  }
  function state(person) {
    return {
      room: store.room(),
      counts: store.counts(),
      schools,
      ...(person
        ? {
            me: { id: person.id, name: person.name, school: person.school },
            submissions: own(person),
          }
        : {}),
    };
  }
  app.setErrorHandler((error, request, reply) => {
    const status =
      error.statusCode >= 400 && error.statusCode < 500
        ? error.statusCode
        : 500;
    reply.code(status).send({
      error: status === 500 ? "服务暂时出错，请稍后重试" : error.message,
    });
    if (status === 500)
      console.error(
        "request_failed",
        request.routeOptions?.url,
        error.code || "INTERNAL_ERROR",
      );
  });
  app.addHook("onRequest", async (request, reply) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "no-referrer")
      .header("X-Frame-Options", "DENY");
    if (!dev)
      reply.header(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      );
    if (request.url.startsWith("/api/")) {
      reply.header("Cache-Control", "no-store");
      if (["POST", "PUT", "DELETE", "PATCH"].includes(request.method)) {
        if (!request.headers["content-type"]?.startsWith("application/json"))
          throw new AppError("请使用 JSON 提交", 415);
        if (request.headers["x-classroom-request"] !== "1")
          throw new AppError("请从课堂页面操作", 403);
        const origin = request.headers.origin;
        if (
          origin &&
          origin !== `${request.protocol}://${request.headers.host}` &&
          origin !== publicUrl
        )
          throw new AppError("请求来源不正确", 403);
      }
    }
  });
  app.get("/api/health", async () => ({
    ok: true,
    app: "AI 共创课堂",
    version: "0.2.0",
  }));
  function studentState(request, reply) {
    const person = student(request);
    store.run(
      "UPDATE participants SET expires=? WHERE id=?",
      Date.now() + 86400000,
      person.id,
    );
    setCookie(
      reply,
      "workshop_student",
      cookieValue(request, "workshop_student"),
    );
    return state(person);
  }
  app.get("/api/session", async (request, reply) => {
    try {
      if (request.query.role === "teacher") {
        teacher(request);
        return { state: state() };
      }
      return { state: studentState(request, reply) };
    } catch (error) {
      if (error.statusCode === 401) return { state: null };
      throw error;
    }
  });
  app.post("/api/login", async (request, reply) => {
    limit(`login:${request.ip}`, 10, 900000);
    const password = str(request.body?.password, "教师密码", 128);
    if (passwordJobs >= 4) throw new AppError("正在验证密码，请稍后重试", 429);
    passwordJobs++;
    let valid;
    try {
      valid = await verifyPassword(password, store.meta("password"));
    } finally {
      passwordJobs--;
    }
    if (!valid) throw new AppError("教师密码不正确", 401);
    limits.delete(`login:${request.ip}`);
    const value = token();
    store.run(
      "INSERT INTO teachers VALUES (?,?)",
      hash(value),
      Date.now() + 43200000,
    );
    setCookie(reply, "workshop_teacher", value, 43200);
    return { ok: true };
  });
  app.post("/api/logout", async (request, reply) => {
    const session = teacher(request);
    store.run("DELETE FROM teachers WHERE token=?", session.token);
    for (const client of clients)
      if (client.teacherToken === session.token) client.res.end();
    setCookie(reply, "workshop_teacher", "", 0);
    return { ok: true };
  });
  app.get("/api/teacher/state", async (request) => {
    teacher(request);
    return state();
  });
  app.post("/api/teacher/control", async (request) => {
    teacher(request);
    const body = request.body;
    if (!body || !["page", "stage", "pause", "end"].includes(body.action))
      throw new AppError("请选择有效的课堂操作");
    const current = store.room();
    if (body.roomId !== current.id)
      throw new AppError("课堂已更新，请刷新后操作", 409);
    if (body.revision !== current.revision)
      throw new AppError("课堂节奏已变化，请根据最新状态操作", 409);
    const next = { ...current };
    if (body.action === "page") {
      if (typeof body.open !== "boolean")
        throw new AppError("页面开关状态不正确");
      next.pageOpen = body.open;
    } else if (body.action === "stage") {
      if (!["waiting", ...kinds].includes(body.stage))
        throw new AppError("请选择有效的主题");
      if (current.stage === "ended")
        throw new AppError("本节课已经结束，请开始新课堂", 409);
      next.stage = body.stage;
      next.paused = false;
    } else if (body.action === "pause") {
      if (typeof body.paused !== "boolean")
        throw new AppError("暂停状态不正确");
      if (!kinds.includes(current.stage) || !current.pageOpen)
        throw new AppError("请先开放课堂并进入一个主题", 409);
      next.paused = body.paused;
    } else {
      next.stage = "ended";
      next.paused = true;
    }
    store.control(next);
    broadcast();
    return state();
  });
  app.post("/api/teacher/new-room", async (request) => {
    teacher(request);
    const current = store.room();
    if (request.body?.roomId !== current.id)
      throw new AppError("课堂已更新，请刷新后操作", 409);
    if (current.pageOpen && current.stage !== "ended")
      throw new AppError("请先结束课堂或关闭课堂页面，再开始新课堂", 409);
    store.newRoom();
    broadcast();
    return state();
  });
  app.get("/api/teacher/share", async (request) => {
    teacher(request);
    const base = publicUrl || `${request.protocol}://${request.headers.host}`;
    const url = `${base}/?code=${store.room().code}`;
    return {
      url,
      qr: await QRCode.toDataURL(url, {
        width: 220,
        margin: 1,
        color: { dark: "#183d36", light: "#ffffff" },
      }),
    };
  });
  app.post("/api/join", async (request, reply) => {
    limit(`join:${request.ip}`, 600);
    if (request.body?.code !== store.room().code)
      throw new AppError("课堂码不正确，请向老师确认", 404);
    try {
      const existing = student(request);
      return state(existing);
    } catch {}
    if (store.room().stage === "ended")
      throw new AppError("本节课堂已结束，请向老师索取新课堂码", 409);
    const value = token(),
      id = randomUUID();
    store.run(
      "INSERT INTO participants (id,room_id,token,expires) VALUES (?,?,?,?)",
      id,
      store.meta("current"),
      hash(value),
      Date.now() + 86400000,
    );
    setCookie(reply, "workshop_student", value);
    broadcast();
    return state(store.get("SELECT * FROM participants WHERE id=?", id));
  });
  app.get("/api/student/state", async (request, reply) =>
    studentState(request, reply),
  );
  app.post("/api/student/submit/:kind", async (request) => {
    const person = student(request),
      kind = request.params.kind,
      body = request.body ?? {};
    limit(`submit:${person.id}`, 20);
    if (!kinds.includes(kind)) throw new AppError("环节不存在", 404);
    const needsIdentity = !person.name || !person.school;
    const name = person.name || str(body.name, "姓名", 40);
    const school = person.school || str(body.school, "学校", 100);
    if (
      !needsIdentity &&
      ((body.name !== undefined &&
        (typeof body.name !== "string" || body.name.trim() !== name)) ||
        (body.school !== undefined &&
          (typeof body.school !== "string" || body.school.trim() !== school)))
    )
      throw new AppError("学校和姓名沿用首次提交的信息", 409);
    let content;
    if (kind === "discover") {
      content = {
        field: str(body.field, "领域", 80),
        scenario: str(body.scenario, "应用场景", 500),
        value: str(body.value, "价值", 500),
      };
    } else {
      content = {
        scenario: str(body.scenario, "场景", 500),
        function: str(body.function, "基本功能", 500),
      };
    }
    const existing = store.get(
      "SELECT content FROM submissions WHERE participant_id=? AND kind=?",
      person.id,
      kind,
    );
    if (existing) {
      if (
        existing.content === JSON.stringify(content) &&
        (kind !== "discover" ||
          (name === person.name && school === person.school))
      )
        return { ok: true, repeated: true };
      throw new AppError("本主题已经提交，请查看自己的记录", 409);
    }
    if (!store.room()[`${kind}Open`])
      throw new AppError(
        "课堂节奏已变化，当前主题尚未开放、已暂停或已结束",
        409,
      );
    if (needsIdentity && !schools.includes(school))
      throw new AppError("请从下拉列表选择学校");
    store.transaction(() => {
      if (needsIdentity)
        store.run(
          "UPDATE participants SET name=?,school=? WHERE id=?",
          name,
          school,
          person.id,
        );
      store.run(
        "INSERT INTO submissions (room_id,participant_id,kind,content,created_at) VALUES (?,?,?,?,?)",
        person.room_id,
        person.id,
        kind,
        JSON.stringify(content),
        Date.now(),
      );
    });
    broadcast();
    return { ok: true };
  });
  app.get("/api/board", async (request) => {
    const actor = audience(request);
    const kind = request.query.kind;
    if (!kinds.includes(kind)) throw new AppError("环节不存在", 404);
    if (request.query.role !== "teacher") {
      const current = store.room();
      if (!current.pageOpen || current.stage !== kind)
        throw new AppError("请跟随老师查看当前主题", 403);
      if (
        !store.get(
          "SELECT id FROM submissions WHERE participant_id=? AND kind=?",
          actor.id,
          kind,
        )
      )
        throw new AppError("先提交本主题的回答，再查看同学的分享", 403);
    }
    const page = Number(request.query.page || 1),
      query = (request.query.q || "").trim();
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      page > 100000 ||
      query.length > 80
    )
      throw new AppError("列表查询条件不正确");
    const where =
      "FROM submissions s JOIN participants p ON p.id=s.participant_id WHERE s.room_id=? AND s.kind=? AND instr(p.name || p.school || s.content,?)>0";
    const args = [store.meta("current"), kind, query];
    const total = store.get(`SELECT COUNT(*) n ${where}`, ...args).n;
    const pages = Math.max(1, Math.ceil(total / 50)),
      actualPage = Math.min(page, pages);
    const rows = store
      .all(
        `SELECT s.id,p.id participantId,p.name,p.school,s.content,s.created_at createdAt ${where} ORDER BY s.id DESC LIMIT 50 OFFSET ?`,
        ...args,
        (actualPage - 1) * 50,
      )
      .map(({ content, ...row }) => ({ ...row, ...JSON.parse(content) }));
    return { rows, total, page: actualPage, pages };
  });
  app.get("/api/teacher/export", async (request, reply) => {
    teacher(request);
    const rows = store.all(
      "SELECT p.name,p.school,s.kind,s.content,s.created_at FROM submissions s JOIN participants p ON p.id=s.participant_id WHERE s.room_id=? ORDER BY s.id",
      store.meta("current"),
    );
    const records = [
      [
        "环节",
        "学校",
        "姓名",
        "领域",
        "应用场景／场景",
        "价值",
        "基本功能",
        "提交时间（北京时间）",
      ],
      ...rows.map((row) => {
        const c = JSON.parse(row.content);
        return [
          row.kind === "discover" ? "一起发现" : "一起设计",
          row.school,
          row.name,
          c.field,
          c.scenario,
          c.value,
          c.function,
          new Date(row.created_at).toLocaleString("sv-SE", {
            timeZone: "Asia/Shanghai",
          }),
        ];
      }),
    ];
    reply.header(
      "Content-Disposition",
      `attachment; filename="ai-classroom-${store.room().code}.csv"`,
    );
    return reply
      .type("text/csv; charset=utf-8")
      .send(
        "\uFEFF" + records.map((r) => r.map(csvCell).join(",")).join("\r\n"),
      );
  });
  app.get("/api/events", async (request, reply) => {
    const actor = audience(request),
      isTeacher = request.query.role === "teacher";
    if (clients.size >= 5000)
      throw new AppError("实时连接繁忙，请稍后重试", 503);
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write("retry: 3000\nevent: ready\ndata: connected\n\n");
    const client = {
      res: reply.raw,
      expires: actor.expires,
      teacherToken: isTeacher ? actor.token : null,
    };
    clients.add(client);
    reply.raw.on("close", () => clients.delete(client));
  });
  const timer = setInterval(() => {
    for (const client of clients)
      if (
        client.expires < Date.now() ||
        (!client.res.destroyed && !client.res.write(": heartbeat\n\n"))
      )
        client.res.end();
    for (const [key, value] of limits)
      if (value.until < Date.now()) limits.delete(key);
    store.run("DELETE FROM teachers WHERE expires<?", Date.now());
  }, 20000);
  timer.unref();
  app.addHook("preClose", async () => {
    for (const client of clients) client.res.end();
  });
  app.addHook("onClose", async () => {
    clearInterval(timer);
    clearTimeout(pendingBroadcast);
    if (vite) await vite.close();
    store.close();
  });
  if (serveStatic) {
    if (dev) {
      const { createServer } = await import("vite");
      vite = await createServer({
        root: projectRoot,
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.setNotFoundHandler((request, reply) => {
        if (request.url.startsWith("/api/"))
          return reply.code(404).send({ error: "接口不存在" });
        reply.hijack();
        vite.middlewares(request.raw, reply.raw);
      });
    } else {
      const root = resolve(projectRoot, "dist");
      if (!existsSync(resolve(root, "index.html")))
        throw new Error("请先执行 npm run build");
      await app.register(fastifyStatic, { root });
      app.setNotFoundHandler((request, reply) =>
        request.url.startsWith("/api/")
          ? reply.code(404).send({ error: "接口不存在" })
          : reply.sendFile("index.html"),
      );
    }
  }
  return app;
}
