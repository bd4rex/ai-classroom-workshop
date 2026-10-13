// Stable, horizontal words with measured bounds. Never clip an unreadable word
// into the frame: skip it if the available area is full and report visible count.
export function layoutWords(words, measure, width = 640, height = 410) {
  const placed = [],
    max = Math.max(1, ...words.map((word) => word.count));
  for (const word of words) {
    const wanted = 23 + 40 * Math.sqrt(word.count / max);
    let found = false;
    for (let size = wanted; size >= 20 && !found; size -= 6) {
      const w = measure(word.text, size) + 16,
        h = size * 1.28 + 8;
      if (w > width - 12) continue;
      for (let step = 0; step < 1800; step++) {
        const theta = step * 0.43,
          radius = 2.4 * Math.sqrt(step);
        const x = width / 2 + Math.cos(theta) * radius * 2.9;
        const y = height / 2 + Math.sin(theta) * radius * 1.7;
        const box = {
          left: x - w / 2,
          right: x + w / 2,
          top: y - h / 2,
          bottom: y + h / 2,
        };
        if (
          box.left < 6 ||
          box.right > width - 6 ||
          box.top < 6 ||
          box.bottom > height - 6
        )
          continue;
        if (
          placed.some(
            (other) =>
              box.left < other.right &&
              box.right > other.left &&
              box.top < other.bottom &&
              box.bottom > other.top,
          )
        )
          continue;
        placed.push({ ...word, ...box, x, y, size });
        found = true;
        break;
      }
    }
  }
  return placed;
}
