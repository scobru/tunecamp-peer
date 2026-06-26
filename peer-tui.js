import blessed from "blessed";

export function initTui(tuiBridge, options) {
    const screen = blessed.screen({
        smartCSR: true,
        title: "TuneCamp Peer sharing daemon",
        dockBorders: true
    });

    // Capture console output to render in the scrollable log area
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;

    function cleanup() {
        console.log = originalLog;
        console.error = originalError;
        console.warn = originalWarn;
    }

    // Header Panel
    blessed.box({
        parent: screen,
        top: 0,
        left: 0,
        width: "100%",
        height: 3,
        content: " ⚡ TuneCamp Peer sharing daemon ⚡ ",
        align: "center",
        valign: "middle",
        style: {
            bg: "magenta",
            fg: "white",
            bold: true
        }
    });

    // Status Panel (Left)
    const statusBox = blessed.box({
        parent: screen,
        top: 3,
        left: 0,
        width: "50%",
        height: "50%-3",
        label: " Status & Info ",
        border: { type: "line" },
        tags: true,
        style: {
            border: { fg: "cyan" },
            label: { bold: true, fg: "cyan" }
        }
    });

    // Active Streams Panel (Right)
    const streamsBox = blessed.box({
        parent: screen,
        top: 3,
        left: "50%",
        width: "50%",
        height: "50%-3",
        label: " Active Streams & Downloads ",
        border: { type: "line" },
        tags: true,
        style: {
            border: { fg: "green" },
            label: { bold: true, fg: "green" }
        }
    });

    // Activity Log Panel (Bottom)
    const logBox = blessed.log({
        parent: screen,
        top: "50%",
        left: 0,
        width: "100%",
        height: "50%-1",
        label: " Activity Logs ",
        border: { type: "line" },
        tags: true,
        style: {
            border: { fg: "yellow" },
            label: { bold: true, fg: "yellow" }
        },
        scrollable: true,
        alwaysScroll: true,
        scrollback: 100,
        scrollbar: {
            ch: " ",
            inverse: true
        }
    });

    // Network Explorer Panel (Container, occupies same space as statusBox/streamsBox)
    const networkBox = blessed.box({
        parent: screen,
        top: 3,
        left: 0,
        width: "100%",
        height: "50%-3",
        hidden: true
    });

    const peersList = blessed.list({
        parent: networkBox,
        top: 0,
        left: 0,
        width: "40%",
        height: "100%",
        label: " Active Peers ",
        border: { type: "line" },
        keys: true,
        mouse: true,
        scrollbar: { ch: " ", inverse: true },
        style: {
            border: { fg: "cyan" },
            label: { bold: true, fg: "cyan" },
            selected: { bg: "cyan", fg: "black", bold: true },
            item: { fg: "white" }
        }
    });

    const tracksList = blessed.list({
        parent: networkBox,
        top: 0,
        left: "40%",
        width: "60%",
        height: "100%",
        label: " Shared Tracks ",
        border: { type: "line" },
        keys: true,
        mouse: true,
        scrollbar: { ch: " ", inverse: true },
        style: {
            border: { fg: "green" },
            label: { bold: true, fg: "green" },
            selected: { bg: "green", fg: "black", bold: true },
            item: { fg: "white" }
        }
    });

    // Footer Bar (Help)
    const footerBar = blessed.box({
        parent: screen,
        top: "100%-1",
        left: 0,
        width: "100%",
        height: 1,
        content: " [Q] Quit | [R] Force Rescan | [D] Toggle Downloads | [N] Network Explorer ",
        style: {
            bg: "white",
            fg: "black"
        }
    });

    // Set up console interception
    console.log = (...args) => {
        const msg = args.map(arg => typeof arg === "object" ? JSON.stringify(arg, null, 2) : String(arg)).join(" ");
        logBox.log(msg);
        screen.render();
    };

    console.error = (...args) => {
        const msg = args.map(arg => typeof arg === "object" ? JSON.stringify(arg, null, 2) : String(arg)).join(" ");
        logBox.log(`{red-fg}Error: ${msg}{/red-fg}`);
        screen.render();
    };

    console.warn = (...args) => {
        const msg = args.map(arg => typeof arg === "object" ? JSON.stringify(arg, null, 2) : String(arg)).join(" ");
        logBox.log(`{yellow-fg}Warning: ${msg}{/yellow-fg}`);
        screen.render();
    };

    // UI state
    let connectionState = "Starting scan...";
    let sessionId = "-";
    let tracksCount = 0;
    let allowDownloads = options.allowDownloads;
    const currentStreams = new Map();

    let currentMode = "sharing"; // "sharing" or "network"
    let activePeers = [];
    let activeTracks = [];
    let lastStreamsContent = "";

    function formatState(state) {
        if (state === "Online") return "{green-fg}{bold}Online (Connected){/bold}{/green-fg}";
        if (state.startsWith("Scanning") || state.startsWith("Connected") || state.startsWith("Connecting")) {
            return `{yellow-fg}${state}{/yellow-fg}`;
        }
        if (state.startsWith("Error") || state.startsWith("Disconnected") || state.startsWith("Auth failed")) {
            return `{red-fg}${state}{/red-fg}`;
        }
        return state;
    }

    function updateStatus() {
        const foldersList = options.folders.map(f => `  - ${f}`).join("\n");
        const statusContent = [
            ` {bold}Server URL:{/bold}   ${options.server || "N/A"}`,
            ` {bold}Status:{/bold}       ${formatState(connectionState)}`,
            ` {bold}Session ID:{/bold}   ${sessionId}`,
            ` {bold}Shared:{/bold}       ${tracksCount} tracks`,
            ` {bold}Downloads:{/bold}    ${allowDownloads ? "{green-fg}ALLOWED{/green-fg}" : "{red-fg}DISABLED{/red-fg}"}`,
            ``,
            ` {bold}Shared Folders:{/bold}`,
            foldersList
        ].join("\n");
        
        statusBox.setContent(statusContent);
        screen.render();
    }

    function updateStreams() {
        if (currentStreams.size === 0) {
            const emptyMsg = "\n   {gray-fg}No active streams or downloads.{/gray-fg}";
            if (lastStreamsContent !== emptyMsg) {
                streamsBox.setContent(emptyMsg);
                screen.render();
                lastStreamsContent = emptyMsg;
            }
            return;
        }

        const lines = [""];
        for (const [reqId, stream] of currentStreams.entries()) {
            const elapsed = ((Date.now() - stream.startTime) / 1000).toFixed(1);
            lines.push(` 🎵 {bold}${stream.title}{/bold}`);
            lines.push(`    ID: {gray-fg}${reqId.substring(0, 8)}...{/gray-fg} | Elapsed: ${elapsed}s`);
        }
        
        const newContent = lines.join("\n");
        streamsBox.setContent(newContent);
        lastStreamsContent = newContent;
        screen.render();
    }

    function updateFooter() {
        if (currentMode === "sharing") {
            footerBar.setContent(" [Q] Quit | [R] Force Rescan | [D] Toggle Downloads | [N] Network Explorer ");
        } else {
            const focusName = screen.focused === peersList ? "PEERS" : "TRACKS";
            footerBar.setContent(` [Q] Quit | [N] Back to Sharing | [Tab] Switch Focus (Active: ${focusName}) | [Enter/D] Download Track `);
        }
        screen.render();
    }

    function loadTracksForPeer(peer) {
        if (!peer) {
            tracksList.setItems([]);
            activeTracks = [];
            screen.render();
            return;
        }
        tracksList.setItems(["Loading tracks..."]);
        activeTracks = [];
        screen.render();

        tuiBridge.emit("cmd:get_peer_tracks", peer.id, (err, tracks) => {
            if (currentMode !== "network" || activePeers[peersList.selected]?.id !== peer.id) return;
            if (err) {
                tracksList.setItems([`Error: ${err.message}`]);
                screen.render();
                return;
            }
            activeTracks = tracks || [];
            const items = activeTracks.map(t => `${t.artist || "Unknown"} - ${t.title}`);
            if (items.length === 0) {
                tracksList.setItems(["No tracks shared."]);
            } else {
                tracksList.setItems(items);
            }
            screen.render();
        });
    }

    function refreshNetworkPeers() {
        peersList.setItems(["Loading peers..."]);
        tracksList.setItems([]);
        activePeers = [];
        activeTracks = [];
        screen.render();

        tuiBridge.emit("cmd:get_network_peers", (err, peers) => {
            if (currentMode !== "network") return;
            if (err) {
                peersList.setItems([`Error: ${err.message}`]);
                screen.render();
                return;
            }
            activePeers = peers || [];
            const items = activePeers.map(p => `${p.username} (${p.trackCount || 0} tracks)`);
            if (items.length === 0) {
                peersList.setItems(["No peers online."]);
            } else {
                peersList.setItems(items);
                peersList.select(0);
                loadTracksForPeer(activePeers[0]);
            }
            screen.render();
        });
    }

    function downloadSelectedTrack() {
        const track = activeTracks[tracksList.selected];
        const peer = activePeers[peersList.selected];
        if (track && peer && track.id) {
            console.log(`📥 Requesting download: "${track.title}" from peer "${peer.username}"...`);
            tuiBridge.emit("cmd:download_track", {
                sessionId: peer.id,
                trackId: track.id,
                title: track.title,
                artist: track.artist
            }, (err, filename) => {
                if (err) {
                    console.error(`❌ Download failed for "${track.title}": ${err.message}`);
                } else {
                    console.log(`✓ Download complete! Saved: downloads/${filename}`);
                }
            });
        }
    }

    // Bridge listeners
    tuiBridge.on("scan:start", (folders) => {
        connectionState = "Scanning folders...";
        updateStatus();
    });

    tuiBridge.on("scan:progress", ({ count, total }) => {
        connectionState = `Scanning metadata (${count}/${total} files)...`;
        updateStatus();
    });

    tuiBridge.on("scan:complete", (manifests) => {
        tracksCount = manifests.length;
        connectionState = "Scan complete";
        updateStatus();
    });

    tuiBridge.on("conn:connecting", ({ server }) => {
        connectionState = "Connecting...";
        updateStatus();
    });

    tuiBridge.on("conn:open", () => {
        connectionState = "Connected (Authenticating...)";
        updateStatus();
    });

    tuiBridge.on("conn:auth_ok", ({ sessionId: sid, manifestsCount }) => {
        connectionState = "Online";
        sessionId = sid;
        tracksCount = manifestsCount;
        updateStatus();
    });

    tuiBridge.on("conn:auth_fail", (reason) => {
        connectionState = `Auth failed: ${reason}`;
        updateStatus();
    });

    tuiBridge.on("conn:close", ({ reconnectDelay }) => {
        connectionState = `Disconnected. Reconnecting in ${reconnectDelay / 1000}s`;
        updateStatus();
    });

    tuiBridge.on("conn:error", (msg) => {
        connectionState = `Error: ${msg}`;
        updateStatus();
    });

    tuiBridge.on("stream:start", ({ requestId, title, trackId, filePath }) => {
        currentStreams.set(requestId, { title, trackId, filePath, startTime: Date.now() });
        updateStreams();
    });

    tuiBridge.on("stream:end", (requestId) => {
        const stream = currentStreams.get(requestId);
        if (stream) {
            console.log(`⏹ Finished streaming: ${stream.title}`);
        }
        currentStreams.delete(requestId);
        updateStreams();
    });

    tuiBridge.on("stream:cancel", (requestId) => {
        const stream = currentStreams.get(requestId);
        if (stream) {
            console.log(`⏹ Stream canceled: ${stream.title}`);
        }
        currentStreams.delete(requestId);
        updateStreams();
    });

    tuiBridge.on("stream:error", ({ requestId, message }) => {
        const stream = currentStreams.get(requestId);
        if (stream) {
            console.error(`❌ Stream error: ${stream.title} (${message || "unknown"})`);
        }
        currentStreams.delete(requestId);
        updateStreams();
    });

    tuiBridge.on("config:downloads", (val) => {
        allowDownloads = val;
        updateStatus();
    });

    // List bindings
    peersList.on("select item", (item, index) => {
        loadTracksForPeer(activePeers[index]);
    });

    peersList.on("focus", () => updateFooter());
    tracksList.on("focus", () => updateFooter());

    tracksList.on("select", () => {
        downloadSelectedTrack();
    });

    // Keyboard controls
    screen.key(["q", "C-c"], () => {
        cleanup();
        clearInterval(refreshInterval);
        process.exit(0);
    });

    screen.key(["r"], () => {
        if (currentMode === "sharing") {
            tuiBridge.emit("cmd:rescan");
        }
    });

    screen.key(["d"], () => {
        if (currentMode === "sharing") {
            tuiBridge.emit("cmd:toggle_downloads");
        } else if (currentMode === "network") {
            downloadSelectedTrack();
        }
    });

    screen.key(["n", "N"], () => {
        if (currentMode === "sharing") {
            currentMode = "network";
            statusBox.hide();
            streamsBox.hide();
            networkBox.show();
            refreshNetworkPeers();
            peersList.focus();
        } else {
            currentMode = "sharing";
            networkBox.hide();
            statusBox.show();
            streamsBox.show();
        }
        updateFooter();
    });

    screen.key(["tab"], () => {
        if (currentMode !== "network") return;
        if (screen.focused === peersList) {
            tracksList.focus();
        } else {
            peersList.focus();
        }
        updateFooter();
    });

    // Refresh active streams elapsed times periodically
    const refreshInterval = setInterval(updateStreams, 1000);

    // Initial render
    updateStatus();
    updateStreams();
}
