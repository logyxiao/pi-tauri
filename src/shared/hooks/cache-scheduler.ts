export function scheduleSessionCacheWrite(timerId: number | null, write: () => void, delayMs = 500): number {
  if (timerId !== null) window.clearTimeout(timerId);
  return window.setTimeout(write, delayMs);
}

export function clearScheduledCacheWrite(timerId: number | null): null {
  if (timerId !== null) window.clearTimeout(timerId);
  return null;
}
