import { useCallback, useEffect, useRef, useState } from "react";
import { bridge, isElectron, type StreamEvent } from "@/lib/electron-bridge";
import type { Destination, StreamStatus } from "@/lib/streaming-types";

type StartArgs = {
  canvas: HTMLCanvasElement;
  audioStream: MediaStream | null;
  destinations: Destination[];
  videoBitrateKbps: number;
  fps: number;
};

/**
 * Combines a canvas video stream with an audio MediaStream, encodes as fragmented
 * webm/h264 via MediaRecorder, and ships chunks to the Electron main process where
 * FFmpeg muxes them and forwards an RTMP stream to each enabled destination.
 *
 * IMPORTANT: in a plain browser (no Electron runtime), RTMP push is impossible —
 * browsers cannot speak RTMP. Going live in browser mode is hard-blocked here;
 * the preview/devices/scenes still work for layout testing.
 */
export function useStreamEngine() {
  const [status, setStatus] = useState<StreamStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [perDestination, setPerDestination] = useState<Record<string, StreamStatus>>({});
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const startedAtRef = useRef<number>(0);
  const tickRef = useRef<number | null>(null);

  useEffect(() => {
    const b = bridge();
    if (!b) return;
    return b.onEvent((e: StreamEvent) => {
      if (e.type === "status") {
        setPerDestination((prev) => ({ ...prev, [e.destinationId]: e.status === "ended" ? "idle" : e.status }));
        if (e.status === "live") setStatus("live");
        if (e.status === "error") {
          setError(e.message || "Stream error");
          setStatus("error");
        }
      }
    });
  }, []);

  const start = useCallback(async ({ canvas, audioStream, destinations, videoBitrateKbps, fps }: StartArgs) => {
    setError(null);

    const b = bridge();
    if (!b) {
      setStatus("error");
      setError(
        "RTMP streaming requires the desktop app. Browsers cannot push to YouTube/Facebook/Twitch directly. " +
          "Run: npm run build && npm run electron — or use one of the packaged builds.",
      );
      return;
    }

    const enabled = destinations.filter((d) => d.enabled && d.rtmpUrl && d.streamKey);
    if (enabled.length === 0) {
      setError("Add at least one enabled destination with an RTMP URL and stream key.");
      return;
    }

    // Validate URLs early so we can show actionable errors before launching FFmpeg.
    const bad = enabled.find((d) => !/^rtmps?:\/\//i.test(d.rtmpUrl));
    if (bad) {
      setError(`"${bad.name}" has an invalid RTMP URL. It must start with rtmp:// or rtmps://`);
      return;
    }

    setStatus("connecting");

    const canvasStream = canvas.captureStream(fps);
    const tracks: MediaStreamTrack[] = [...canvasStream.getVideoTracks()];
    if (audioStream) tracks.push(...audioStream.getAudioTracks());
    const combined = new MediaStream(tracks);

    const check = await b.checkFfmpeg();
    if (!check.available) {
      setStatus("error");
      setError(check.hint || "FFmpeg is not installed. Install FFmpeg and try again.");
      return;
    }

    // We always transcode in the main process now (libx264 ultrafast), so
    // we don't care which codec MediaRecorder picks — VP8 is actually the
    // most reliable choice on Linux Chromium for FFmpeg's matroska demuxer.
    const mimeCandidates = [
      "video/webm;codecs=vp8,opus",
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=h264,opus",
      "video/webm",
    ];
    const mimeType = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) || "video/webm";

    const recorder = new MediaRecorder(combined, {
      mimeType,
      videoBitsPerSecond: videoBitrateKbps * 1000,
      audioBitsPerSecond: 160_000,
    });

    // CRITICAL race fix: FFmpeg fails with "Invalid data found when processing
    // input" if it starts reading from stdin before MediaRecorder has emitted
    // BOTH the EBML header AND at least one cluster. We buffer the first 2
    // chunks, then launch FFmpeg and flush. This is the most reliable startup
    // sequence we've found across Chromium versions.
    let ffmpegStarted = false;
    let ffmpegStarting = false;
    const pendingChunks: ArrayBuffer[] = [];
    const REQUIRED_PRELOAD_CHUNKS = 2;

    const startFfmpeg = async () => {
      if (ffmpegStarting || ffmpegStarted) return;
      ffmpegStarting = true;
      const result = await b.startStream({
        destinations: enabled.map((d) => ({ id: d.id, name: d.name, rtmpUrl: d.rtmpUrl, streamKey: d.streamKey })),
        videoBitrateKbps,
        audioBitrateKbps: 160,
        fps,
        width: canvas.width,
        height: canvas.height,
        videoCodec: "vp8", // informational only — main process always transcodes
      });
      if (!result.ok) {
        setStatus("error");
        setError(result.error || "Failed to start stream");
        try { recorder.stop(); } catch { /* noop */ }
        ffmpegStarting = false;
        return;
      }
      // Flush header + buffered clusters in arrival order.
      for (const buf of pendingChunks) bridge()?.pushVideoChunk(buf);
      pendingChunks.length = 0;
      ffmpegStarted = true;
      ffmpegStarting = false;
    };

    recorder.ondataavailable = async (ev) => {
      if (!ev.data || ev.data.size === 0) return;
      const buf = await ev.data.arrayBuffer();
      if (!ffmpegStarted) {
        pendingChunks.push(buf);
        if (pendingChunks.length >= REQUIRED_PRELOAD_CHUNKS && !ffmpegStarting) {
          await startFfmpeg();
        }
        return;
      }
      bridge()?.pushVideoChunk(buf);
    };
    // 250ms chunks: with 2 chunks needed before launch, FFmpeg starts within
    // ~500ms of going live — imperceptible to the user but enough data for
    // the matroska demuxer to find header + first cluster reliably.
    recorder.start(250);
    recorderRef.current = recorder;

    startedAtRef.current = Date.now();
    setElapsed(0);
    tickRef.current = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 500);
  }, []);

  const stop = useCallback(async () => {
    recorderRef.current?.state !== "inactive" && recorderRef.current?.stop();
    recorderRef.current = null;
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    await bridge()?.stopStream();
    setStatus("idle");
    setPerDestination({});
    setElapsed(0);
  }, []);

  return { status, error, perDestination, elapsed, start, stop, isElectron: isElectron() };
}

export function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
