import { spawn } from 'node:child_process';

const MAX_OUTPUT = 128_000;

export function runProcess(command, args, { cwd, env = process.env, timeoutMs = 240_000, signal, spawnImpl = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stdoutStart = ''; let stderr = ''; let timedOut = false;
    const append = (current, chunk) => `${current}${chunk}`.slice(-MAX_OUTPUT);
    child.stdout?.on('data', (chunk) => {
      if (stdoutStart.length < 4096) stdoutStart = `${stdoutStart}${chunk}`.slice(0, 4096);
      stdout = append(stdout, chunk);
    });
    child.stderr?.on('data', (chunk) => { stderr = append(stderr, chunk); });
    const stop = () => child.kill('SIGTERM');
    signal?.addEventListener('abort', stop, { once: true });
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    child.once('error', finishError);
    child.once('close', (code) => {
      cleanup();
      if (signal?.aborted) return reject(new Error('生图已停止'));
      if (timedOut) return reject(new Error('订阅生图超时'));
      if (code !== 0) return reject(new Error((stderr || stdout || `进程退出：${code}`).trim().slice(-1000)));
      resolve({ stdout, stdoutStart, stderr });
    });
    function finishError(error) { cleanup(); reject(error); }
    function cleanup() { clearTimeout(timer); signal?.removeEventListener('abort', stop); }
  });
}
