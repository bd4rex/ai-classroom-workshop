import test from "node:test";
import assert from "node:assert/strict";
import { api } from "../src/api.js";

test("HTTP 200 错误页、异常 JSON 和缺失课堂状态均报错，不冒充未登录", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  for (const value of [
    "<html>proxy error</html>",
    "{}",
    "null",
    '{"state":{}}',
    '{"error":"暂时不可用"}',
  ]) {
    globalThis.fetch = async () => new Response(value, { status: 200 });
    await assert.rejects(api("/api/session?role=teacher"));
  }
  globalThis.fetch = async () => new Response('{"state":null}');
  assert.deepEqual(await api("/api/session?role=teacher"), { state: null });
});
