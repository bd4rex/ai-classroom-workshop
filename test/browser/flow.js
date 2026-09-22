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
  const pauseText = "老师暂停了填写，先听一听大家的想法。已解锁的分享仍可阅读。";
  watch(page);
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
  await button(page, "开始新一节课").click();
  const oldLink = await page.getByRole("textbox", { name: "学生加入链接" }).inputValue();
  await button(page, "确认开始新课堂").click();
  await page.waitForFunction((old) => {
    const link = document.querySelector('[aria-label="学生加入链接"]')?.value;
    return link?.startsWith("http") && link !== old;
  }, oldLink);
  const link = await page.getByRole("textbox", { name: "学生加入链接" }).inputValue();
  const browser = page.context().browser();
  const ca = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const cb = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const a = await ca.newPage(), b = await cb.newPage();
  watch(a); watch(b);
  try {
    for (const p of [a, b]) {
      await p.goto(link);
      await button(p, "加入课堂").click();
      await p.getByRole("heading", { name: "课堂页面暂未开放", exact: true }).waitFor();
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
    await b.screenshot({ path: "output/playwright/student-locked-tablet-v2.png", fullPage: true });
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
    await page.screenshot({ path: "output/playwright/teacher-desktop-v2.png", fullPage: true });
    await a.screenshot({ path: "output/playwright/student-desktop-v2.png", fullPage: true });
    await b.screenshot({ path: "output/playwright/student-tablet-v2.png", fullPage: true });
    await a.setViewportSize({ width: 1920, height: 1080 });
    const large = await a.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    check(large.width === large.scrollWidth, "大屏页面横向溢出");
    await a.screenshot({ path: "output/playwright/student-large-v2.png", fullPage: true });
    await gate.click();
    for (const p of [a, b]) {
      await p.getByRole("heading", { name: "课堂页面暂未开放", exact: true }).waitFor();
      check(await p.getByRole("article").count() === 0, "总开关关闭后仍显示作品");
    }
    await gate.click();
    await post(a, "小宇（演示）").waitFor();
    await button(page, "结束本节课").click();
    await button(page, "确认结束课堂").click();
    for (const p of [a, b]) await p.getByRole("heading", { name: "本节课堂已结束", exact: true }).waitFor();
    check(await page.getByRole("row").filter({ hasText: "小宇（演示）" }).count() === 1, "结束后教师记录丢失");
    check(problems.length === 0, JSON.stringify(problems));
    return { passed: true, actors: "one teacher, two isolated student contexts", checks: ["page gate", "waiting", "automatic topic sync", "skip first submission", "per-topic unlock", "draft recovery", "live peer rows", "pause/resume", "end", "search", "responsive layout", "no console errors"], desktop, tablet, large };
  } finally { await ca.close(); await cb.close(); }
}
