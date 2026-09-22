import test from "node:test";
import assert from "node:assert/strict";
import { createRefreshQueue } from "../src/refresh-queue.js";

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test("状态请求中收到一批通知后补取最新状态，同时只发一个请求", async () => {
  let serverVersion = 1,
    displayedVersion = 0,
    active = 0,
    peak = 0;
  const requests = [];
  const first = deferred();
  const queue = createRefreshQueue(async () => {
    const snapshot = serverVersion;
    requests.push(snapshot);
    peak = Math.max(peak, ++active);
    if (requests.length === 1) await first.promise;
    displayedVersion = snapshot;
    active--;
  });
  const drained = queue.update();
  serverVersion = 2;
  await Promise.all(Array.from({ length: 100 }, () => queue.update()));
  assert.deepEqual(requests, [1]);
  first.resolve();
  await drained;
  assert.equal(displayedVersion, 2);
  assert.deepEqual(requests, [1, 2]);
  assert.equal(peak, 1);
});

test("离开课堂会取消尚未执行的补刷，旧连接通知不会继续请求", async () => {
  const first = deferred();
  let calls = 0;
  const queue = createRefreshQueue(async () => {
    calls++;
    await first.promise;
  });
  const drained = queue.update();
  await queue.update();
  queue.stop();
  first.resolve();
  await drained;
  await queue.update();
  assert.equal(calls, 1);
});

test("一次刷新失败后仍能处理后续通知", async () => {
  let calls = 0;
  const queue = createRefreshQueue(async () => {
    if (++calls === 1) throw new Error("模拟断线");
  });
  await assert.rejects(queue.update(), /模拟断线/);
  await queue.update();
  assert.equal(calls, 2);
});
