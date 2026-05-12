import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

const piBin = process.env.PI_BIN ?? (process.platform === 'win32' ? 'pi.cmd' : 'pi');

const proc = spawn(piBin, ['--mode', 'rpc', '--no-session', '--offline'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  cwd: process.cwd(),
  shell: process.platform === 'win32',
});

let buffer = '';
let done = false;
const decoder = new StringDecoder('utf8');
const timeout = setTimeout(() => finish(new Error('RPC smoke test timed out')), 10_000);

function finish(error) {
  if (done) return;
  done = true;
  clearTimeout(timeout);
  proc.kill();
  if (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

function onLine(rawLine) {
  const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
  if (!line.trim()) return;

  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    finish(new Error(`Failed to parse JSONL: ${String(error)}\n${line}`));
    return;
  }

  if (message.type === 'response' && message.id === 'smoke-get-state') {
    if (!message.success) {
      finish(new Error(`get_state failed: ${message.error ?? 'unknown error'}`));
      return;
    }
    console.log('RPC smoke ok:', JSON.stringify({
      command: message.command,
      isStreaming: message.data?.isStreaming,
      thinkingLevel: message.data?.thinkingLevel,
      sessionId: message.data?.sessionId,
    }));
    finish();
  }
}

proc.stdout.on('data', (chunk) => {
  buffer += typeof chunk === 'string' ? chunk : decoder.write(chunk);
  while (true) {
    const newlineIndex = buffer.indexOf('\n');
    if (newlineIndex === -1) break;
    const line = buffer.slice(0, newlineIndex);
    buffer = buffer.slice(newlineIndex + 1);
    onLine(line);
  }
});

proc.stderr.on('data', (chunk) => {
  const text = chunk.toString();
  if (text.trim()) process.stderr.write(text);
});

proc.on('error', (error) => finish(error));
proc.on('exit', (code) => {
  if (!done && code !== 0) finish(new Error(`pi rpc exited with code ${code}`));
});

proc.stdin.write(JSON.stringify({ id: 'smoke-get-state', type: 'get_state' }) + '\n');
