import { mkdirSync, mkdtempSync } from "node:fs";
import { resolve } from "node:path";
import { buildApp } from "../server/app.js";
process.umask(0o077);
mkdirSync("output/playwright", { recursive: true });
const dataDir = mkdtempSync(resolve("output/qa-"));
const app = await buildApp({
  dataDir,
  initialPassword: "isolated-browser-test-only",
});
try {
  await app.listen({ host: "127.0.0.1", port: 3218 });
} catch (error) {
  await app.close();
  throw error;
}
console.log("Isolated QA server: http://127.0.0.1:3218/teacher");
console.log("Test-only password: isolated-browser-test-only");
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, async () => {
    await app.close();
    process.exit(0);
  });
