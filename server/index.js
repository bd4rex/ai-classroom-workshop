import { buildApp } from "./app.js";
process.umask(0o077);
const app = await buildApp({ dev: process.argv.includes("--dev") });
const port = Number(process.env.PORT || 3218);
try {
  await app.listen({ port, host: process.env.HOST || "0.0.0.0" });
} catch (error) {
  await app.close();
  throw error;
}
console.log(
  `AI 共创课堂：http://localhost:${port}\n教师入口：http://localhost:${port}/teacher`,
);
if (app.initialPassword)
  console.log(`首次教师密码（请保存）：${app.initialPassword}`);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, async () => {
    await app.close();
    process.exit(0);
  });
