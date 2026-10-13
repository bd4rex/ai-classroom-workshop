import test from "node:test";
import assert from "node:assert/strict";
import { layoutWords } from "../src/word-layout.js";

test("密集词云中的词不重叠、不越界，且同样的数据保持布局稳定", () => {
  const input = Array.from({ length: 60 }, (_, i) => ({
    text: `关键词${i}`,
    count: 60 - i,
  }));
  const measure = (text, size) => [...text].length * size;
  const placed = layoutWords(input, measure);
  assert.ok(placed.length > 10);
  assert.deepEqual(layoutWords(input, measure), placed);
  assert.equal(placed[0].text, "关键词0");
  for (const [i, word] of placed.entries()) {
    assert.ok(
      word.left >= 0 &&
        word.right <= 640 &&
        word.top >= 0 &&
        word.bottom <= 410,
    );
    for (const other of placed.slice(i + 1))
      assert.ok(
        word.right <= other.left ||
          word.left >= other.right ||
          word.bottom <= other.top ||
          word.top >= other.bottom,
      );
  }
});

test("词云可容纳最长中文词，空数据和装不下的词不会生成越界文本", () => {
  assert.deepEqual(
    layoutWords([], () => 0),
    [],
  );
  const words = [
    { text: "共同创造我们的人工智能", count: 100 },
    { text: "未来", count: 1 },
  ];
  const placed = layoutWords(words, (text, size) => [...text].length * size);
  assert.equal(placed.length, 2);
  assert.ok(placed[0].size > placed[1].size);
  assert.deepEqual(
    layoutWords(words, () => 10000),
    [],
  );
});
