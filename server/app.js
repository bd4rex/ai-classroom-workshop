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
  databaseUrl = process.env.DATABASE_URL || process.env.PGDATABASE_URL || "",
  usePostgres = Boolean(
    databaseUrl || (process.env.PGHOST && process.env.PGDATABASE),
  ),
  databaseSchema = process.env.DATABASE_SCHEMA || "public",
  requireSharedDatabase = process.env.REQUIRE_SHARED_DATABASE === "true",
  syncMode = process.env.SYNC_MODE || (usePostgres ? "polling" : "sse"),
  serveStatic = true,
  dev = false,
} = {}) {
  const schools = loadSchools(schoolsFile);
  const publicOrigins = publicUrl
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      const parsed = new URL(value);
      if (
        !["http:", "https:"].includes(parsed.protocol) ||
        parsed.pathname !== "/" ||
        parsed.search ||
        parsed.hash ||
        parsed.username ||
        parsed.password
      )
        throw new Error(
          "PUBLIC_URL 请填写不带路径的 HTTP(S) 访问地址，多个地址用逗号分隔",
        );
      if (secureCookie && parsed.protocol !== "https:")
        throw new Error("Secure Cookie 需要 HTTPS 访问地址");
      return parsed.origin;
    });
  publicUrl = publicOrigins[0] || "";
  if (requireSharedDatabase && !usePostgres)
    throw new Error("多实例部署需要配置共享数据库 DATABASE_URL");
  if (
    !["polling", "sse"].includes(syncMode) ||
    (usePostgres && syncMode !== "polling")
  )
    throw new Error("PostgreSQL 多实例部署请使用 SYNC_MODE=polling");
  const sync = {
    mode: syncMode,
    intervalMs: syncMode === "polling" ? 2500 : 6000,
  };
  const app = Fastify({ logger: false, bodyLimit: 8192 });
  const store = await createStore(dataDir, {
    connectionString: databaseUrl || undefined,
    usePostgres,
    schema: databaseSchema,
  });
  app.decorate("store", store);
  try {
    app.decorate(
      "initialPassword",
      await store.initialize(async () => {
        const password =
          initialPassword || randomBytes(12).toString("base64url");
        str(password, "教师密码", 128);
        if (password.length < 8) throw new Error("教师密码至少 8 个字符");
        return { password, hash: await passwordHash(password) };
      }),
    );
  } catch (error) {
    await store.close();
    throw error;
  }
  app.addHook("onRoute", (route) => {
    const exclusive = [
      "/api/teacher/control",
      "/api/teacher/new-room",
      "/api/teacher/submissions/moderate",
    ].includes(route.url);
    const shared = [
      "/api/join",
      "/api/student/submit/:kind",
      "/api/session",
      "/api/student/state",
    ].includes(route.url);
    const snapshot = [
      "/api/board",
      "/api/teacher/state",
      "/api/teacher/share",
      "/api/teacher/export",
    ].includes(route.url);
    if (!exclusive && !shared && !snapshot) return;
    const handler = route.handler;
    route.handler = (request, reply) =>
      store.transaction(
        async () => {
          if (exclusive || shared) await store.lockCurrent(exclusive);
          return handler(request, reply);
        },
        { readOnly: snapshot },
      );
  });
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
  async function teacher(request) {
    const value = cookieValue(request, "workshop_teacher");
    const session =
      value &&
      (await store.get(
        "SELECT * FROM teachers WHERE token=? AND expires>?",
        hash(value),
        Date.now(),
      ));
    if (!session) throw new AppError("请先登录教师端", 401);
    return session;
  }
  async function student(request) {
    const value = cookieValue(request, "workshop_student");
    const person =
      value &&
      (await store.get(
        "SELECT * FROM participants WHERE token=? AND expires>?",
        hash(value),
        Date.now(),
      ));
    if (
      !person ||
      person.room_id !== (await store.meta("current")) ||
      (request.query.classroomId !== undefined &&
        person.room_id !== request.query.classroomId)
    )
      throw new AppError("请重新打开老师分享的学生链接", 401);
    return person;
  }
  async function audience(request) {
    return request.query.role === "teacher"
      ? await teacher(request)
      : await student(request);
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
  async function own(person) {
    return Object.fromEntries(
      (
        await store.all(
          "SELECT kind,content,created_at,deleted_at FROM submissions WHERE participant_id=?",
          person.id,
        )
      ).map((s) => [
        s.kind,
        {
          ...(s.deleted_at !== null
            ? { removed: true }
            : JSON.parse(s.content)),
          createdAt: s.created_at,
        },
      ]),
    );
  }
  async function state(person) {
    return {
      room: await store.room(),
      counts: await store.counts(),
      schools,
      sync,
      ...(person
        ? {
            me: { id: person.id, name: person.name, school: person.school },
            submissions: await own(person),
          }
        : {
            submissionSchools: (
              await store.all(
                "SELECT DISTINCT p.school FROM participants p JOIN submissions s ON s.participant_id=p.id WHERE s.room_id=? ORDER BY p.school",
                await store.meta("current"),
              )
            ).map((row) => row.school),
          }),
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
          !publicOrigins.includes(origin)
        )
          throw new AppError("请求来源不正确", 403);
      }
    }
  });
  app.get("/api/health", async () => ({
    ok: true,
    app: "AI 共创课堂",
    version: "0.5.0",
    storage: store.dialect,
    syncMode,
  }));
  async function studentState(request, reply) {
    const person = await student(request);
    if (person.expires < Date.now() + 43200000)
      await store.run(
        "UPDATE participants SET expires=? WHERE id=?",
        Date.now() + 86400000,
        person.id,
      );
    setCookie(
      reply,
      "workshop_student",
      cookieValue(request, "workshop_student"),
    );
    return await state(person);
  }
  app.get("/api/session", async (request, reply) => {
    try {
      if (request.query.role === "teacher") {
        await teacher(request);
        return { state: await state() };
      }
      return { state: await studentState(request, reply) };
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
      valid = await verifyPassword(password, await store.meta("password"));
    } finally {
      passwordJobs--;
    }
    if (!valid) throw new AppError("教师密码不正确", 401);
    limits.delete(`login:${request.ip}`);
    const value = token();
    await store.run(
      "INSERT INTO teachers VALUES (?,?)",
      hash(value),
      Date.now() + 43200000,
    );
    setCookie(reply, "workshop_teacher", value, 43200);
    return { ok: true };
  });
  app.post("/api/logout", async (request, reply) => {
    const session = await teacher(request);
    await store.run("DELETE FROM teachers WHERE token=?", session.token);
    for (const client of clients)
      if (client.teacherToken === session.token) client.res.end();
    setCookie(reply, "workshop_teacher", "", 0);
    return { ok: true };
  });
  app.get("/api/teacher/state", async (request) => {
    await teacher(request);
    return await state();
  });
  app.post("/api/teacher/control", async (request) => {
    await teacher(request);
    const body = request.body;
    if (!body || !["page", "stage", "pause", "end"].includes(body.action))
      throw new AppError("请选择有效的课堂操作");
    const current = await store.room();
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
    await store.control(next);
    broadcast();
    return await state();
  });
  app.post("/api/teacher/new-room", async (request) => {
    await teacher(request);
    const current = await store.room();
    if (request.body?.roomId !== current.id)
      throw new AppError("课堂已更新，请刷新后操作", 409);
    if (current.pageOpen && current.stage !== "ended")
      throw new AppError("请先结束课堂或关闭课堂页面，再开始新课堂", 409);
    await store.newRoom();
    broadcast();
    return await state();
  });
  app.get("/api/teacher/share", async (request) => {
    await teacher(request);
    // The browser sees the public HTTPS origin even when a proxy talks HTTP
    // to this process. This read-only hint does not change trusted origins.
    let browserOrigin = "";
    if (request.query.origin !== undefined) {
      try {
        const parsed = new URL(request.query.origin);
        if (
          !["http:", "https:"].includes(parsed.protocol) ||
          parsed.username ||
          parsed.password ||
          parsed.pathname !== "/" ||
          parsed.search ||
          parsed.hash
        )
          throw new Error();
        browserOrigin = parsed.origin;
      } catch {
        throw new AppError("分享地址不正确，请刷新教师页面重试");
      }
    }
    const base =
      publicUrl ||
      browserOrigin ||
      `${request.protocol}://${request.headers.host}`;
    const url = `${base}/classroom/${(await store.room()).id}`;
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
    limit(`join:${request.ip}`, 1200);
    const classroomId = request.body?.classroomId;
    const room =
      typeof classroomId === "string" && classroomId.length <= 100
        ? await store.room(classroomId)
        : null;
    if (!room)
      throw new AppError(
        "当前网站找不到这节课堂，请使用老师从当前教师页面复制的完整学生链接",
        404,
      );
    if (room.id !== (await store.meta("current")))
      return { state: null, ended: true };
    try {
      return { state: await studentState(request, reply) };
    } catch (error) {
      if (error.statusCode !== 401) throw error;
    }
    if (room.stage === "ended") return { state: null, ended: true };
    const value = token(),
      id = randomUUID();
    await store.run(
      "INSERT INTO participants (id,room_id,token,expires) VALUES (?,?,?,?)",
      id,
      await store.meta("current"),
      hash(value),
      Date.now() + 86400000,
    );
    await store.touch(room.id);
    setCookie(reply, "workshop_student", value);
    broadcast();
    return {
      state: await state(
        await store.get("SELECT * FROM participants WHERE id=?", id),
      ),
    };
  });
  app.get(
    "/api/student/state",
    async (request, reply) => await studentState(request, reply),
  );
  app.post("/api/student/submit/:kind", async (request) => {
    let person = await student(request);
    await store.lockParticipant(person.id);
    person = await student(request);
    const kind = request.params.kind,
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
    const existing = await store.get(
      "SELECT content,deleted_at FROM submissions WHERE participant_id=? AND kind=?",
      person.id,
      kind,
    );
    if (existing) {
      if (existing.deleted_at !== null)
        throw new AppError("本主题作品已被老师移除，如有疑问请联系老师", 409);
      if (
        existing.content === JSON.stringify(content) &&
        (kind !== "discover" ||
          (name === person.name && school === person.school))
      )
        return { ok: true, repeated: true };
      throw new AppError("本主题已经提交，请查看自己的记录", 409);
    }
    if (!(await store.room())[`${kind}Open`])
      throw new AppError(
        "课堂节奏已变化，当前主题尚未开放、已暂停或已结束",
        409,
      );
    if (needsIdentity && !schools.includes(school))
      throw new AppError("请从下拉列表选择学校");
    await store.transaction(async () => {
      if (needsIdentity)
        await store.run(
          "UPDATE participants SET name=?,school=? WHERE id=?",
          name,
          school,
          person.id,
        );
      await store.run(
        "INSERT INTO submissions (room_id,participant_id,kind,content,created_at) VALUES (?,?,?,?,?)",
        person.room_id,
        person.id,
        kind,
        JSON.stringify(content),
        Date.now(),
      );
    });
    await store.touch(person.room_id);
    broadcast();
    return { ok: true };
  });
  app.get("/api/board", async (request) => {
    const actor = await audience(request);
    const isTeacher = request.query.role === "teacher";
    const kind = request.query.kind;
    if (!kinds.includes(kind)) throw new AppError("环节不存在", 404);
    if (!isTeacher) {
      const current = await store.room();
      if (!current.pageOpen || current.stage !== kind)
        throw new AppError("请跟随老师查看当前主题", 403);
      if (
        !(await store.get(
          "SELECT id FROM submissions WHERE participant_id=? AND kind=?",
          actor.id,
          kind,
        ))
      )
        throw new AppError("先提交本主题的回答，再查看同学的分享", 403);
    }
    const page = Number(request.query.page || 1),
      query = (request.query.q || "").trim(),
      schoolFilter = request.query.school || "",
      status = request.query.status || "visible";
    if (!isTeacher && (status !== "visible" || schoolFilter))
      throw new AppError("只有老师可以使用管理筛选", 403);
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      page > 100000 ||
      query.length > 80 ||
      typeof schoolFilter !== "string" ||
      schoolFilter.length > 100 ||
      status !== "visible"
    )
      throw new AppError("列表查询条件不正确");
    let where =
      "FROM submissions s JOIN participants p ON p.id=s.participant_id WHERE s.room_id=? AND s.kind=? AND s.deleted_at IS NULL AND instr(p.name || p.school || s.content,?)>0";
    const args = [await store.meta("current"), kind, query];
    if (schoolFilter) {
      where += " AND p.school=?";
      args.push(schoolFilter);
    }
    const total = (await store.get(`SELECT COUNT(*) n ${where}`, ...args)).n;
    const pages = Math.max(1, Math.ceil(total / 50)),
      actualPage = Math.min(page, pages);
    const rows = (
      await store.all(
        `SELECT s.id,p.id participantId,p.name,p.school,s.content,s.created_at createdAt ${where} ORDER BY s.id DESC LIMIT 50 OFFSET ?`,
        ...args,
        (actualPage - 1) * 50,
      )
    ).map(({ content, ...row }) => ({ ...row, ...JSON.parse(content) }));
    return { rows, total, page: actualPage, pages };
  });
  app.post("/api/teacher/submissions/moderate", async (request) => {
    await teacher(request);
    const { roomId, ids, action } = request.body ?? {};
    if (roomId !== (await store.meta("current")))
      throw new AppError("课堂已更新，请刷新后再处理提交", 409);
    if (
      action !== "delete" ||
      !Array.isArray(ids) ||
      ids.length < 1 ||
      ids.length > 50 ||
      ids.some((id) => !Number.isSafeInteger(id) || id < 1) ||
      new Set(ids).size !== ids.length
    )
      throw new AppError("请选择 1–50 份不同的提交进行删除");
    const placeholders = ids.map(() => "?").join(",");
    const changed = await store.transaction(async () => {
      const found = (
        await store.get(
          `SELECT COUNT(*) n FROM submissions WHERE room_id=? AND id IN (${placeholders})`,
          roomId,
          ...ids,
        )
      ).n;
      if (found !== ids.length)
        throw new AppError(
          "选择中包含不存在或不属于本节课的提交，请刷新后重试",
          409,
        );
      return (
        await store.run(
          `UPDATE submissions SET content='{}',deleted_at=? WHERE room_id=? AND id IN (${placeholders}) AND deleted_at IS NULL`,
          Date.now(),
          roomId,
          ...ids,
        )
      ).changes;
    });
    if (changed) {
      await store.touch(roomId);
      broadcast();
    }
    return { ok: true, changed };
  });
  app.get("/api/teacher/export", async (request, reply) => {
    await teacher(request);
    const rows = await store.all(
      "SELECT p.name,p.school,s.kind,s.content,s.created_at FROM submissions s JOIN participants p ON p.id=s.participant_id WHERE s.room_id=? AND s.deleted_at IS NULL ORDER BY s.id",
      await store.meta("current"),
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
      `attachment; filename="ai-classroom-${(await store.room()).id}.csv"`,
    );
    return reply
      .type("text/csv; charset=utf-8")
      .send(
        "\uFEFF" + records.map((r) => r.map(csvCell).join(",")).join("\r\n"),
      );
  });
  app.get("/api/events", async (request, reply) => {
    const actor = await audience(request),
      isTeacher = request.query.role === "teacher";
    if (syncMode !== "sse") throw new AppError("本课堂使用定时同步", 404);
    if (clients.size >= 5000)
      throw new AppError("实时连接繁忙，请稍后重试", 503);
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-cache, no-transform",
      "Content-Encoding": "identity",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.flushHeaders();
    reply.raw.write("retry: 3000\nevent: ready\ndata: connected\n\n");
    const client = {
      res: reply.raw,
      expires: actor.expires,
      teacherToken: isTeacher ? actor.token : null,
    };
    clients.add(client);
    reply.raw.on("close", () => clients.delete(client));
  });
  const timer = setInterval(async () => {
    for (const client of clients)
      if (
        client.expires < Date.now() ||
        (!client.res.destroyed &&
          !client.res.write("event: heartbeat\ndata: connected\n\n"))
      )
        client.res.end();
    for (const [key, value] of limits)
      if (value.until < Date.now()) limits.delete(key);
    await store
      .run("DELETE FROM teachers WHERE expires<?", Date.now())
      .catch((error) =>
        console.error("session_cleanup_failed", error.code || "DATABASE_ERROR"),
      );
  }, 20000);
  timer.unref();
  app.addHook("preClose", async () => {
    for (const client of clients) client.res.end();
  });
  app.addHook("onClose", async () => {
    clearInterval(timer);
    clearTimeout(pendingBroadcast);
    if (vite) await vite.close();
    await store.close();
  });
  app.get("/", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const legacyCode = request.query.code;
    if (legacyCode === undefined) return reply.redirect("/teacher");
    // Previously distributed links keep pointing at their original classroom.
    const id = (
      await store.get("SELECT id FROM rooms WHERE code=?", String(legacyCode))
    )?.id;
    return reply.redirect(
      `/classroom/${encodeURIComponent(id || "unavailable")}`,
    );
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
