// prettier-ignore
// CLI browser regression. Use only with the isolated QA server documented in TEST_REPORT.md.
async (page) => {
  const base = "http://127.0.0.1:3218";
  const problems = [];
  const watch = (p) => {
    p.on("pageerror", (e) => problems.push(e.message));
    p.on("console", (e) => {
      if (e.type() === "error") problems.push(e.text());
    });
  };
  watch(page);
  await page.goto(base + "/teacher");
  await page
    .getByRole("textbox", { name: "教师密码", exact: true })
    .or(page.getByRole("switch", { name: "一起发现提交开关" }))
    .first()
    .waitFor();
  if (
    await page
      .getByRole("textbox", { name: "教师密码", exact: true })
      .isVisible()
  ) {
    await page
      .getByRole("textbox", { name: "教师密码", exact: true })
      .fill("isolated-browser-test-only");
    await page
      .getByRole("button", { name: "进入教师工作台", exact: true })
      .click();
  }
  await page.getByRole("switch", { name: "一起发现提交开关" }).waitFor();
  const discoverSwitch = page.getByRole("switch", { name: "一起发现提交开关" });
  const designSwitch = page.getByRole("switch", { name: "一起设计提交开关" });
  if ((await discoverSwitch.getAttribute("aria-checked")) === "true")
    await discoverSwitch.click();
  if ((await designSwitch.getAttribute("aria-checked")) === "true")
    await designSwitch.click();
  await page.getByText("课堂工具", { exact: true }).click();
  await page.getByRole("button", { name: "开始新一节课", exact: true }).click();
  const oldLink = await page
    .getByRole("textbox", { name: "学生加入链接" })
    .inputValue();
  await page
    .getByRole("button", { name: "确认开始新课堂", exact: true })
    .click();
  await page.waitForFunction(
    (old) =>
      document.querySelector('[aria-label="学生加入链接"]').value !== old &&
      document
        .querySelector('[aria-label="学生加入链接"]')
        .value.startsWith("http"),
    oldLink,
  );
  const link = await page
    .getByRole("textbox", { name: "学生加入链接" })
    .inputValue();
  const browser = page.context().browser();
  const ca = await browser.newContext({
    viewport: { width: 1366, height: 1000 },
  });
  const cb = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const a = await ca.newPage(),
    b = await cb.newPage();
  watch(a);
  watch(b);
  try {
    for (const p of [a, b]) {
      await p.goto(link);
      await p.getByRole("button", { name: "加入课堂", exact: true }).click();
      await p
        .getByRole("button", { name: "第一次提交", exact: true })
        .waitFor();
      if (
        await p
          .getByRole("button", { name: "第一次提交", exact: true })
          .isEnabled()
      )
        throw Error("发现环节提前可提交");
    }
    await discoverSwitch.click();
    await a
      .getByRole("combobox", { name: "学校 必填", exact: true })
      .selectOption({ index: 1 });
    await a
      .getByRole("textbox", { name: "姓名 必填", exact: true })
      .fill("小禾（演示）");
    await a
      .getByRole("textbox", { name: "领域 必填", exact: true })
      .fill("交通出行");
    await a
      .getByRole("textbox", { name: "应用场景 必填", exact: true })
      .fill("导航根据实时路况推荐路线，避开拥堵。");
    await a
      .getByRole("textbox", { name: "价值 必填", exact: true })
      .fill("减少等待时间，让出行更方便。");
    await a.reload();
    await a.getByRole("textbox", { name: "姓名 必填", exact: true }).waitFor();
    if (
      (await a
        .getByRole("textbox", { name: "姓名 必填", exact: true })
        .inputValue()) !== "小禾（演示）"
    )
      throw Error("刷新丢失草稿");
    await a.getByRole("button", { name: "第一次提交", exact: true }).click();
    await a.getByText("第一次提交成功", { exact: true }).waitFor();
    await b
      .getByRole("row")
      .filter({ hasText: "小禾（演示）" })
      .waitFor({ timeout: 5000 });
    await page
      .getByRole("row")
      .filter({ hasText: "小禾（演示）" })
      .waitFor({ timeout: 5000 });
    await discoverSwitch.click();
    await b.waitForFunction(
      () =>
        document.querySelector("#discover-name").disabled ||
        document.querySelector("#discover-name").matches(":disabled"),
    );
    if (
      await b
        .getByRole("button", { name: "第一次提交", exact: true })
        .isEnabled()
    )
      throw Error("关闭后仍可点击提交");
    await designSwitch.click();
    if (
      await b
        .getByRole("button", { name: "第二次提交", exact: true })
        .isEnabled()
    )
      throw Error("未完成第一步却能提交第二步");
    await a
      .getByRole("textbox", { name: "场景 必填", exact: true })
      .fill("帮助独自在家的老人照顾阳台花草。");
    await a
      .getByRole("textbox", { name: "基本功能 必填", exact: true })
      .fill("识别叶片状态，提醒浇水，并根据天气自动调整遮阳。");
    await a.getByRole("button", { name: "第二次提交", exact: true }).click();
    await a.getByText("第二次提交成功", { exact: true }).waitFor();
    await b.getByRole("tab", { name: /一起设计/ }).click();
    await b
      .getByRole("row")
      .filter({ hasText: "帮助独自在家的老人" })
      .waitFor({ timeout: 5000 });
    await discoverSwitch.click();
    await b
      .getByRole("combobox", { name: "学校 必填", exact: true })
      .selectOption({ index: 1 });
    await b
      .getByRole("textbox", { name: "姓名 必填", exact: true })
      .fill("小宇（演示）");
    await b
      .getByRole("textbox", { name: "领域 必填", exact: true })
      .fill("校园学习");
    await b
      .getByRole("textbox", { name: "应用场景 必填", exact: true })
      .fill("语音转文字，帮助我们整理课堂笔记。");
    await b
      .getByRole("textbox", { name: "价值 必填", exact: true })
      .fill("更方便地回顾知识，也帮助听力不便的同学。");
    await b.getByRole("button", { name: "第一次提交", exact: true }).click();
    await b.getByText("第一次提交成功", { exact: true }).waitFor();
    await b
      .getByRole("textbox", { name: "场景 必填", exact: true })
      .fill("学校图书馆寻找适合自己的书。");
    await b
      .getByRole("textbox", { name: "基本功能 必填", exact: true })
      .fill("根据兴趣推荐图书，用语音介绍内容，并指引书架位置。");
    await b.getByRole("button", { name: "第二次提交", exact: true }).click();
    await b.getByText("第二次提交成功", { exact: true }).waitFor();
    await a.getByRole("tab", { name: /一起设计/ }).click();
    await a
      .getByRole("row")
      .filter({ hasText: "小宇（演示）" })
      .waitFor({ timeout: 5000 });
    await discoverSwitch.click();
    await designSwitch.click();
    await a.reload();
    await a.getByText("第二次提交成功", { exact: true }).waitFor();
    await a.getByRole("row").filter({ hasText: "小宇（演示）" }).waitFor();
    await a.getByRole("textbox", { name: "搜索共享列表" }).fill("小禾");
    await a.waitForFunction(
      () => document.querySelectorAll("tbody tr").length === 1,
    );
    await a.getByRole("textbox", { name: "搜索共享列表" }).fill("");
    await a.waitForFunction(
      () => document.querySelectorAll("tbody tr").length === 2,
    );
    await page.setViewportSize({ width: 1366, height: 1000 });
    await page.getByText("课堂工具", { exact: true }).click();
    await page.screenshot({
      path: "output/playwright/teacher-desktop.png",
      fullPage: true,
    });
    await a.screenshot({
      path: "output/playwright/student-desktop.png",
      fullPage: true,
    });
    await b.getByRole("tab", { name: /一起发现/ }).click();
    await b.getByRole("row").filter({ hasText: "小宇（演示）" }).waitFor();
    const mobile = await b.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      tableScroll:
        document.querySelector(".table-scroll").scrollWidth >
        document.querySelector(".table-scroll").clientWidth,
    }));
    if (mobile.scrollWidth > mobile.width) throw Error("手机整页横向溢出");
    if (!mobile.tableScroll) throw Error("手机列表无法横向滚动");
    await b.screenshot({
      path: "output/playwright/student-mobile.png",
      fullPage: true,
    });
    if (problems.length) throw Error(JSON.stringify(problems));
    return {
      passed: true,
      actors: "one teacher, two isolated student contexts",
      checks: [
        "independent switches",
        "waiting before open",
        "two submissions",
        "identity reuse",
        "live peer rows",
        "draft reload",
        "submitted reload",
        "search",
        "mobile 390px",
        "no console errors",
      ],
      mobile,
    };
  } finally {
    await ca.close();
    await cb.close();
  }
}
