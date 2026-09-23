import test from "node:test";
import assert from "node:assert/strict";
import { watchClassroomEvents } from "../src/live-connection.js";

function harness() {
  let time = 0,
    tick,
    updates = 0,
    live;
  const sources = [];
  const stop = watchClassroomEvents(
    "/api/events?role=teacher",
    {
      onLive: (value) => {
        live = value;
      },
      onUpdate: () => {
        updates++;
      },
    },
    {
      now: () => time,
      every: (callback) => {
        tick = callback;
        return 1;
      },
      cancel: () => {
        tick = null;
      },
      createSource: () => {
        const listeners = {};
        const source = {
          closed: false,
          addEventListener: (type, callback) => {
            listeners[type] = callback;
          },
          close: () => {
            source.closed = true;
          },
          emit: (type) => listeners[type]?.(),
        };
        sources.push(source);
        return source;
      },
    },
  );
  return {
    stop,
    sources,
    advance: (duration) => {
      time += duration;
      tick?.();
    },
    get live() {
      return live;
    },
    get updates() {
      return updates;
    },
  };
}

test("代理不传事件时不会误报实时连接，45 秒后关闭静默连接并重试", () => {
  const h = harness();
  assert.equal(h.live, false);
  h.advance(45000);
  assert.equal(h.sources[0].closed, true);
  assert.equal(h.sources.length, 2);
  h.sources[0].emit("ready");
  assert.equal(h.live, false);
  h.sources[1].emit("ready");
  assert.equal(h.live, true);
  assert.equal(h.updates, 1);
  h.stop();
});

test("心跳维持实时状态，断线后恢复会补取状态，退出后旧连接不再触发更新", () => {
  const h = harness(),
    source = h.sources[0];
  source.emit("ready");
  for (let i = 0; i < 4; i++) {
    h.advance(20000);
    source.emit("heartbeat");
  }
  assert.equal(h.live, true);
  assert.equal(h.sources.length, 1);
  assert.equal(h.updates, 1);
  source.onerror();
  assert.equal(h.live, false);
  source.emit("ready");
  assert.equal(h.live, true);
  assert.equal(h.updates, 2);
  source.emit("update");
  assert.equal(h.updates, 3);
  h.stop();
  source.emit("update");
  h.advance(90000);
  assert.equal(h.updates, 3);
  assert.equal(source.closed, true);
  assert.equal(h.sources.length, 1);
});

test("浏览器拒绝创建实时连接时不会抛出异常或阻断独立轮询", () => {
  let tick,
    attempts = 0,
    time = 0;
  const signals = [];
  const stop = watchClassroomEvents(
    "/api/events",
    {
      onLive: (live) => signals.push(live),
      onUpdate: () => assert.fail("尚未收到事件"),
    },
    {
      now: () => time,
      every: (callback) => {
        tick = callback;
      },
      cancel: () => {},
      createSource: () => {
        attempts++;
        throw new Error("连接被浏览器阻止");
      },
    },
  );
  time = 45000;
  tick();
  assert.equal(attempts, 2);
  assert.ok(signals.every((live) => !live));
  stop();
});
