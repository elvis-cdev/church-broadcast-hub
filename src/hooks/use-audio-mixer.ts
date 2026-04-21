import { useEffect, useRef, useState } from "react";

/**
 * Hooks an audio MediaStream into WebAudio for gain control, mute, and metering.
 * Returns the processed MediaStream so it can be combined with the video for streaming.
 */
export function useAudioMixer(input: MediaStream | null) {
  const [gain, setGain] = useState(1);
  const [muted, setMuted] = useState(false);
  const [levelDb, setLevelDb] = useState(-60);
  const [peakDb, setPeakDb] = useState(-60);

  const ctxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const destRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const peakRef = useRef<{ value: number; ts: number }>({ value: -60, ts: 0 });
  const [output, setOutput] = useState<MediaStream | null>(null);

  useEffect(() => {
    if (!input || input.getAudioTracks().length === 0) {
      setOutput(null);
      return;
    }
    const ctx = new AudioContext({ sampleRate: 48000 });
    const source = ctx.createMediaStreamSource(input);
    const gainNode = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    const dest = ctx.createMediaStreamDestination();

    source.connect(gainNode);
    gainNode.connect(analyser);
    gainNode.connect(dest);

    ctxRef.current = ctx;
    sourceRef.current = source;
    gainNodeRef.current = gainNode;
    analyserRef.current = analyser;
    destRef.current = dest;
    setOutput(dest.stream);

    const data = new Float32Array(analyser.fftSize);
    const tick = () => {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      let peak = 0;
      for (let i = 0; i < data.length; i++) {
        const v = data[i];
        sum += v * v;
        const a = Math.abs(v);
        if (a > peak) peak = a;
      }
      const rms = Math.sqrt(sum / data.length);
      const db = 20 * Math.log10(rms || 1e-6);
      const pdb = 20 * Math.log10(peak || 1e-6);
      setLevelDb(Math.max(-60, Math.min(0, db)));
      const now = performance.now();
      if (pdb > peakRef.current.value || now - peakRef.current.ts > 1200) {
        peakRef.current = { value: pdb, ts: now };
      }
      setPeakDb(Math.max(-60, Math.min(0, peakRef.current.value)));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      source.disconnect();
      gainNode.disconnect();
      analyser.disconnect();
      dest.disconnect();
      ctx.close();
    };
  }, [input]);

  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = muted ? 0 : gain;
    }
  }, [gain, muted]);

  return { output, gain, setGain, muted, setMuted, levelDb, peakDb };
}
