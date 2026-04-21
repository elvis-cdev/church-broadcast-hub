// Preload — exposes a minimal, typed surface to the renderer.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("sanctuary", {
  isElectron: true,
  startStream: (payload) => ipcRenderer.invoke("stream:start", payload),
  stopStream: () => ipcRenderer.invoke("stream:stop"),
  pushVideoChunk: (chunk) => ipcRenderer.send("stream:video-chunk", chunk),
  pushAudioChunk: (chunk) => ipcRenderer.send("stream:audio-chunk", chunk),
  onEvent: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on("stream:event", handler);
    return () => ipcRenderer.removeListener("stream:event", handler);
  },
  checkFfmpeg: () => ipcRenderer.invoke("ffmpeg:check"),
  saveSecret: (key, value) => ipcRenderer.invoke("secret:save", key, value),
  loadSecret: (key) => ipcRenderer.invoke("secret:load", key),
});
