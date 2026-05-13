import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";

const child = spawn(process.execPath, ["src-sidecar/pi-sdk-sidecar.mjs"], {
  cwd: process.cwd(),
  stdio: ["pipe", "pipe", "pipe"],
});

const stderr = [];
child.stderr.on("data", (chunk) => stderr.push(String(chunk)));

const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
const responsePromise = once(rl, "line").then(([line]) => JSON.parse(line));

child.stdin.write(`${JSON.stringify({ id: "smoke-1", method: "ping" })}\n`);

const timeout = new Promise((_, reject) => {
  setTimeout(() => reject(new Error("SDK sidecar smoke timed out")), 10_000);
});

try {
  const response = await Promise.race([responsePromise, timeout]);
  if (!response.ok) throw new Error(response.error ?? "SDK sidecar ping failed");
  console.log(`SDK sidecar smoke ok: ${JSON.stringify(response.result)}`);
} finally {
  child.kill();
}

const [code] = await once(child, "exit");
if (code && code !== 0 && stderr.length) {
  console.error(stderr.join(""));
}
