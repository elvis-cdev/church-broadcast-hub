import { useCallback, useEffect, useRef, useState } from "react";
import type { DeviceInfo } from "@/lib/streaming-types";

export function useMediaDevices() {
  const [videoDevices, setVideoDevices] = useState<DeviceInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<DeviceInfo[]>([]);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setVideoDevices(
        list
          .filter((d) => d.kind === "videoinput")
          .map((d) => ({ deviceId: d.deviceId, label: d.label || "USB Video Capture", kind: "videoinput" as const })),
      );
      setAudioDevices(
        list
          .filter((d) => d.kind === "audioinput")
          .map((d) => ({ deviceId: d.deviceId, label: d.label || "USB Audio Codec", kind: "audioinput" as const })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to enumerate devices");
    }
  }, []);

  const requestPermission = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setPermissionGranted(true);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Permission denied");
    }
  }, [refresh]);

  useEffect(() => {
    refresh();
    const handler = () => refresh();
    navigator.mediaDevices?.addEventListener?.("devicechange", handler);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", handler);
  }, [refresh]);

  return { videoDevices, audioDevices, permissionGranted, error, requestPermission, refresh };
}

export function useCaptureStream(videoDeviceId: string | null, audioDeviceId: string | null) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      if (!videoDeviceId && !audioDeviceId) return;
      try {
        const constraints: MediaStreamConstraints = {
          video: videoDeviceId
            ? {
                deviceId: { exact: videoDeviceId },
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                frameRate: { ideal: 30 },
              }
            : false,
          audio: audioDeviceId
            ? {
                deviceId: { exact: audioDeviceId },
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                sampleRate: 48000,
                channelCount: 2,
              }
            : false,
        };
        const next = await navigator.mediaDevices.getUserMedia(constraints);
        if (cancelled) {
          next.getTracks().forEach((t) => t.stop());
          return;
        }
        activeStreamRef.current?.getTracks().forEach((t) => t.stop());
        activeStreamRef.current = next;
        setStream(next);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to open device");
      }
    };
    start();
    return () => {
      cancelled = true;
    };
  }, [videoDeviceId, audioDeviceId]);

  useEffect(() => {
    return () => {
      activeStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return { stream, error };
}
