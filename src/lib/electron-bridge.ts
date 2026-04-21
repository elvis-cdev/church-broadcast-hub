// Detect if running inside Electron and expose a typed bridge to main-process IPC.
// In the browser preview these calls fall back to safe no-ops, so the UI is fully usable
// for layout/QA without the desktop runtime.

export type StartStreamPayload = {
  destinations: {
    id: string;
    name: string;
    rtmpUrl: string;
    streamKey: string;
  }[];
  videoBitrateKbps: number;
  audioBitrateKbps: number;
  fps: number;
  width: number;
  height: number;
};

export type StreamEvent =
  | { type: "status"; destinationId: string; status: "connecting" | "live" | "error" | "ended"; message?: string }
  | { type: "stats"; destinationId: string; bitrateKbps: number; fps: number };

type ElectronBridge = {
  isElectron: true;
  startStream: (payload: StartStreamPayload) => Promise<{ ok: boolean; error?: string }>;
  stopStream: () => Promise<void>;
  pushVideoChunk: (chunk: ArrayBuffer) => void;
  pushAudioChunk: (chunk: ArrayBuffer) => void;
  onEvent: (cb: (e: StreamEvent) => void) => () => void;
  checkFfmpeg: () => Promise<{ available: boolean; version?: string; hint?: string }>;
  saveSecret: (key: string, value: string) => Promise<void>;
  loadSecret: (key: string) => Promise<string | null>;
};

declare global {
  interface Window {
    sanctuary?: ElectronBridge;
  }
}

export const isElectron = (): boolean => typeof window !== "undefined" && !!window.sanctuary?.isElectron;

export const bridge = (): ElectronBridge | null =>
  typeof window !== "undefined" && window.sanctuary ? window.sanctuary : null;
