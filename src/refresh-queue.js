// Coalesce notifications without losing the last update during a slow request.
export function createRefreshQueue(refresh) {
  let active = true,
    pending = false,
    running = false;
  return {
    async update() {
      if (!active) return;
      pending = true;
      if (running) return;
      running = true;
      try {
        do {
          pending = false;
          await refresh();
        } while (active && pending);
      } finally {
        running = false;
      }
    },
    stop() {
      active = false;
      pending = false;
    },
  };
}
