// Electron main process — Sanctuary Stream
// Spawns one FFmpeg process per enabled destination, pipes the renderer's
// MediaRecorder webm chunks into stdin, and pushes RTMP out.
// Stream keys live in encrypted local storage (safeStorage) — never network.

const { app, BrowserWindow, ipcMain, safeStorage, session } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn, spawnSync } = require("child_process");

let mainWindow = null;
const ffmpegProcs = new Map(); // destinationId -> { proc, name }

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

  const indexHtml = path.join(__dirname, "..", "dist", "index.html");
  if (fs.existsSync(indexHtml)) {
    mainWindow.loadFile(indexHtml);
  } else {
    // Dev mode — Vite server
    mainWindow.loadURL("http://localhost:8080");
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
      // Single FFmpeg per destination — input: webm/opus from MediaRecorder via stdin.
      // Re-encode to H.264 + AAC and push as FLV/RTMP.
      const args = [
        "-loglevel", "warning",
        "-fflags", "+genpts+nobuffer",
        "-i", "pipe:0",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-tune", "zerolatency",
        "-pix_fmt", "yuv420p",
        "-g", String(fps * 2),
        "-keyint_min", String(fps * 2),
        "-b:v", `${videoBitrateKbps}k`,
        "-maxrate", `${videoBitrateKbps}k`,
        "-bufsize", `${videoBitrateKbps * 2}k`,
        "-r", String(fps),
        "-c:a", "aac",
        "-b:a", `${audioBitrateKbps}k`,
        "-ar", "48000",
        "-ac", "2",
        "-f", "flv",
        target,
      ];

      const proc = spawn("ffmpeg", args, { stdio: ["pipe", "pipe", "pipe"] });
      ffmpegProcs.set(dest.id, { proc, name: dest.name });

      send({ type: "status", destinationId: dest.id, status: "connecting" });

      let connected = false;
      proc.stderr.on("data", (chunk) => {
        const text = chunk.toString();
        if (!connected && /Stream mapping|Press \[q\]|frame=/.test(text)) {
          connected = true;
          send({ type: "status", destinationId: dest.id, status: "live" });
        }
        // forward errors
        if (/Error|Failed|Connection refused|Invalid/i.test(text)) {
          send({
            type: "status",
            destinationId: dest.id,
            status: "error",
            message: text.split("\n")[0].slice(0, 240),
          });
        }
      });
      proc.on("close", (code) => {
        ffmpegProcs.delete(dest.id);
        send({
          type: "status",
          destinationId: dest.id,
          status: code === 0 ? "ended" : "error",
          message: code === 0 ? "Stream ended" : `FFmpeg exited with code ${code}`,
        });
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
