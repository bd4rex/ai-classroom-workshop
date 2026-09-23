# 扣子多实例部署与 500 人课堂

[English](coze.en.md) · [返回说明](../README.md) · [完整排查记录](DEBUGGING_2026-09-23.md)

## 新项目快速落地

1. 导入本项目已合并的 `main`，核对实际 Git 提交。Node.js 需要 24 或以上；扣子终端使用 `pnpm`。
2. 打开“数据库”，创建默认 PostgreSQL。若终端没看到 PG 变量，重连沙箱并新开终端；只检查变量是否存在，不打印其值。
3. 先备份平台原 `.coze`，再参考 [无密钥配置模板](coze.toml.example) 设置开发和生产命令。开发需限定 `--watch-path`，避免 Vite 临时文件触发无限重启。生产必须设置 `REQUIRE_SHARED_DATABASE=true`。
4. 保持 `DATABASE_SCHEMA=public`，让平台发现表结构。已有数据库先走下文迁移流程；空库首次启动会创建课堂。初始教师密码通过平台环境配置，不写进 Git；已有数据库里的密码不会被环境变量覆盖。
5. 执行 `pnpm install`、`pnpm run check`。注意默认检查中的 PostgreSQL 专项会跳过；需要实测共享库时按下文安全构造 `TEST_DATABASE_URL`。
6. 检查开发 `/api/health` 显示 `version: 0.5.0`、`storage: postgres`、`syncMode: polling`。在独立标签页打开 `/teacher`，登录、复制学生链接，用另一浏览器上下文完成两个主题的演练。
7. 生产发布时确认选用生产数据库。首次空白落地不要把开发演练学生数据复制过去；已有生产数据不要选择“用开发数据覆盖生产”。平台的开发／生产数据库不是同一份。
8. 发布完成后，在实际生产域名执行本文验收。页面显示“部署成功”不替代健康、登录和原固定链接检查。记录上线提交、时间、环境、结果与剩余项。

## 已有项目升级顺序

按顺序处理：**确认生产数据来源 → 停止写入并备份 → 预检 → 空目标库迁移 → 核对原字段 → 更新代码和配置 → 启动 → 验收**。不能先启动新应用让它生成新课堂，再尝试导入旧课堂。

开发沙箱文件不能充当生产备份。需要保留原生产 SQLite 时，必须先取得实际生产实例的文件或平台备份；若平台暂未提供生产终端／备份导出能力，先保留现状并解决取数途径，不点击覆盖部署。两个旧实例可能各有数据，不能随意只取其中一份。

## 为什么要共享数据库

0.4.x 将登录、课堂 ID 和作品放在本机 SQLite。两个实例各自使用 `/tmp` 时，登录实例 A 后访问实例 B 会变成未登录，同一个课堂链接也可能在 B 找不到。临时目录被重建后数据会丢失。0.5.0 使用 PostgreSQL 共享这些状态，并采用 2.5–3.5 秒短请求同步；500 名在线学生不再各占用一个持续的 SSE 请求。

## 扣子配置

1. 项目内打开“数据库”，创建默认数据库。平台为开发和生产提供独立的 PostgreSQL；开发环境能连接不代表生产已接通。
2. 应用自动识别标准 `PGHOST`、`PGPORT`、`PGUSER`、`PGPASSWORD`、`PGDATABASE`、`PGSSLMODE`。也支持 `DATABASE_URL` 或 `PGDATABASE_URL`。不要把实际连接密码写进 Git、聊天或日志。
3. 保持默认 `public` schema，确保扣子的表结构同步能发现应用的表。测试使用独立 schema。每实例连接池上限 10；两个实例共最多 20 个数据库连接。
4. 生产运行环境设置 `REQUIRE_SHARED_DATABASE=true`、`SYNC_MODE=polling`、`COOKIE_SECURE=true`；`PUBLIC_URL` 使用实际学生域名。多个可信地址可逗号分隔，第一个用于生成分享链接。不要填写内部端口或在地址中附加路径。
5. 生产启动使用 `node --env-file-if-exists=.env server/index.js`，端口按平台注入配置。保留原来的初始教师密码配置；它不会覆盖共享数据库中已有的密码。扣子使用 `pnpm install` 和 `pnpm run build`。
6. 如旧 `.coze` 运行指令写了 `DATA_DIR=/tmp/...`，可移除这一段。开启 `REQUIRE_SHARED_DATABASE` 后，缺少数据库配置会拒绝启动，不会悄悄新建临时课堂。
7. 登录和课堂使用独立浏览器标签页。应用保留 HttpOnly / SameSite=Strict Cookie；预览 iframe 中凭据受限时给出明确提示，学生也不会因轮询反复新建身份。

不要直接把实例数乘以单实例并发数当作在线人数上限：后者限制的是同时处理的请求。当前 2 × 100 配置与 500 人是否匹配，取决于请求耗时、网关排队、数据库网络和资源配额。先使用共享库及短请求同步，再在隔离课堂做目标环境验收；没有实测前不承诺生产能稳定支撑 500 人。

## 安全检查数据库接入

以下命令只输出变量名称和是否存在：

```bash
node -e 'console.log(Object.fromEntries(["PGHOST","PGPORT","PGUSER","PGPASSWORD","PGDATABASE","PGSSLMODE","DATABASE_URL","PGDATABASE_URL"].map(k=>[k,Boolean(process.env[k])])));'
```

在开发或专用测试数据库执行共享库测试，不使用正式库。以下代码在内存中组合连接串，只传给测试子进程；不会打印密码。测试创建并清理自己的 schema，但仍需目标数据库允许创建 schema。

```bash
node --input-type=module -e 'import {spawnSync} from "node:child_process";let connection=process.env.DATABASE_URL||process.env.PGDATABASE_URL;if(!connection){if(!process.env.PGHOST||!process.env.PGDATABASE)throw new Error("Missing PG environment");const u=new URL("postgresql://localhost");u.hostname=process.env.PGHOST;u.port=process.env.PGPORT||"5432";u.username=process.env.PGUSER||"";u.password=process.env.PGPASSWORD||"";u.pathname="/"+process.env.PGDATABASE;connection=u.href;}const r=spawnSync("pnpm",["run","check"],{env:{...process.env,TEST_DATABASE_URL:connection},stdio:"inherit"});process.exitCode=r.status??1;'
```

预期：40 项通过、0 项失败，并完成构建。缺少 `TEST_DATABASE_URL` 的默认 SQLite 检查是 37 项通过、3 项跳过，不能把它记成共享数据库已验证。不要用 `env`、`printenv` 或 `set -x` 输出连接密钥。

## 保留旧课堂和作品

上线前停止旧课堂写入，备份实际生产实例的完整 SQLite 数据，核对当前课堂 ID、各表数量及教师密码。开发沙箱的 SQLite 不能代替生产数据；多个旧实例的数据不一致时需先选定或合并正确来源，不得用开发演示数据覆盖正式数据。

应用提供只读预检和一次性导入。先备份，目标 PostgreSQL 的应用表必须为空，且应用服务尚未初始化；工具拒绝覆盖任何已有课堂。迁移会保留课堂 ID、旧链接映射、密码哈希、会话、身份、提交 ID 和已删除回执，不恢复被清空的正文。

```bash
# 连接信息通过环境变量提供；不在命令中写密码。
node --env-file-if-exists=.env scripts/migrate-postgres.js /安全备份/classroom.sqlite
node --env-file-if-exists=.env scripts/migrate-postgres.js /安全备份/classroom.sqlite --apply
```

预检只输出数量，不写目标库。导入在一个事务内完成，失败全部回滚；成功后再启动服务。保留源备份。若已经存在正式 PostgreSQL 数据，继续使用原库，不能重复导入或同步开发数据覆盖生产。

如果原生产临时文件已经丢失，代码无法恢复消失的作品或原课堂映射。先检查既有备份和教师导出的 CSV，再明确决定如何处理；不要静默改发新链接。

## 验收与回退

- `/api/health` 应显示 `storage: postgres`、`syncMode: polling`、版本 `0.5.0`；必须在实际生产域名核对。
- 教师登录后跨请求、刷新和实例重启保持登录；分享链接持续不变。
- 未提交学生看不到同学内容；教师切换主题，学生在下一次同步跟随；删除后师生列表和导出均移除正文。
- 每秒约 167 次状态查询是 500 人、平均 3 秒同步的参考值，还要计入进入、集中提交和列表请求。
- 隔离压测入口：`TEST_DATABASE_URL=... npm run test:load`，只允许本地数据库，创建和清理独立的合成 schema。它不向线上发压测流量。
- 回退到旧 SQLite 版本前必须停写并处理切换后新增的 PostgreSQL 数据；只回滚代码会让新数据暂时不可见。保留旧库与新库备份，不能把数据回退理解为只恢复 Git 提交。

## 常见现象与下一步

### 修改密码后，正式网址仍提示密码不正确

密码不与域名绑定，哈希保存在当前数据库中。更换域名需要重新登录，但不会改变密码。扣子的开发库和生产库彼此独立；开发预览登录成功，不代表正式网址使用相同密码。

`TEACHER_PASSWORD` 只在数据库首次初始化时生效。已有数据库中修改 `.env`、部署命令或环境变量并重新部署，都不会覆盖已保存的教师密码。

1. 核对项目名称、正式域名和部署版本，特别是复制项目或修改域名后；用正式 `/api/health` 确认存储后端。
2. 在有权限的维护入口确认连接的是该项目的**生产数据库**，再更新教师密码哈希并撤销旧教师会话。不要通过删除数据库、课堂或复制开发数据来重置密码。
3. 在正式 `/teacher` 顶层标签页清空密码框，完整输入新密码并登录；刷新页面，等待至少一个同步周期，确认仍在教师工作台。开发预览的成功不能代替此步骤。
4. 记录环境、版本和验证结果；不把密码、哈希、连接串或 Cookie 写进代码、公共提交信息和日志。

若显示“请求来源不正确”，检查 `PUBLIC_URL` 是否包含新域名；若登录后马上退回登录页，检查会话、Cookie 和共享数据库。不要把这些现象都当作密码错误。2026-09-23 新项目的生产复核见[排查记录](DEBUGGING_2026-09-23.md)。

| 现象 | 检查顺序 |
| --- | --- |
| 密码正确但马上显示未登录 | 先看实际生产 health 是否为 PostgreSQL；确认所有实例使用同一库；再在顶层标签页检查 Cookie。不要反复重置密码 |
| 新复制链接可用，旧链接无效 | 比较课堂 ID、数据库来源、是否新建过课堂；找原库备份。不要把未知 ID 自动跳到新课堂 |
| “课堂定时同步” | PostgreSQL 正常状态；测试老师切主题后学生在下一次同步跟随 |
| “连接中断，正在重试” | 检查 `/api/session` 的状态码及内容类型、应用日志和数据库连接；HTTP 200 HTML 也可能是代理错误页 |
| 并发提交失败 | 核对含 `room_changes` 的修复版本；查看脱敏错误码、数据库连接等待、网关限流与实例资源；用隔离测试复现 |
| 创建数据库后仍提示缺少配置 | 重连沙箱、新建终端，检查变量存在性；生产还要检查生产库是否绑定 |
| 预览一直重启 | 检查是否误用裸 `--watch`，改为模板中的两个 `--watch-path` |
| 迁移提示目标已有数据 | 立即停止覆盖尝试；先识别数据来源并备份。工具的拒绝是保护，不应通过清表绕过 |

每次上线把结果追加到 [交接日志](../TIMESTAMP_LOG.md)，维护 [验证记录](../TEST_REPORT.md)；故障过程参考 [本次完整记录](DEBUGGING_2026-09-23.md)。

平台说明：[集成数据库](https://docs.coze.cn/guides_integrate_database)、[部署网页应用](https://docs.coze.cn/guides_deploy_vibe_web)。
