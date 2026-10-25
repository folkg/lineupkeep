export function developmentStopSignal(): AbortSignal {
  const stop = new AbortController();
  process.on("SIGINT", () => stop.abort());
  process.on("SIGTERM", () => stop.abort());
  return stop.signal;
}
