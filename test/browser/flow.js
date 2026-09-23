// prettier-ignore
// Run only against the isolated QA server on port 3219 (see TEST_REPORT.md).
async (page) => {
  const base = "http://127.0.0.1:3219";
  const problems = [];
  const watch = (p) => {
    p.on("pageerror", (e) => problems.push(e.message));
    p.on("console", (e) => { if (e.type() === "error") problems.push(e.text()); });
  };
  const check = (value, message) => { if (!value) throw Error(message); };
  const button = (p, name) => p.getByRole("button", { name, exact: true });
  const field = (p, name) => p.getByRole("textbox", { name: `${name} 必填`, exact: true });
  const locked = (p) => p.getByRole("heading", { name: "先写下你的想法", exact: true });
  const post = (p, name) => p.getByRole("article", { name: `${name}的分享`, exact: true });
  const submit = (p) => button(p, "提交并查看同学分享");
  const noClassroomCode = async (p) => check(!(await p.locator("body").innerText()).includes("课堂码"), "页面仍显示课堂码");
  const pauseText = "老师暂停了填写，先听一听大家的想法。已解锁的分享仍可阅读。";
  watch(page);
  await page.goto(base + "/");
  const password = page.getByRole("textbox", { name: "教师密码", exact: true });
  const gate = page.getByRole("switch", { name: "课堂页面开关", exact: true });
  await password.or(gate).first().waitFor();
  check(page.url() === base + "/teacher", "根地址没有进入教师页面");
  check(await page.getByRole("link", { name: "学生入口", exact: true }).count() === 0, "教师登录页仍有不固定的学生入口");
  await noClassroomCode(page);
  if (await password.isVisible()) {
    await password.fill("isolated-browser-test-only");
    await button(page, "进入教师工作台").click();
  }
  await gate.waitFor();
  if (await gate.getAttribute("aria-checked") === "true") await gate.click();
  await page.getByText("课堂工具", { exact: true }).click();
  await button(page, "开始新一节课").click();
  const oldLink = await page.getByRole("textbox", { name: "学生加入链接" }).inputValue();
  await button(page, "确认开始新课堂").click();
  await page.waitForFunction((old) => {
    const link = document.querySelector('[aria-label="学生加入链接"]')?.value;
    return link?.startsWith("http") && link !== old;
  }, oldLink);
  const link = await page.getByRole("textbox", { name: "学生加入链接" }).inputValue();
  check(link.startsWith(base + "/classroom/") && !link.includes("?"), "没有使用固定课堂路径");
  await noClassroomCode(page);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await button(page, "复制学生端链接").click();
  await button(page, "链接已复制").waitFor();
  check(await page.evaluate(() => navigator.clipboard.readText()) === link, "复制的链接不正确");
  const browser = page.context().browser();
  const ca = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const cb = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const a = await ca.newPage(), b = await cb.newPage();
  watch(a); watch(b);
  try {
    await a.goto(base + "/");
    await a.getByRole("textbox", { name: "教师密码", exact: true }).waitFor();
    check(a.url() === base + "/teacher", "新访客打开根地址没有进入教师登录页");
    check((await ca.cookies()).every(c => c.name !== "workshop_student"), "根地址创建了学生身份");
    await a.screenshot({ path: "output/playwright/root-teacher-login-v042.png", fullPage: true });
    for (const p of [a, b]) {
      await p.goto(link);
      await p.getByRole("heading", { name: "课堂页面暂未开放", exact: true }).waitFor();
      check(p.url() === link, "学生没有停留在课堂固定链接");
      await noClassroomCode(p);
      check(await button(p, "加入课堂").count() === 0, "学生仍需手动加入");
    }
    await gate.click();
    await a.getByRole("heading", { name: "已加入课堂，准备好出发", exact: true }).waitFor();
    await button(page, "切换到一起发现").click();
    for (const p of [a, b]) {
      await field(p, "姓名").waitFor();
      await locked(p).waitFor();
    }
    await a.getByRole("combobox", { name: "学校 必填", exact: true }).selectOption({ index: 1 });
    await field(a, "姓名").fill("小禾（演示）");
    await field(a, "领域").fill("交通出行");
    await field(a, "应用场景").fill("导航根据实时路况推荐路线，避开拥堵。");
    await field(a, "价值").fill("节省出行时间，让交通更顺畅。");
    await b.getByRole("combobox", { name: "学校 必填", exact: true }).selectOption({ index: 2 });
    await field(b, "姓名").fill("小宇（演示）");
    await field(b, "领域").fill("校园学习草稿");
    await b.reload();
    await field(b, "领域").waitFor();
    check(await field(b, "领域").inputValue() === "校园学习草稿", "刷新丢失草稿");
    await b.screenshot({ path: "output/playwright/student-locked-tablet-v4.png", fullPage: true });
    await submit(a).click();
    await post(a, "小禾（演示）").waitFor();
    check(await locked(b).isVisible() && await post(b, "小禾（演示）").count() === 0, "未提交者看到同学内容");
    await button(page, "暂停填写").click();
    await b.getByText(pauseText, { exact: true }).waitFor();
    check(!await submit(b).isEnabled(), "暂停后仍可提交");
    check(await a.getByText(pauseText, { exact: true }).isVisible(), "已提交者未收到暂停提示");
    check(await post(a, "小禾（演示）").isVisible(), "暂停隐藏了已解锁分享");
    await button(page, "继续填写").click();
    await button(page, "切换到一起设计").click();
    for (const p of [a, b]) { await field(p, "基本功能").waitFor(); await locked(p).waitFor(); }
    check(await submit(b).isEnabled(), "未提交发现的学生不能直接进入设计");
    check(await field(b, "姓名").inputValue() === "小宇（演示）", "切换主题丢失身份草稿");
    await field(b, "场景").fill("学校图书馆寻找适合自己的书。");
    await field(b, "基本功能").fill("根据兴趣推荐图书，用语音介绍内容，并指引书架位置。");
    await submit(b).click();
    await post(b, "小宇（演示）").waitFor();
    check(await locked(a).isVisible() && await post(a, "小宇（演示）").count() === 0, "发现提交错误解锁设计分享");
    await field(a, "场景").fill("帮助独自在家的老人照顾阳台花草。");
    await field(a, "基本功能").fill("识别叶片状态，提醒浇水，并根据天气自动调整遮阳。");
    await submit(a).click();
    await post(b, "小禾（演示）").waitFor();
    await post(a, "小宇（演示）").waitFor();
    await button(page, "切换到一起发现").click();
    await field(b, "领域").waitFor();
    check(await field(b, "领域").inputValue() === "校园学习草稿", "切回发现丢失草稿");
    check(await locked(b).isVisible(), "设计提交错误解锁发现分享");
    check(await field(b, "姓名").count() === 0, "已提交身份没有沿用");
    await field(b, "应用场景").fill("语音转文字，帮助我们整理课堂笔记。");
    await field(b, "价值").fill("更方便地回顾知识，也帮助听力不便的同学。");
    await submit(b).click();
    await post(a, "小宇（演示）").waitFor();
    await a.reload();
    await post(a, "小宇（演示）").waitFor();
    const search = a.getByRole("textbox", { name: "搜索同学分享", exact: true });
    await search.fill("小禾");
    await post(a, "小宇（演示）").waitFor({ state: "hidden" });
    check(await post(a, "小禾（演示）").count() === 1, "搜索结果不完整");
    await search.fill("");
    await post(a, "小宇（演示）").waitFor();
    const teacherRow = (name) => page.getByRole("row").filter({ hasText: name });
    const schoolFilter = page.getByRole("combobox", { name: "按学校筛选", exact: true });
    const teacherSearch = page.getByRole("textbox", { name: "搜索同学分享", exact: true });
    const chooseAll = page.getByRole("checkbox", { name: "选择本页全部提交", exact: true });
    await teacherRow("小宇（演示）").waitFor();
    await schoolFilter.selectOption({ index: 1 });
    await teacherRow("小宇（演示）").waitFor({ state: "hidden" });
    await teacherRow("小禾（演示）").waitFor();
    await teacherSearch.fill("小宇");
    await page.getByText("没有找到匹配的内容", { exact: true }).waitFor();
    await teacherSearch.fill("导航");
    await teacherRow("小禾（演示）").waitFor();
    await chooseAll.check();
    await page.getByText("已选 1 份", { exact: true }).waitFor();
    await schoolFilter.selectOption("");
    await page.getByText("已选 0 份", { exact: true }).waitFor();
    check(!await button(page, "删除所选").isEnabled(), "筛选变化后保留了隐藏选择");
    await teacherSearch.fill("");
    await teacherRow("小宇（演示）").waitFor();
    const deleteDialog = page.getByRole("dialog", { name: "确认删除提交", exact: true });
    await button(page, "删除小禾（演示）的提交").click();
    await deleteDialog.waitFor();
    check((await deleteDialog.innerText()).includes("小禾（演示）"), "删除确认缺少选中姓名");
    check((await deleteDialog.innerText()).includes("删除后不可恢复"), "删除确认没有说明永久清除");
    await deleteDialog.getByRole("button", { name: "取消", exact: true }).click();
    check(await teacherRow("小禾（演示）").isVisible(), "取消删除仍删除了记录");
    await button(page, "删除小禾（演示）的提交").click();
    await deleteDialog.getByRole("button", { name: "确认删除", exact: true }).click();
    await page.getByText("已删除 1 份提交，作品正文已清除。", { exact: true }).waitFor();
    for (const p of [a, b]) await post(p, "小禾（演示）").waitFor({ state: "hidden" });
    const removedText = "本主题作品已被老师移除";
    await a.getByText(removedText, { exact: true }).waitFor();
    check(!(await a.locator("body").innerText()).includes("导航根据实时路况推荐路线，避开拥堵。"), "作者页面仍泄露已删除内容");
    await teacherRow("小禾（演示）").waitFor({ state: "hidden" });
    await teacherRow("小宇（演示）").waitFor();
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.screenshot({ path: "output/playwright/teacher-after-delete-v4.png", fullPage: true });
    await a.screenshot({ path: "output/playwright/student-removed-v4.png", fullPage: true });
    await page.getByRole("tab", { name: /一起设计/ }).click();
    await teacherRow("小禾（演示）").waitFor();
    await teacherRow("小宇（演示）").waitFor();
    await chooseAll.check();
    await page.getByText("已选 2 份", { exact: true }).waitFor();
    await button(page, "删除所选").click();
    await deleteDialog.getByRole("button", { name: "确认删除", exact: true }).click();
    await page.getByText("已删除 2 份提交，作品正文已清除。", { exact: true }).waitFor();
    await button(page, "切换到一起设计").click();
    for (const p of [a, b]) {
      await p.getByText(removedText, { exact: true }).waitFor();
      await post(p, "小禾（演示）").waitFor({ state: "hidden" });
      await post(p, "小宇（演示）").waitFor({ state: "hidden" });
    }
    await button(page, "切换到一起发现").click();
    for (const p of [a, b]) {
      await post(p, "小宇（演示）").waitFor();
      check(await post(p, "小禾（演示）").count() === 0, "切回主题后已删除作品重新出现");
      check(await button(p, "删除所选").count() === 0, "学生端出现管理操作");
      await noClassroomCode(p);
    }
    await teacherRow("小宇（演示）").waitFor();
    await noClassroomCode(page);
    const desktop = await a.evaluate(() => {
      const [left, right] = [...document.querySelectorAll(".student-split > *")].map((el) => el.getBoundingClientRect());
      return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, sideBySide: right.x >= left.right && right.y === left.y };
    });
    const tablet = await b.evaluate(() => {
      const [left, right] = [...document.querySelectorAll(".student-split > *")].map((el) => el.getBoundingClientRect());
      return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, sideBySide: right.x >= left.right && right.y === left.y };
    });
    check(desktop.sideBySide && desktop.width === desktop.scrollWidth, "桌面左右布局或宽度错误");
    check(tablet.sideBySide && tablet.width === tablet.scrollWidth, "平板横屏左右布局或宽度错误");
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.screenshot({ path: "output/playwright/teacher-desktop-v4.png", fullPage: true });
    await a.screenshot({ path: "output/playwright/student-desktop-v4.png", fullPage: true });
    await b.screenshot({ path: "output/playwright/student-tablet-v4.png", fullPage: true });
    await a.setViewportSize({ width: 1920, height: 1080 });
    const large = await a.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    check(large.width === large.scrollWidth, "大屏页面横向溢出");
    await a.screenshot({ path: "output/playwright/student-large-v4.png", fullPage: true });
    await gate.click();
    for (const p of [a, b]) {
      await p.getByRole("heading", { name: "课堂页面暂未开放", exact: true }).waitFor();
      check(await p.getByRole("article").count() === 0, "总开关关闭后仍显示作品");
    }
    await gate.click();
    await post(a, "小宇（演示）").waitFor();
    await button(page, "结束本节课").click();
    await button(page, "确认结束课堂").click();
    for (const p of [a, b]) {
      await p.getByRole("heading", { name: "本节课堂已结束", exact: true }).waitFor();
      await noClassroomCode(p);
    }
    check(await page.getByRole("row").filter({ hasText: "小宇（演示）" }).count() === 1, "结束后教师记录丢失");
    check(await page.getByRole("textbox", { name: "学生加入链接" }).inputValue() === link, "课堂节奏改变了链接");
    const fresh = await browser.newContext();
    try {
      const late = await fresh.newPage();
      await late.goto(link);
      await late.getByRole("heading", { name: "本节课堂已结束", exact: true }).waitFor();
      check((await fresh.cookies()).every(c => c.name !== "workshop_student"), "结束链接仍创建了学生身份");
    } finally { await fresh.close(); }
    await button(page, "开始新一节课").click();
    await button(page, "确认开始新课堂").click();
    await page.waitForFunction((previous) => {
      const value = document.querySelector('[aria-label="学生加入链接"]')?.value;
      return value?.startsWith("http") && value !== previous;
    }, link);
    const nextLink = await page.getByRole("textbox", { name: "学生加入链接" }).inputValue();
    const fallback = await page.context().newPage();
    try {
      await fallback.addInitScript(() => Object.defineProperty(navigator, "clipboard", { value: undefined }));
      await fallback.goto(base + "/");
      await button(fallback, "复制学生端链接").click();
      await button(fallback, "链接已复制").waitFor();
      check(fallback.url() === base + "/teacher", "已登录教师访问根地址没有回到工作台");
      check(await page.evaluate(() => navigator.clipboard.readText()) === nextLink, "无 Clipboard API 时的复制失败");
    } finally { await fallback.close(); }
    await a.reload();
    await a.getByRole("heading", { name: "本节课堂已结束", exact: true }).waitFor();
    const oldIdentity = (await cb.cookies()).find(c => c.name === "workshop_student")?.value;
    check(Boolean(oldIdentity), "缺少原课堂的学生身份");
    await b.goto(base + "/");
    await b.getByRole("textbox", { name: "教师密码", exact: true }).waitFor();
    check(b.url() === base + "/teacher", "已有学生身份访问根地址进入了课堂");
    check((await cb.cookies()).find(c => c.name === "workshop_student")?.value === oldIdentity, "访问根地址改变了学生身份");
    await page.waitForFunction(() => document.querySelector(".classroom-stats strong")?.textContent === "0");
    await b.goto(nextLink);
    await b.getByRole("heading", { name: "课堂页面暂未开放", exact: true }).waitFor();
    await b.goto(link);
    await b.getByRole("heading", { name: "本节课堂已结束", exact: true }).waitFor();
    await b.goto(nextLink);
    await b.getByRole("heading", { name: "课堂页面暂未开放", exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector(".classroom-stats strong")?.textContent === "1");
    check(problems.length === 0, JSON.stringify(problems));
    return { passed: true, actors: "one teacher, two isolated student contexts", checks: ["root opens teacher page without student enrollment", "no classroom code in visible teacher/student pages", "school and keyword filters", "selection reset on filter change", "single delete with cancel", "permanent single and batch deletion", "live removal from author and peer pages", "fixed link copy", "copy fallback without Clipboard API", "automatic entry without code", "stable link after controls", "old link isolation", "page gate", "waiting", "automatic topic sync", "skip first submission", "per-topic unlock", "draft recovery", "live peer rows", "pause/resume", "end", "search", "responsive layout", "no console errors"], desktop, tablet, large };
  } finally { await ca.close(); await cb.close(); }
}
