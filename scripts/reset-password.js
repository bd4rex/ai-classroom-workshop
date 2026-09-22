import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { createStore } from "../server/store.js";
import { passwordHash } from "../server/auth.js";
process.umask(0o077);
const store = createStore(
  process.env.DATA_DIR || fileURLToPath(new URL("../data", import.meta.url)),
);
try {
  const password = randomBytes(12).toString("base64url");
  store.setMeta("password", await passwordHash(password));
  store.run("DELETE FROM teachers");
  console.log(`教师新密码（请保存）：${password}`);
} finally {
  store.close();
}
