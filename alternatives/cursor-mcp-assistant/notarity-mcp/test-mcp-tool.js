import { spawn } from 'node:child_process';

function runJsonRpc(message) {
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

    child.stdin.write(JSON.stringify(message) + '\n');
    child.stdin.end();
  });
}

async function main() {
  const init = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    },
  };

  const tools = {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {},
  };

  const fetchBooking = {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'fetch_booking_form',
      arguments: {},
    },
  };

  console.log('INIT_RESPONSE');
  console.log(await runJsonRpc(init));
  console.log('\nTOOLS_RESPONSE');
  console.log(await runJsonRpc(tools));
  console.log('\nFETCH_BOOKING_RESPONSE');
  console.log(await runJsonRpc(fetchBooking));
}

main().catch((error) => {
  console.error('TEST_FAILED');
  console.error(error);
  process.exit(1);
});
