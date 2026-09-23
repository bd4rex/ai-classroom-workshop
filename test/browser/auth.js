// Run only against the isolated PostgreSQL QA server on port 3219.
async (page) => {
  const base = 'http://127.0.0.1:3219';
  const browser = page.context().browser();
  const teacherContext = await browser.newContext();
  const studentContext = await browser.newContext();
  const teacher = await teacherContext.newPage(), student = await studentContext.newPage();
  const check = (ok, message) => { if (!ok) throw Error(message); };
  let events = 0, joins = 0;
  teacher.on('request', r => { if (r.url().includes('/api/events')) events++; });
  const blockCookie = async route => {
    const response = await route.fetch();
    const headers = response.headers();
    delete headers['set-cookie'];
    await route.request().frame().page().context().clearCookies();
    await route.fulfill({ response, headers });
  };
  try {
    await teacher.route('**/api/login', blockCookie);
    await teacher.goto(base + '/teacher');
    await teacher.getByRole('textbox', { name:'教师密码', exact:true }).fill('isolated-browser-test-only');
    await teacher.getByRole('button', { name:'进入教师工作台', exact:true }).click();
    await teacher.getByRole('alert').filter({hasText:'登录会话未建立'}).waitFor();
    await teacher.unroute('**/api/login', blockCookie);
    await teacher.getByRole('button', { name:'进入教师工作台', exact:true }).click();
    const gate = teacher.getByRole('switch', { name:'课堂页面开关', exact:true });
    await gate.waitFor();
    const link = await teacher.getByRole('textbox', { name:'学生加入链接', exact:true }).inputValue();
    await student.route('**/api/join', blockCookie);
    student.on('request', r => { if (r.url().endsWith('/api/join')) joins++; });
    await student.goto(link);
    await student.getByText('浏览器未保存课堂身份，请在独立标签页打开老师分享的链接。', {exact:true}).waitFor();
    await teacher.route('**/api/session?*', route => route.fulfill({status:200,contentType:'text/html',body:'<html>proxy unavailable</html>'}));
    await teacher.getByRole('status').filter({hasText:'连接中断'}).waitFor();
    check(await gate.isVisible(), '异常响应把已登录教师踢回登录页');
    await teacher.unroute('**/api/session?*');
    await teacher.getByRole('status').filter({hasText:'课堂定时同步'}).waitFor();
    check(events === 0, 'PostgreSQL 模式仍发出了长连接请求');
    check(joins === 1, 'Cookie 被拦截时反复新建学生身份');
    return { passed:true, cookieBlockedLogin:'explicit-error', cookieBlockedStudent:'one-join-only', invalidResponse:'preserves-session-and-recovers', eventRequests:events };
  } finally { await teacherContext.close(); await studentContext.close(); }
}
