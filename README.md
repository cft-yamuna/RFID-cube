# ESP32 RFID Video Player

React + Node.js app that reads `0`, `1`, `2`, `3`, or `4` from an ESP32 over USB serial, sends each value to the browser with Socket.IO, and plays the matching video for values `1` to `4`.

The app uses the existing files in `vids`:

- `vids/vid1.mp4`
- `vids/vid2.mp4`
- `vids/vid3.mp4`
- `vids/vid4.mp4`

## Setup

```bash
npm install
```

The app defaults to `COM7` at `115200` baud.

Set these manually only if your ESP32 moves to another port:

```bash
set SERIAL_PORT=COM7
set BAUD_RATE=115200
```

PowerShell:

```powershell
$env:SERIAL_PORT="COM7"
$env:BAUD_RATE="115200"
```

## Run

```bash
npm run dev
```

Open the Vite URL shown in the terminal, usually:

```text
http://localhost:5173
```

The backend runs on `http://localhost:3001`. In production mode, run:

```bash
npm run preview
```
