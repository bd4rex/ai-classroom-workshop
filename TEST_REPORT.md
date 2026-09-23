# 验证记录

[English](TEST_REPORT.en.md) · [返回说明](README.md)

日期：2026-09-23；版本 0.5.0。本机 macOS、Node.js 24.14.1、PostgreSQL 16、Chromium。所有自动化与压测使用隔离数据库和合成身份，不向生产课堂写入测试数据。

## 自动化检查

- PostgreSQL 模式 `TEST_DATABASE_URL=... npm run check`：40 项通过、0 项失败，生产构建通过。
- 默认 SQLite 模式 `npm test`：37 项通过、3 项 PostgreSQL 专项按预期跳过，0 项失败。
- `npm audit --omit=dev`：0 项已知漏洞。新增 `pg` 驱动和锁文件条目。
- 原课堂规则全部回归：根地址教师入口、固定链接、六所学校、教师控制、先提交再看、直接进入第二主题、暂停／关闭／结束、重复请求去重、学校与姓名锁定、搜索分页、删除、CSV 和重启恢复。
- 新增共享库专项：两个实例同时初始化得到同一课堂；A 登录、B 验证；并发教师控制只有一个成功；B 注销后 A 失效；标准 PG 环境变量自动接入；缺库时禁止回落 SQLite；HTTP 地址与 Secure Cookie 的矛盾配置拒绝启动。
- 迁移专项：SQLite 只读预检、事务导入、课堂 ID／密码／教师会话／删除回执保留、计数一致、拒绝覆盖已有数据。
- HTTP 200 错误页面、无效 JSON、缺失状态均报错，不伪装为未登录。

## 双实例 500 人真实 HTTP 压测

`npm run test:load` 启动两个独立 Node 进程，连接同一个隔离 PostgreSQL schema。请求交替分发，500 个独立 Cookie，模拟 500 人同时加入、500 份发现提交、500 份设计提交，期间按 2.5–3.5 秒持续轮询；随后保持 500 人在线 60 秒。包含未提交者的 403、分页、主题跟随、删除同步和两实例全部重启后的会话恢复。

结果与延迟见下表（本地回环网络，不能换算为扣子 1 核 2 GB 实例的容量承诺）：

| 操作 | 请求数 | P95（毫秒） | P99（毫秒） |
| --- | ---: | ---: | ---: |
| 同时加入 | 500 | 502 | 522 |
| 发现提交 | 500 | 346 | 367 |
| 设计提交 | 500 | 373 | 389 |
| 状态轮询 | 10246 | 4 | 174 |
| 分享列表 | 500 | 244 | 253 |

共 13799 次请求，0 次非预期错误，同时在途请求峰值 523。

预期的阅读门槛 403 不计为错误。删除一份设计作品后，最终计数应为 500 人、500 份发现、499 份设计；原 1,000 份提交没有丢失，删除记录仅剩回执。压测脚本只允许本地数据库，不接受公网生产数据库地址。

## 浏览器闭环与故障恢复

PostgreSQL QA 服务上 `test/browser/flow.js` 通过：一个教师和两个独立学生上下文，验证复制固定链接、总开关、自动进入第二主题、每主题独立解锁、草稿恢复、同学新增作品同步、筛选、单条／批量删除及作者／同学同步移除、结束及新课隔离。1366 × 768 电脑、1024 × 768 平板横屏保持左右布局，1920 × 1080 无整页横向溢出。无页面脚本异常或控制台错误。

`test/browser/auth.js` 通过：模拟 Cookie 被拦截后教师得到明确提示，学生只尝试加入一次；代理返回 HTTP 200 HTML 时保留教师工作台并显示断线，正常响应恢复后继续同步。PostgreSQL 模式没有发送任何 SSE 请求。首轮模拟脚本需修正 `route.fetch` 写入测试 Cookie 的副作用及学生错误文案的定位；修正后通过，非产品缺陷。

SQLite 真实 SSE 鉴权、通知、握手、心跳、退出清理和静默连接恢复继续由自动化测试覆盖。原 SSE 故障浏览器脚本本轮未重复；共享库模式不依赖 SSE。

## 部署证据与边界

已查看用户打开的扣子“AI课堂工作坊网站”：配置为 1 核／2 GB、最多 2 个实例、单实例并发 100；旧生产命令把 SQLite 放在 `/tmp/ai-classroom-data`。原数据库面板为空，本次已创建开发 PostgreSQL，重连后确认平台注入标准 PG 连接变量；没有读取或记录连接密码。

本地复现了不同 SQLite 实例之间会话不互认；部署配置符合这一故障机制。此前生产顶层标签页登录检查当时成功，未直接捕获其间歇故障。预览 iframe 也可能阻止 Cookie，不能只凭 curl 成功排除实例问题。

生产切换需先确认正式数据保留范围，备份或迁移后再部署。尚未完成扣子生产 500 人验收；本地短时压测不能代表真实课堂持续时长、网关限流、校园网络或云数据库延迟。Docker、Nginx 和实体设备本轮未验收。手机窄屏不作为专项适配目标。

## 复现方法

```bash
npm run check
# 在隔离 PostgreSQL 上；使用自己的本地连接环境，不提交密码。
TEST_DATABASE_URL=postgresql://127.0.0.1:55439/classroom_test npm run check
TEST_DATABASE_URL=postgresql://127.0.0.1:55439/classroom_test LOAD_HOLD_MS=60000 npm run test:load
```

浏览器 QA 使用独立数据库和 3219 端口，不能指向正式课堂：

```bash
DATABASE_URL=postgresql://127.0.0.1:55439/classroom_test DATABASE_SCHEMA=browser_test node scripts/qa-server.js
npx --yes --package @playwright/cli playwright-cli -s=workshop-check open http://127.0.0.1:3219/teacher
npx --yes --package @playwright/cli playwright-cli -s=workshop-check run-code --filename=test/browser/flow.js
npx --yes --package @playwright/cli playwright-cli -s=workshop-check run-code --filename=test/browser/auth.js
```

原始结果在忽略的 `output/load-test/result.json`、`output/check-v050-*.log`、`output/browser-auth-v050.log` 和 `output/playwright/`。迁移和回退见 [扣子部署说明](deploy/coze.md)。
