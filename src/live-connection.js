// A connected socket alone does not prove that a proxy is forwarding events.
// Reopen silent streams while the independent state polling keeps working.
export function watchClassroomEvents(
  url,
  { onLive, onUpdate },
  {
    createSource = (address) => new EventSource(address),
    now = Date.now,
    every = setInterval,
    cancel = clearInterval,
  } = {},
) {
  let active = true;
  let source;
  let lastSignal = now();
  const open = () => {
    source?.close();
    source = null;
    lastSignal = now();
    onLive(false);
    try {
      const current = createSource(url);
      source = current;
      const receive = (refresh) => {
        if (!active || source !== current) return;
        lastSignal = now();
        onLive(true);
        if (refresh) onUpdate();
      };
      current.addEventListener("ready", () => receive(true));
      current.addEventListener("update", () => receive(true));
      current.addEventListener("heartbeat", () => receive(false));
      current.onerror = () => {
        if (active && source === current) onLive(false);
      };
    } catch {
      // Unsupported or blocked EventSource must not disable state polling.
      onLive(false);
    }
  };
  open();
  const watchdog = every(() => {
    if (active && now() - lastSignal >= 45000) open();
  }, 5000);
  return () => {
    active = false;
    cancel(watchdog);
    source?.close();
  };
}
