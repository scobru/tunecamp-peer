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
        scrollbar: {
            ch: " ",
            inverse: true
        }
    });

    // Footer Bar (Help)
    blessed.box({
        parent: screen,
        top: "100%-1",
        left: 0,
        width: "100%",
        height: 1,
        content: " [Q] Quit | [R] Force Rescan & Reconnect | [D] Toggle Downloads ",
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
            streamsBox.setContent("\n   {gray-fg}No active streams or downloads.{/gray-fg}");
            screen.render();
            return;
        }

        const lines = [""];
        for (const [reqId, stream] of currentStreams.entries()) {
            const elapsed = ((Date.now() - stream.startTime) / 1000).toFixed(1);
            lines.push(` 🎵 {bold}${stream.title}{/bold}`);
            lines.push(`    ID: {gray-fg}${reqId.substring(0, 8)}...{/gray-fg} | Elapsed: ${elapsed}s`);
        }
        streamsBox.setContent(lines.join("\n"));
        screen.render();
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
        currentStreams.delete(requestId);
        updateStreams();
    });

    tuiBridge.on("stream:cancel", (requestId) => {
        currentStreams.delete(requestId);
        updateStreams();
    });

    tuiBridge.on("stream:error", ({ requestId }) => {
        currentStreams.delete(requestId);
        updateStreams();
    });

    tuiBridge.on("config:downloads", (val) => {
        allowDownloads = val;
        updateStatus();
    });

    // Keyboard controls
    screen.key(["q", "C-c"], () => {
        cleanup();
        clearInterval(refreshInterval);
        process.exit(0);
    });

    screen.key(["r"], () => {
        tuiBridge.emit("cmd:rescan");
    });

    screen.key(["d"], () => {
        tuiBridge.emit("cmd:toggle_downloads");
    });

    // Refresh active streams elapsed times periodically
    const refreshInterval = setInterval(updateStreams, 1000);

    // Initial render
    updateStatus();
    updateStreams();
}
