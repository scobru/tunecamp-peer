# TuneCamp Peer sharing daemon

`tunecamp-peer` is a lightweight, standalone client-side CLI tool that allows you to transiently share your local music folders with any TuneCamp instance in real-time. 

Your shared tracks are streamed or downloaded on-demand by listeners over a secure, reverse WebSocket tunnel (no port forwarding or static IP configurations required). The moment the client disconnects, all index files are cleared instantly from the host server.

---

## Prerequisites

- **Node.js**: v18.0.0 or higher.
- **TuneCamp Account**: An account with peer-sharing permissions enabled by the administrator.

## Installation

Clone this repository and install dependencies:

```bash
git clone https://github.com/scobru/tunecamp-peer.git
cd tunecamp-peer
npm install
```

---

## Configuration

You can configure the client using a `.env` file or passing command-line arguments.

### Option A: Config file (Recommended)

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
2. Open `.env` and configure your credentials:
   ```ini
   TUNECAMP_SERVER=https://your-tunecamp-domain.com
   TUNECAMP_TOKEN=YOUR_JWT_OR_DEVELOPER_TOKEN
   TUNECAMP_SHARE=/path/to/my/music,/another/path
   TUNECAMP_ALLOW_DOWNLOADS=true
   ```

### Option B: Command-line arguments

Pass configuration parameters directly to the launch command:

```bash
node peer-daemon.js --server <url> --token <token> --share <folder1> <folder2>
```

---

## Usage

### 1. Scan and verify metadata
To test if your folders are scanned and tags are extracted correctly without connecting to the server:
```bash
npm run scan
# OR: node peer-daemon.js --scan-only --share /path/to/music
```

### 2. Start sharing
Once configured (either via `.env` or args), start the daemon to connect to the TuneCamp server and start sharing:
```bash
npm start
# OR: node peer-daemon.js
```

---

## CLI Options Reference

- `-s, --server <url>`: The URL of the target TuneCamp instance (e.g. `https://my-tunecamp.com`).
- `-t, --token <jwt>`: Your developer token or session JWT.
- `-f, --folder, --share <paths...>`: One or more space-separated directories of music to scan.
- `--no-allow-downloads`: Overrides downloading permissions, allowing users to only stream.
- `--scan-only`: Scans and lists metadata of local tracks, then exits immediately.
- `-h, --help`: Displays the help menu.
