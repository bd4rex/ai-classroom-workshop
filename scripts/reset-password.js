import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { createStore } from "../server/store.js";
import { passwordHash } from "../server/auth.js";
process.umask(0o077);
const store = await createStore(
  process.env.DATA_DIR || fileURLToPath(new URL("../data", import.meta.url)),
  {
    usePostgres: Boolean(process.env.PGHOST && process.env.PGDATABASE),
    connectionString: process.env.DATABASE_URL || process.env.PGDATABASE_URL,
    schema: process.env.DATABASE_SCHEMA,
  },
);
try {
  const password = randomBytes(12).toString("base64url");
  await store.transaction(async () => {
    await store.setMeta("password", await passwordHash(password));
    await store.run("DELETE FROM teachers");
  });
  console.log(`教师新密码（请保存）：${password}`);
} finally {
  await store.close();
}
