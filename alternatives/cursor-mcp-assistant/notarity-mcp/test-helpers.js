import { spawn } from 'node:child_process';

export function sendJsonRpc(message) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['server.js'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Process exited with code ${code}\nSTDERR:\n${stderr}`));
        return;
      }
      resolve(stdout);
    });

    child.stdin.write(`${JSON.stringify(message)}\n`);
    child.stdin.end();
  });
}

export function parseResponse(raw, id) {
  const lines = raw
    .trim()
    .split('\n')
    .filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = JSON.parse(lines[i]);
      if (id === undefined || parsed.id === id) {
        return parsed;
      }
    } catch {
      // skip non-JSON lines
    }
  }

  throw new Error(`No JSON-RPC response found for id ${id ?? 'any'}`);
}

export function extractTextResult(raw, id) {
  const parsed = parseResponse(raw, id);
  const text = parsed?.result?.content?.[0]?.text;
  return text ? JSON.parse(text) : null;
}
