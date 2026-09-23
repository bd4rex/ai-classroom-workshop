// prettier-ignore
// Run only against the isolated QA service. This creates a classroom and demo response.
async (page) => {
  const base = "http://127.0.0.1:3219";
  const check = (value, message) => { if (!value) throw Error(message); };
  const button = (p, name) => p.getByRole("button", { name, exact: true });
  const field = (p, name) => p.getByRole("textbox", { name: `${name} 必填`, exact: true });
  let holdEvents = true, failState = false;
  const pending = [], problems = [];
  const setup = async (context) => {
    await context.route("**/api/events?*", async (route) => {
      if (holdEvents) pending.push(route);
      else await route.continue();
    });
    await context.route("**/api/session?*", async (route) => {
      if (failState) await route.abort();
      else await route.continue();
    });
  };
  const watch = (p) => p.on("pageerror", (error) => problems.push(error.message));
  const teacherContext = page.context();
  const studentContext = await teacherContext.browser().newContext({ viewport: { width: 1366, height: 768 } });
  await setup(teacherContext);
  await setup(studentContext);
  watch(page);
  const student = await studentContext.newPage();
  watch(student);
  try {
    await page.goto(base + "/teacher");
    const password = page.getByRole("textbox", { name: "教师密码", exact: true });
    const gate = page.getByRole("switch", { name: "课堂页面开关", exact: true });
    await password.or(gate).first().waitFor();
    if (await password.isVisible()) {
      await password.fill("isolated-browser-test-only");
      await button(page, "进入教师工作台").click();
    }
    await gate.waitFor();
    if (await gate.getAttribute("aria-checked") === "true") await gate.click();
    await page.getByText("课堂工具", { exact: true }).click();
    const before = await page.getByRole("textbox", { name: "学生加入链接" }).inputValue();
    await button(page, "开始新一节课").click();
    await button(page, "确认开始新课堂").click();
    await page.waitForFunction((old) => {
      const value = document.querySelector('[aria-label="学生加入链接"]')?.value;
      return value?.startsWith("http") && value !== old;
    }, before);
    const link = await page.getByRole("textbox", { name: "学生加入链接" }).inputValue();
    await page.getByText("课堂定时同步", { exact: true }).waitFor();
    await student.goto(link);
    await student.getByRole("heading", { name: "课堂页面暂未开放", exact: true }).waitFor();
    await student.getByText("课堂定时同步", { exact: true }).waitFor();
    await gate.click();
    await button(page, "切换到一起发现").click();
    await field(student, "姓名").waitFor({ timeout: 16000 });
    await student.getByRole("combobox", { name: "学校 必填", exact: true }).selectOption({ index: 1 });
    await field(student, "姓名").fill("连接检查同学");
    await field(student, "领域").fill("学习");
    await field(student, "应用场景").fill("人工智能辅助整理知识点。");
    await field(student, "价值").fill("便于复习。");
    await button(student, "提交并查看同学分享").click();
    await page.getByRole("row").filter({ hasText: "连接检查同学" }).waitFor({ timeout: 16000 });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.screenshot({ path: "output/playwright/teacher-polling-v041.png", fullPage: true });
    await button(page, "切换到一起设计").click();
    await field(student, "基本功能").waitFor({ timeout: 16000 });
    check(await page.getByText("课堂定时同步", { exact: true }).isVisible(), "长连接静默时错误显示实时同步");
    failState = true;
    for (const p of [page, student]) await p.getByText("连接中断，正在重试", { exact: true }).waitFor({ timeout: 16000 });
    failState = false;
    for (const p of [page, student]) await p.getByText("课堂定时同步", { exact: true }).waitFor({ timeout: 16000 });
    holdEvents = false;
    for (const route of pending.splice(0)) await route.continue().catch(() => {});
    for (const p of [page, student]) await p.getByText("课堂实时同步", { exact: true }).waitFor({ timeout: 16000 });
    check(await page.getByRole("textbox", { name: "学生加入链接" }).inputValue() === link, "连接模式改变了固定链接");
    await student.goto(base + "/classroom/missing-deployment-classroom");
    await student.getByText("当前网站找不到这节课堂，请使用老师从当前教师页面复制的完整学生链接", { exact: true }).waitFor();
    check(await field(student, "基本功能").count() === 0, "错误链接进入了别的课堂");
    await student.goto(link);
    await field(student, "基本功能").waitFor();
    check(await field(student, "姓名").count() === 0, "正确链接未复用已有身份");
    check(problems.length === 0, JSON.stringify(problems));
    return { passed: true, checks: ["silent SSE with healthy polling", "teacher receives submissions without SSE", "student follows stages without SSE", "failed state requests show offline", "recovery returns to polling then live", "fixed link unchanged", "unknown classroom stays isolated", "no page exceptions"] };
  } finally {
    holdEvents = false;
    for (const route of pending.splice(0)) await route.abort().catch(() => {});
    await studentContext.close();
    await teacherContext.unroute("**/api/events?*");
    await teacherContext.unroute("**/api/session?*");
  }
}
