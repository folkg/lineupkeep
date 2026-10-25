export function scheduleDelay(run: () => void, milliseconds: number): () => void {
  const timer = setTimeout(run, milliseconds);
  return () => clearTimeout(timer);
}
