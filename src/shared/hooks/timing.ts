export interface TimingEntry {
  step: string;
  ms: number;
  ok: boolean;
}

export async function timed<T>(entries: TimingEntry[], step: string, task: () => Promise<T>): Promise<T> {
  const startedAt = performance.now();
  try {
    const result = await task();
    entries.push({ step, ms: Math.round(performance.now() - startedAt), ok: true });
    return result;
  } catch (error) {
    entries.push({ step, ms: Math.round(performance.now() - startedAt), ok: false });
    throw error;
  }
}

export function logTimings(scope: string, entries: TimingEntry[], totalStartedAt: number) {
  const totalMs = Math.round(performance.now() - totalStartedAt);
  const rows = [...entries, { step: "total", ms: totalMs, ok: true }];
  const slowest = [...entries].sort((left, right) => right.ms - left.ms).slice(0, 3);
  const summary = slowest.map((entry) => `${entry.step}=${entry.ms}ms`).join(", ");
  console.info(`[pi-tauri timing] ${scope}: ${totalMs}ms${summary ? ` | slowest: ${summary}` : ""}`);
  console.table(rows);
}
