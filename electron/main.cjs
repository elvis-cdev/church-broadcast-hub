// Electron main process — Sanctuary Stream
// Spawns one FFmpeg process per enabled destination, pipes the renderer's
// MediaRecorder webm chunks into stdin, and pushes RTMP out.
// Stream keys live in encrypted local storage (safeStorage) — never network.

const { app, BrowserWindow, ipcMain, safeStorage, session } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn, spawnSync } = require("child_process");

let mainWindow = null;
const ffmpegProcs = new Map(); // destinationId -> { proc, name, connected, lastError }

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: "#0a0d14",
    title: "Sanctuary Stream",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Auto-grant camera + microphone for our own UI
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    if (permission === "media") return cb(true);
    cb(false);
  });

  const devUrl = process.env.ELECTRON_DEV ? "http://localhost:8080" : null;
  const indexHtml = path.join(__dirname, "..", "dist", "index.html");

  if (devUrl) {
    mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else if (fs.existsSync(indexHtml)) {
    mainWindow.loadFile(indexHtml);
  } else {
    // No build yet — show a helpful message instead of a blank window.
    mainWindow.loadURL(
      "data:text/html;charset=utf-8," +
        encodeURIComponent(`
          <html><body style="font-family:system-ui;background:#0a0d14;color:#e7ecf3;padding:32px;">
            <h2>No build found</h2>
            <p>Run <code>npm run build</code> first, then <code>npm run electron</code>.</p>
            <p>For development with hot reload, run <code>npm run dev</code> in one terminal and <code>npm run electron:dev</code> in another.</p>
          </body></html>
        `),
    );
  }
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  stopAll();
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ---------- FFmpeg detection ----------

function detectFfmpeg() {
  try {
    const r = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
    if (r.status === 0) {
      const first = (r.stdout || "").split("\n")[0];
      return { available: true, version: first };
    }
  } catch (_) {
    // ignore
  }
  return {
    available: false,
    hint:
      "FFmpeg not found in PATH. Install it:\n" +
      "  • Windows: winget install ffmpeg  (or scoop install ffmpeg)\n" +
      "  • macOS:   brew install ffmpeg\n" +
      "  • Linux:   sudo apt install ffmpeg\n" +
      "Then restart Sanctuary Stream.",
  };
}

ipcMain.handle("ffmpeg:check", () => detectFfmpeg());

// ---------- Stream control ----------

ipcMain.handle("stream:start", (_e, payload) => {
  try {
    const { destinations, videoBitrateKbps, audioBitrateKbps, fps } = payload;
    if (!destinations || destinations.length === 0) {
      return { ok: false, error: "No destinations provided" };
    }
    const check = detectFfmpeg();
    if (!check.available) return { ok: false, error: check.hint };

    stopAll();

    for (const dest of destinations) {
      const target = joinRtmp(dest.rtmpUrl, dest.streamKey);

      // Force matroska demuxer (handles Chromium's WebM-with-H264 quirk that
      // the strict "webm" demuxer rejects with "Invalid data found"). Matroska
      // is a superset of WebM so VP8/VP9 streams parse cleanly too.
      const inputArgs = [
        "-loglevel", "warning",
        "-fflags", "+genpts+igndts+discardcorrupt+nobuffer",
        "-thread_queue_size", "1024",
        "-probesize", "32M",
        "-analyzeduration", "10M",
        "-f", "matroska",
        "-i", "pipe:0",
      ];

      // Always transcode with libx264 ultrafast/zerolatency. Stream-copy from
      // MediaRecorder is unreliable across Chromium versions because the
      // generated H.264-in-WebM doesn't always have spec-compliant timestamps,
      // which Facebook rejects ("trouble playing this video"). Transcoding
      // gives us clean PTS/DTS and the CPU cost of `ultrafast` is small.
      const videoArgs = [
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-tune", "zerolatency",
        "-profile:v", "baseline",   // baseline = max compatibility w/ FB ingest
        "-level", "4.0",
        "-pix_fmt", "yuv420p",
        "-r", String(fps),
        "-g", String(fps * 2),
        "-keyint_min", String(fps * 2),
        "-sc_threshold", "0",
        "-b:v", `${videoBitrateKbps}k`,
        "-maxrate", `${videoBitrateKbps}k`,
        "-bufsize", `${videoBitrateKbps * 2}k`,
      ];

      const args = [
        ...inputArgs,
        ...videoArgs,
        "-c:a", "aac",
        "-profile:a", "aac_low",
        "-b:a", `${audioBitrateKbps}k`,
        "-ar", "48000",
        "-ac", "2",
        "-async", "1",
        "-f", "flv",
        "-flvflags", "no_duration_filesize+aac_seq_header_detect",
        target,
      ];

      const proc = spawn("ffmpeg", args, { stdio: ["pipe", "pipe", "pipe"] });
      const entry = { proc, name: dest.name, connected: false, lastError: "", stderrTail: [] };
      ffmpegProcs.set(dest.id, entry);

      send({ type: "status", destinationId: dest.id, status: "connecting" });

      proc.stderr.on("data", (chunk) => {
        const text = chunk.toString();

        // Keep a small ring buffer of stderr so we can surface context if FFmpeg
        // exits with a non-zero code. RTMP errors usually appear here verbatim.
        entry.stderrTail.push(text);
        if (entry.stderrTail.length > 20) entry.stderrTail.shift();

        // Mark live only when actual frames are being pushed downstream.
        // "Stream mapping" alone fires before the RTMP handshake completes.
        if (!entry.connected && /frame=\s*\d+/.test(text)) {
          entry.connected = true;
          send({ type: "status", destinationId: dest.id, status: "live" });
        }

        // Surface known fatal RTMP problems with a friendly hint.
        const platformError = parsePlatformError(text);
        if (platformError) {
          entry.lastError = platformError;
          send({
            type: "status",
            destinationId: dest.id,
            status: "error",
            message: platformError,
          });
        }
      });

      proc.on("close", (code) => {
        const tail = (entry.stderrTail || []).join("").split("\n").filter(Boolean).slice(-3).join(" | ");
        ffmpegProcs.delete(dest.id);
        if (code === 0) {
          send({ type: "status", destinationId: dest.id, status: "ended", message: "Stream ended" });
        } else {
          const msg = entry.lastError
            || `FFmpeg exited with code ${code}. ${tail || "Check RTMP URL and stream key."}`;
          send({ type: "status", destinationId: dest.id, status: "error", message: msg });
        }
      });

      proc.on("error", (err) => {
        send({ type: "status", destinationId: dest.id, status: "error", message: err.message });
      });
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

/**
 * Translate raw FFmpeg stderr lines into actionable, platform-aware error messages.
 * Returns null if nothing actionable is detected so the stream can keep trying.
 */
function parsePlatformError(text) {
  const t = text.toLowerCase();
  if (t.includes("invalid data found when processing input")) {
    return "FFmpeg couldn't read the video stream header. Click Stop, wait 2 seconds, then click Go Live again — the encoder needs a fresh start.";
  }
  if (t.includes("connection refused")) {
    return "Connection refused by the streaming server. Check the RTMP URL.";
  }
  if (t.includes("no route to host") || t.includes("could not resolve")) {
    return "Cannot reach the streaming server. Check your internet connection and the RTMP URL.";
  }
  if (t.includes("rtmp_connect") && t.includes("error")) {
    return "RTMP handshake failed. The URL or server may be wrong.";
  }
  if (t.includes("authentication required") || t.includes("not authorized") || t.includes("403")) {
    return "Authentication failed. Your stream key is invalid or expired — copy a fresh one from the platform.";
  }
  if (t.includes("invalid stream key") || t.includes("bad request") || t.includes("400")) {
    return "Invalid stream key. Copy a fresh one from the platform's Live Producer / Stream Settings.";
  }
  if (t.includes("end of file") && t.includes("rtmp")) {
    return "Stream ended by server. Likely a bad stream key or the platform isn't expecting a stream right now.";
  }
  if (t.includes("session has been invalidated") || t.includes("tls") && t.includes("invalidated")) {
    return "Facebook rejected the connection (TLS session invalidated). This almost always means the stream key was already used or expired. Go to Facebook Live Producer, copy a FRESH stream key, paste it here, and try again. Tip: enable 'Use a persistent stream key' in Facebook so you don't have to recopy each time.";
  }
  if (t.includes("immediate exit requested")) {
    return "Stream stopped by FFmpeg.";
  }
  return null;
}

ipcMain.on("stream:video-chunk", (_e, buf) => {
  const data = Buffer.from(buf);
  for (const { proc } of ffmpegProcs.values()) {
    if (proc.stdin && !proc.stdin.destroyed) {
      try {
        proc.stdin.write(data);
      } catch (_) {
        // ignore individual write errors; FFmpeg close handler will surface them
      }
    }
  }
});

ipcMain.handle("stream:stop", () => {
  stopAll();
});

function stopAll() {
  for (const [id, { proc }] of ffmpegProcs.entries()) {
    try {
      proc.stdin && proc.stdin.end();
    } catch (_) {}
    try {
      proc.kill("SIGINT");
      setTimeout(() => {
        try {
          if (!proc.killed) proc.kill("SIGKILL");
        } catch (_) {}
      }, 1500);
    } catch (_) {}
    ffmpegProcs.delete(id);
  }
}

function joinRtmp(url, key) {
  if (!key) return url;
  if (url.endsWith("/")) return url + key;
  return url + "/" + key;
}

function send(event) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("stream:event", event);
  }
}

// ---------- Encrypted secret storage ----------

const secretsFile = () => path.join(app.getPath("userData"), "secrets.json");

function readSecrets() {
  try {
    const raw = fs.readFileSync(secretsFile(), "utf8");
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}
function writeSecrets(obj) {
  try {
    fs.writeFileSync(secretsFile(), JSON.stringify(obj), { mode: 0o600 });
  } catch (_) {}
}

ipcMain.handle("secret:save", (_e, key, value) => {
  const all = readSecrets();
  if (safeStorage.isEncryptionAvailable()) {
    all[key] = safeStorage.encryptString(String(value)).toString("base64");
  } else {
    all[key] = "plain:" + Buffer.from(String(value)).toString("base64");
  }
  writeSecrets(all);
});

ipcMain.handle("secret:load", (_e, key) => {
  const all = readSecrets();
  const v = all[key];
  if (!v) return null;
  try {
    if (v.startsWith("plain:")) return Buffer.from(v.slice(6), "base64").toString("utf8");
    return safeStorage.decryptString(Buffer.from(v, "base64"));
  } catch (_) {
    return null;
  }
});
