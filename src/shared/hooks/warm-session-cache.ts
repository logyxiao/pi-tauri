export interface WarmSessionCacheQueue {
  enqueue(sessionPaths: string[]): void;
}

export function createWarmSessionCacheQueue(options: {
  normalizeKey: (sessionPath: string) => string;
  warm: (sessionPath: string) => Promise<void>;
}): WarmSessionCacheQueue {
  const queued: string[] = [];
  const seen = new Set<string>();
  let active = false;

  async function drain() {
    active = true;
    try {
      while (queued.length) {
        const sessionPath = queued.shift();
        if (sessionPath) await options.warm(sessionPath);
      }
    } finally {
      active = false;
    }
  }

  return {
    enqueue(sessionPaths: string[]) {
      for (const sessionPath of sessionPaths) {
        const key = options.normalizeKey(sessionPath);
        if (seen.has(key)) continue;
        seen.add(key);
        queued.push(sessionPath);
      }
      if (!active) void drain();
    },
  };
}
