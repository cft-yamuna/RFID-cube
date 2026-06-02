import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function canUsePort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });

    server.listen(port);
  });
}

async function getAvailablePort(startingPort) {
  let port = startingPort;

  while (!(await canUsePort(port))) {
    port += 1;
  }

  return port;
}

const serverPort = await getAvailablePort(Number(process.env.SERVER_PORT || 3001));
const clientPort = await getAvailablePort(Number(process.env.CLIENT_PORT || 5173));
const socketUrl = process.env.VITE_SOCKET_URL || `http://localhost:${serverPort}`;
const clientUrl = `http://localhost:${clientPort}`;
const sharedEnv = {
  ...process.env,
  SERVER_PORT: String(serverPort),
  CLIENT_PORT: String(clientPort),
  VITE_SOCKET_URL: socketUrl
};

console.log(`[dev] backend: ${socketUrl}`);
console.log(`[dev] website: ${clientUrl}`);

function startProcess(label, command, args) {
  const child = spawn(command, args, {
    cwd: rootDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: sharedEnv
  });

  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[${label}] ${chunk}`);
  });

  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[${label}] ${chunk}`);
  });

  child.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`[${label}] exited with code ${code}`);
    }
  });

  return child;
}

function openBrowser(url) {
  if (process.env.OPEN_BROWSER !== '1') {
    return;
  }

  const child =
    process.platform === 'win32'
      ? spawn('cmd', ['/c', 'start', '', url], {
          detached: true,
          stdio: 'ignore'
        })
      : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], {
          detached: true,
          stdio: 'ignore'
        });

  child.unref();
}

const processes = [
  startProcess('server', process.execPath, ['server/index.js']),
  startProcess('client', process.execPath, [
    'node_modules/vite/bin/vite.js',
    '--host',
    '0.0.0.0',
    '--port',
    String(clientPort),
    '--strictPort'
  ])
];

setTimeout(() => openBrowser(clientUrl), 1800);

function stopAll(signal) {
  for (const child of processes) {
    if (!child.killed) {
      child.kill(signal);
    }
  }
}

process.on('SIGINT', () => {
  stopAll('SIGINT');
  process.exit(0);
});

process.on('SIGTERM', () => {
  stopAll('SIGTERM');
  process.exit(0);
});
