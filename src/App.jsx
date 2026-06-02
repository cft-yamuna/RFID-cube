import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const socketUrl =
  import.meta.env.VITE_SOCKET_URL ||
  (window.location.port === '5173' ? 'http://localhost:3001' : window.location.origin);

const videos = {
  1: '/vids/vid1.mp4',
  2: '/vids/vid2.mp4',
  3: '/vids/vid3.mp4',
  4: '/vids/vid4.mp4',
  5: '/vids/vid5.mp4',
  6: '/vids/vid6.mp4'
};

const defaultImage = '/vids/img01.jpg';
const defaultPort = 'COM7';
const defaultBaudRate = '115200';
const serialPortStorageKey = 'esp32SerialPort';
const serialBaudStorageKey = 'esp32SerialBaudRate';

function App() {
  const videoRef = useRef(null);
  const restoredSettingsRef = useRef(false);
  const [latestValue, setLatestValue] = useState('--');
  const [activeVideo, setActiveVideo] = useState(null);
  const [defaultScreenKey, setDefaultScreenKey] = useState(() => `default-${Date.now()}`);
  const [connected, setConnected] = useState(false);
  const [serialStatus, setSerialStatus] = useState({ state: 'starting', port: null });
  const [isMuted, setIsMuted] = useState(true);
  const [needsStart, setNeedsStart] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ports, setPorts] = useState([]);
  const [selectedPort, setSelectedPort] = useState(
    () => localStorage.getItem(serialPortStorageKey) || defaultPort
  );
  const [selectedBaudRate, setSelectedBaudRate] = useState(
    () => localStorage.getItem(serialBaudStorageKey) || defaultBaudRate
  );
  const [connectMessage, setConnectMessage] = useState('');

  useEffect(() => {
    const socket = io(socketUrl, {
      transports: ['websocket', 'polling']
    });

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('serial:status', (status) => {
      setSerialStatus(status);
    });

    socket.on('serial:data', ({ value }) => {
      const nextValue = String(value);
      setLatestValue(nextValue);

      if (Object.hasOwn(videos, nextValue)) {
        setActiveVideo({
          value: nextValue,
          source: videos[nextValue],
          key: `${nextValue}-${Date.now()}`
        });
      }
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (restoredSettingsRef.current) {
      return;
    }

    restoredSettingsRef.current = true;

    async function restoreSettings() {
      await refreshPorts();

      try {
        const response = await fetch(`${socketUrl}/api/status`);
        const status = await response.json();
        const savedPort = localStorage.getItem(serialPortStorageKey);
        const savedBaudRate =
          localStorage.getItem(serialBaudStorageKey) ||
          String(status.serial?.baudRate || defaultBaudRate);

        setSerialStatus(status.serial);
        setSelectedPort(savedPort || status.serial?.port || defaultPort);
        setSelectedBaudRate(savedBaudRate);

        if (savedPort && savedPort !== status.serial?.port) {
          await connectSerial(savedPort, savedBaudRate, false);
        }
      } catch (error) {
        setConnectMessage(error.message);
      }
    }

    restoreSettings();
  }, []);

  useEffect(() => {
    const video = videoRef.current;

    if (!video || !activeVideo?.source) {
      return;
    }

    video.load();
    const playPromise = video.play();

    if (playPromise) {
      playPromise
        .then(() => setNeedsStart(false))
        .catch(() => setNeedsStart(true));
    }
  }, [activeVideo?.key, activeVideo?.source]);

  function startPlayback() {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    video
      .play()
      .then(() => setNeedsStart(false))
      .catch(() => setNeedsStart(true));
  }

  function toggleMute() {
    setIsMuted((current) => !current);
  }

  async function refreshPorts() {
    try {
      const response = await fetch(`${socketUrl}/api/ports`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Unable to load serial ports');
      }

      setPorts(data.ports || []);
    } catch (error) {
      setConnectMessage(error.message);
    }
  }

  async function connectSerial(port = selectedPort, baud = selectedBaudRate, shouldSave = true) {
    setConnectMessage('Connecting...');

    try {
      const response = await fetch(`${socketUrl}/api/connect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          port,
          baudRate: Number(baud)
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Unable to connect serial port');
      }

      if (shouldSave) {
        localStorage.setItem(serialPortStorageKey, port);
        localStorage.setItem(serialBaudStorageKey, String(baud));
      }

      setSelectedPort(port);
      setSelectedBaudRate(String(baud));
      setSerialStatus(data.serial);
      setConnectMessage(`Connecting to ${port}`);
    } catch (error) {
      setConnectMessage(error.message);
    }
  }

  function openSettings() {
    setSettingsOpen(true);
    refreshPorts();
  }

  function handleVideoEnded() {
    setActiveVideo(null);
    setDefaultScreenKey(`default-${Date.now()}`);
    setNeedsStart(false);
  }

  const portOptions = Array.from(
    new Set(
      [
        selectedPort,
        serialStatus.port,
        defaultPort,
        ...ports.map((port) => port.path)
      ].filter(Boolean)
    )
  );

  return (
    <main className="screen">
      <section className="player" aria-label="Video player">
        {activeVideo ? (
          <video
            key={activeVideo.key}
            ref={videoRef}
            className="video animate__animated animate__slideInLeft"
            muted={isMuted}
            playsInline
            preload="auto"
            autoPlay
            controls={false}
            controlsList="nodownload noplaybackrate noremoteplayback"
            disablePictureInPicture
            onEnded={handleVideoEnded}
          >
            <source src={activeVideo.source} type="video/mp4" />
          </video>
        ) : (
          <img
            key={defaultScreenKey}
            className="default-image animate__animated animate__slideInLeft"
            src={defaultImage}
            alt=""
          />
        )}

        {needsStart && (
          <button className="start-button" type="button" onClick={startPlayback}>
            Start video
          </button>
        )}
      </section>

      <button className="settings-button" type="button" onClick={openSettings} aria-label="Settings">
        ⚙︎
      </button>

      {settingsOpen && (
        <div
          className="settings-backdrop"
          role="presentation"
          onClick={() => setSettingsOpen(false)}
        >
          <aside
            className="settings-drawer"
            aria-label="Settings"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="drawer-header">
              <h1>Settings</h1>
              <button className="icon-button" type="button" onClick={() => setSettingsOpen(false)}>
                x
              </button>
            </header>

            <div className="value-block">
              <span className="label">Latest value</span>
              <strong>{latestValue}</strong>
            </div>

            <div className="status-row">
              <span className={connected ? 'dot connected' : 'dot'} />
              <span>{connected ? 'Socket connected' : 'Socket disconnected'}</span>
            </div>

            <div className="status-row">
              <span
                className={serialStatus.state === 'connected' ? 'dot connected' : 'dot warning'}
              />
              <span>
                {serialStatus.port || 'No port'} - {serialStatus.baudRate || defaultBaudRate} -{' '}
                {serialStatus.state}
              </span>
            </div>

            <p className="status-message">{serialStatus.message || 'Waiting for serial data'}</p>

            <label className="field">
              <span>Port</span>
              <select
                value={selectedPort}
                onChange={(event) => {
                  setSelectedPort(event.target.value);
                  localStorage.setItem(serialPortStorageKey, event.target.value);
                }}
              >
                {portOptions.map((port) => (
                  <option key={port} value={port}>
                    {port}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Baud rate</span>
              <input
                type="number"
                min="1"
                step="1"
                value={selectedBaudRate}
                onChange={(event) => setSelectedBaudRate(event.target.value)}
              />
            </label>

            <button className="primary-button" type="button" onClick={() => connectSerial()}>
              Connect
            </button>

            {connectMessage && <p className="status-message">{connectMessage}</p>}

            <button className="mute-button" type="button" onClick={toggleMute}>
              {isMuted ? 'Muted' : 'Audio on'}
            </button>
          </aside>
        </div>
      )}
    </main>
  );
}

export default App;
