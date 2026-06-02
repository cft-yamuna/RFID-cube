import express from 'express';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SerialPort } from 'serialport';
import { Server } from 'socket.io';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const vidsDir = path.join(rootDir, 'vids');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    methods: ['GET', 'POST']
  }
});

const defaultSerialPort = 'COM7';
const defaultBaudRate = 115200;
const serverPort = Number(process.env.SERVER_PORT || process.env.PORT || 3001);
let configuredSerialPort = process.env.SERIAL_PORT || process.env.COM_PORT || defaultSerialPort;
let baudRate = Number(process.env.BAUD_RATE || defaultBaudRate);

let serialPort;
let latestValue = null;
let latestAt = null;
let reconnectTimer = null;
let serialStatus = {
  state: 'starting',
  message: 'Starting serial bridge',
  port: configuredSerialPort,
  baudRate
};

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }

  next();
});
app.use(express.json());
app.use('/vids', express.static(vidsDir));

app.get('/api/status', (_req, res) => {
  res.json({
    latestValue,
    latestAt,
    serial: serialStatus
  });
});

app.get('/api/ports', async (_req, res) => {
  try {
    const ports = await SerialPort.list();
    res.json({
      ports: ports.map((portInfo) => ({
        path: portInfo.path,
        manufacturer: portInfo.manufacturer || '',
        friendlyName: portInfo.friendlyName || '',
        vendorId: portInfo.vendorId || '',
        productId: portInfo.productId || ''
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/connect', async (req, res) => {
  const nextPort = String(req.body?.port || '').trim();
  const nextBaudRate = Number(req.body?.baudRate || baudRate || defaultBaudRate);

  if (!nextPort) {
    res.status(400).json({ error: 'Serial port is required' });
    return;
  }

  if (!Number.isFinite(nextBaudRate) || nextBaudRate <= 0) {
    res.status(400).json({ error: 'Valid baud rate is required' });
    return;
  }

  configuredSerialPort = nextPort;
  baudRate = nextBaudRate;
  setSerialStatus({
    state: 'connecting',
    message: `Connecting to ${configuredSerialPort} at ${baudRate} baud`,
    port: configuredSerialPort,
    baudRate
  });

  await closeSerialPort();
  startSerialBridge();

  res.json({
    ok: true,
    serial: serialStatus
  });
});

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

io.on('connection', (socket) => {
  socket.emit('serial:status', serialStatus);
});

function setSerialStatus(nextStatus) {
  const updatedStatus = {
    ...serialStatus,
    ...nextStatus
  };

  const changed =
    updatedStatus.state !== serialStatus.state ||
    updatedStatus.message !== serialStatus.message ||
    updatedStatus.port !== serialStatus.port;

  serialStatus = updatedStatus;

  if (!changed) {
    return;
  }

  io.emit('serial:status', serialStatus);
  console.log(`[serial] ${serialStatus.state}: ${serialStatus.message}`);
}

function emitValue(value) {
  if (value === '0') {
    latestValue = value;
    latestAt = new Date().toISOString();

    io.emit('serial:data', {
      value,
      at: latestAt,
      ignored: true
    });

    console.log('[serial] received 0, keeping current video');
    return;
  }

  latestValue = value;
  latestAt = new Date().toISOString();

  io.emit('serial:data', {
    value,
    at: latestAt
  });

  console.log(`[serial] received ${value}`);
}

function parseSerialChunk(chunk) {
  for (const byte of chunk) {
    if (byte >= 48 && byte <= 54) {
      emitValue(String.fromCharCode(byte));
      continue;
    }

    if (byte >= 0 && byte <= 6) {
      emitValue(String(byte));
    }
  }
}

async function resolveSerialPortPath() {
  if (configuredSerialPort) {
    return configuredSerialPort;
  }

  const ports = await SerialPort.list();
  const scoredPorts = ports
    .map((portInfo) => {
      const searchable = [
        portInfo.path,
        portInfo.manufacturer,
        portInfo.friendlyName,
        portInfo.vendorId,
        portInfo.productId
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      const score = [
        'esp',
        'espressif',
        'cp210',
        'ch340',
        'wch',
        'silicon labs',
        'usb serial',
        'usb'
      ].reduce((total, token) => total + (searchable.includes(token) ? 1 : 0), 0);

      return { ...portInfo, score };
    })
    .sort((a, b) => b.score - a.score);

  return scoredPorts[0]?.path || null;
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function closeSerialPort() {
  clearReconnectTimer();

  return new Promise((resolve) => {
    const portToClose = serialPort;
    serialPort = null;

    if (!portToClose) {
      resolve();
      return;
    }

    portToClose.removeAllListeners('data');
    portToClose.removeAllListeners('error');
    portToClose.removeAllListeners('close');

    if (!portToClose.isOpen) {
      resolve();
      return;
    }

    portToClose.close(() => resolve());
  });
}

function scheduleReconnect() {
  if (reconnectTimer) {
    return;
  }

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startSerialBridge();
  }, 3000);
}

async function startSerialBridge() {
  try {
    clearReconnectTimer();
    const portPath = await resolveSerialPortPath();

    if (!portPath) {
      setSerialStatus({
        state: 'waiting',
        message: 'No serial port found',
        port: null
      });
      scheduleReconnect();
      return;
    }

    serialPort = new SerialPort({
      path: portPath,
      baudRate,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      autoOpen: false
    });

    serialPort.on('data', parseSerialChunk);

    serialPort.on('error', (error) => {
      setSerialStatus({
        state: 'error',
        message: error.message,
        port: portPath,
        baudRate
      });
    });

    serialPort.on('close', () => {
      setSerialStatus({
        state: 'closed',
        message: 'Serial port closed',
        port: portPath,
        baudRate
      });
      scheduleReconnect();
    });

    serialPort.open((error) => {
      if (error) {
        setSerialStatus({
          state: 'error',
          message: error.message,
          port: portPath,
          baudRate
        });
        scheduleReconnect();
        return;
      }

      setSerialStatus({
        state: 'connected',
        message: `Listening at ${baudRate} baud`,
        port: portPath,
        baudRate
      });
    });
  } catch (error) {
    setSerialStatus({
      state: 'error',
      message: error.message,
      port: configuredSerialPort,
      baudRate
    });
    scheduleReconnect();
  }
}

httpServer.listen(serverPort, () => {
  console.log(`[server] listening on http://localhost:${serverPort}`);
  startSerialBridge();
});
