# 扣子多实例部署与 500 人课堂

[English](coze.en.md) · [返回说明](../README.md)

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

平台说明：[集成数据库](https://docs.coze.cn/guides_integrate_database)、[部署网页应用](https://docs.coze.cn/guides_deploy_vibe_web)。
