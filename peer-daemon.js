#!/usr/bin/env node

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { WebSocket } from "ws";
import * as musicMetadata from "music-metadata";
import { EventEmitter } from "events";

const tuiBridge = new EventEmitter();

// Load .env file manually if it exists
if (fs.existsSync(".env")) {
    const dotenvContent = fs.readFileSync(".env", "utf-8");
    for (const line of dotenvContent.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) {
            const index = trimmed.indexOf("=");
            if (index > 0) {
                const key = trimmed.substring(0, index).trim();
                let value = trimmed.substring(index + 1).trim();
                // strip quotes if present
                if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                    value = value.substring(1, value.length - 1);
                }
                process.env[key] = value;
            }
        }
    }
}

// Basic command line parsing helper
function parseArgs() {
    const args = process.argv.slice(2);
    const options = {
        server: process.env.TUNECAMP_SERVER || "",
        token: process.env.TUNECAMP_TOKEN || "",
        folders: process.env.TUNECAMP_SHARE 
            ? process.env.TUNECAMP_SHARE.split(",").map(f => f.trim()) 
            : [],
        allowDownloads: process.env.TUNECAMP_ALLOW_DOWNLOADS !== "false",
        help: false,
        scanOnly: false,
        tui: process.env.TUNECAMP_TUI === "true" || false
    };

    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--server" || args[i] === "-s") {
            options.server = args[++i];
        } else if (args[i] === "--token" || args[i] === "-t") {
            options.token = args[++i];
        } else if (args[i] === "--folder" || args[i] === "-f" || args[i] === "--share") {
            const list = [];
            while (i + 1 < args.length && !args[i + 1].startsWith("-")) {
                list.push(args[++i]);
            }
            if (list.length > 0) {
                options.folders = list;
            }
        } else if (args[i] === "--no-allow-downloads") {
            options.allowDownloads = false;
        } else if (args[i] === "--scan-only") {
            options.scanOnly = true;
        } else if (args[i] === "--tui") {
            options.tui = true;
        } else if (args[i] === "--help" || args[i] === "-h") {
            options.help = true;
        }
    }

    return options;
}

const options = parseArgs();

if (options.help || (!options.scanOnly && (!options.server || !options.token || options.folders.length === 0))) {
    console.log(`
TuneCamp Peer Sharing Daemon (Standalone)

Usage:
  node peer-daemon.js [options]

Options:
  -s, --server <url>      URL of your TuneCamp instance (e.g. https://my-tunecamp.com)
  -t, --token <jwt>       Your TuneCamp JWT token or API Token
  -f, --folder, --share <paths...> Local music folder(s) to share (can be specified multiple times)
  --no-allow-downloads    Disable track downloads (only allow streaming)
  --scan-only             Scan folders and display metadata summary, then exit
  --tui                   Run dynamic Text User Interface dashboard
  -h, --help              Show this help menu

Configuration:
  You can also configure options using a .env file. Copy .env.example to .env and fill in the values.

Examples:
  node peer-daemon.js -s http://localhost:1970 -t tc_xxx --share C:/MyMusic
  node peer-daemon.js --scan-only
    `);
    process.exit(0);
}

const AUDIO_EXTENSIONS = [".mp3", ".flac", ".ogg", ".wav", ".m4a", ".aac", ".opus"];

// Map to store fast-hash to local absolute path mapping
const trackIdToPath = new Map();
// Map to track active read streams for cleanup on cancel
const activeStreams = new Map();

function walkDir(dir, files = []) {
    try {
        const list = fs.readdirSync(dir);
        for (const file of list) {
            const fullPath = path.join(dir, file);
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                walkDir(fullPath, files);
            } else {
                const ext = path.extname(file).toLowerCase();
                if (AUDIO_EXTENSIONS.includes(ext)) {
                    files.push({ path: fullPath, size: stat.size, mtimeMs: stat.mtimeMs });
                }
            }
        }
    } catch (e) {
        console.error(`⚠️ Failed to read directory ${dir}:`, e.message);
    }
    return files;
}

async function scanFolders(folders) {
    tuiBridge.emit("scan:start", folders);
    console.log("🔍 Scanning local folders...");
    const files = [];
    for (const f of folders) {
        const resolved = path.resolve(f);
        if (fs.existsSync(resolved)) {
            console.log(`   - ${resolved}`);
            walkDir(resolved, files);
        } else {
            console.warn(`⚠️ Folder does not exist: ${resolved}`);
        }
    }

    console.log(`✓ Scanned ${files.length} audio files. Extracting metadata...`);
    const manifests = [];
    trackIdToPath.clear();

    let count = 0;
    for (const file of files) {
        try {
            // Compute fast hash (path + size + mtime)
            const trackId = crypto.createHash("sha256")
                .update(`${file.path}:${file.size}:${file.mtimeMs}`)
                .digest("hex");
            
            trackIdToPath.set(trackId, file.path);

            // Extract tags using music-metadata
            let metadata = null;
            try {
                metadata = await musicMetadata.parseFile(file.path, { skipCovers: true });
            } catch (e) {
                // Keep scanning even if one file is unparseable
            }

            const title = metadata?.common?.title || path.basename(file.path, path.extname(file.path));
            const artist = metadata?.common?.artist || undefined;
            const album = metadata?.common?.album || undefined;
            const duration = metadata?.format?.duration || undefined;
            const mimeType = metadata?.format?.mimeType || undefined;

            manifests.push({
                id: trackId,
                title,
                artist,
                album,
                duration,
                fileSizeBytes: file.size,
                mimeType,
                allowDownload: options.allowDownloads
            });

            count++;
            if (count % 100 === 0 || count === files.length) {
                console.log(`   Processed ${count}/${files.length} files...`);
                tuiBridge.emit("scan:progress", { count, total: files.length });
            }
        } catch (err) {
            console.error(`❌ Failed to parse metadata for ${file.path}:`, err.message);
        }
    }

    tuiBridge.emit("scan:complete", manifests);
    return manifests;
}

if (options.scanOnly) {
    if (options.folders.length === 0) {
        console.error("❌ No folders specified to scan. Provide folders via --share <paths> or the TUNECAMP_SHARE environment variable.");
        process.exit(1);
    }
    const manifests = await scanFolders(options.folders);
    console.log(`\nScan finished. Total tracks found: ${manifests.length}`);
    console.log("Sample tracks:");
    manifests.slice(0, 10).forEach(m => {
        console.log(`   - [${m.artist || "Unknown"}] ${m.title} (${m.album || "No Album"}) [${m.mimeType || "unknown"}]`);
    });
    process.exit(0);
}

let reconnectDelay = 2000;
let ws = null;
let reconnectTimeout = null;

async function connect() {
    const manifests = await scanFolders(options.folders);
    console.log(`✓ Scan complete. Sharing ${manifests.length} tracks.`);

    // Convert server HTTP url to WebSocket protocol (ws/wss)
    const baseWsUrl = options.server.replace(/^http/, "ws").replace(/\/$/, "");
    const wsUrl = `${baseWsUrl}/ws/peer?token=${options.token}&allowDownloads=${options.allowDownloads}`;

    console.log(`🔌 Connecting to TuneCamp instance: ${options.server}`);
    tuiBridge.emit("conn:connecting", { server: options.server });
    
    ws = new WebSocket(wsUrl);

    ws.on("open", () => {
        console.log("⚡ Connected! Authenticating...");
        tuiBridge.emit("conn:open");
        reconnectDelay = 2000; // Reset reconnect delay
    });

    ws.on("message", (data) => {
        try {
            const message = JSON.parse(data.toString());
            
            switch (message.type) {
                case "auth_ok":
                    console.log(`🚀 Authentication successful! Session ID: ${message.sessionId}`);
                    console.log("📤 Sending shared tracks manifest...");
                    ws.send(JSON.stringify({ type: "manifest", tracks: manifests }));
                    tuiBridge.emit("conn:auth_ok", { sessionId: message.sessionId, manifestsCount: manifests.length });
                    break;

                case "auth_fail":
                    console.error(`❌ Authentication failed: ${message.reason}`);
                    tuiBridge.emit("conn:auth_fail", message.reason);
                    ws.close();
                    process.exit(1);

                case "ping":
                    ws.send(JSON.stringify({ type: "pong" }));
                    break;

                case "stream_request":
                case "download_request":
                    handleRequest(message.requestId, message.trackId);
                    break;

                case "cancel_request":
                    handleCancel(message.requestId);
                    break;

                default:
                    console.warn(`⚠️ Unknown message type from server: ${message.type}`);
            }
        } catch (err) {
            console.error("❌ Failed to parse message:", err);
        }
    });

    ws.on("close", () => {
        console.log(`🔌 Connection closed. Reconnecting in ${reconnectDelay / 1000}s...`);
        cleanupStreams();
        tuiBridge.emit("conn:close", { reconnectDelay });
        if (reconnectTimeout) clearTimeout(reconnectTimeout);
        reconnectTimeout = setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 60000); // Exponential backoff max 60s
    });

    ws.on("error", (err) => {
        console.error("❌ WebSocket connection error:", err.message);
        tuiBridge.emit("conn:error", err.message);
    });
}

function handleRequest(requestId, trackId) {
    const filePath = trackIdToPath.get(trackId);
    if (!filePath || !fs.existsSync(filePath)) {
        console.warn(`⚠️ Request ${requestId} failed: Track ID ${trackId} file not found locally.`);
        ws.send(JSON.stringify({
            type: "chunk_error",
            requestId,
            message: "File not found locally"
        }));
        tuiBridge.emit("stream:error", { requestId, trackId, message: "File not found locally" });
        return;
    }

    console.log(`▶ Streaming [Track ID: ${trackId}] -> ${path.basename(filePath)}`);
    tuiBridge.emit("stream:start", { requestId, trackId, filePath, title: path.basename(filePath) });

    // Stream the file in 64KB chunks
    const stream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 });
    activeStreams.set(requestId, stream);

    let seq = 0;

    stream.on("data", (chunk) => {
        if (ws.readyState !== WebSocket.OPEN) {
            stream.destroy();
            return;
        }

        // Backpressure check: if socket buffer is full, pause stream reading
        if (ws.bufferedAmount > 1024 * 1024) { // 1MB buffer limit
            stream.pause();
            const drainInterval = setInterval(() => {
                if (ws.readyState !== WebSocket.OPEN) {
                    clearInterval(drainInterval);
                    stream.destroy();
                    return;
                }
                if (ws.bufferedAmount < 256 * 1024) {
                    clearInterval(drainInterval);
                    stream.resume();
                }
            }, 50);
        }

        ws.send(JSON.stringify({
            type: "chunk",
            requestId,
            seq: seq++,
            data: chunk.toString("base64")
        }));
    });

    stream.on("end", () => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "chunk_end", requestId }));
        }
        activeStreams.delete(requestId);
        tuiBridge.emit("stream:end", requestId);
    });

    stream.on("error", (err) => {
        console.error(`❌ Stream error for request ${requestId}:`, err.message);
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "chunk_error", requestId, message: err.message }));
        }
        activeStreams.delete(requestId);
        tuiBridge.emit("stream:error", { requestId, message: err.message });
    });
}

function handleCancel(requestId) {
    const stream = activeStreams.get(requestId);
    if (stream) {
        console.log(`⏹ Canceled stream request: ${requestId}`);
        stream.destroy();
        activeStreams.delete(requestId);
        tuiBridge.emit("stream:cancel", requestId);
    }
}

function cleanupStreams() {
    for (const [requestId, stream] of activeStreams.entries()) {
        try { stream.destroy(); } catch {}
    }
    activeStreams.clear();
}

// Commands from TUI
tuiBridge.on("cmd:rescan", () => {
    console.log("🔄 Triggering manual rescan and reconnect...");
    cleanupStreams();
    if (ws) {
        ws.terminate();
    }
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }
    connect();
});

tuiBridge.on("cmd:toggle_downloads", () => {
    options.allowDownloads = !options.allowDownloads;
    console.log(`🔒 Downloads permission toggled to: ${options.allowDownloads ? "ALLOWED" : "DISABLED"}`);
    tuiBridge.emit("config:downloads", options.allowDownloads);
    cleanupStreams();
    if (ws) {
        ws.terminate();
    }
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }
    connect();
});

// Graceful exit
process.on("SIGINT", () => {
    console.log("\n🛑 Stopping peer daemon...");
    cleanupStreams();
    if (ws) {
        ws.terminate();
    }
    process.exit(0);
});

// Start connection loop
if (options.tui) {
    const { initTui } = await import("./peer-tui.js");
    initTui(tuiBridge, options);
}
connect();
