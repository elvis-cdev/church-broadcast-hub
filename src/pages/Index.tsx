import { useEffect, useMemo, useRef, useState } from "react";
import {
  Radio,
  Settings,
  Video,
  Mic,
  Volume2,
  VolumeX,
  Square,
  AlertTriangle,
  Monitor,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useMediaDevices, useCaptureStream } from "@/hooks/use-media-devices";
import { useAudioMixer } from "@/hooks/use-audio-mixer";
import { useStreamEngine, formatElapsed } from "@/hooks/use-stream-engine";
import { SceneCompositor } from "@/components/streaming/SceneCompositor";
import { AudioMeter } from "@/components/streaming/AudioMeter";
import { ScenesPanel } from "@/components/streaming/ScenesPanel";
import { DestinationsPanel, useStoredDestinations } from "@/components/streaming/DestinationsPanel";
import { PlatformIcon } from "@/components/streaming/PlatformIcon";
import { ScriptureListenerPanel } from "@/components/streaming/ScriptureListenerPanel";
import { useScriptureListener, type ScriptureSuggestion } from "@/hooks/use-scripture-listener";
import { isElectron } from "@/lib/electron-bridge";
import { toast } from "@/hooks/use-toast";
import { BookOpen } from "lucide-react";
import type { Scene } from "@/lib/streaming-types";

const DEFAULT_SCENES: Scene[] = [
  { id: "s-cam", name: "Camera", type: "camera" },
  {
    id: "s-third",
    name: "Lower third",
    type: "camera-with-overlay",
    title: "Pastor John Smith",
    subtitle: "Sunday Service • Living Faith Church",
  },
  {
    id: "s-scripture",
    name: "Scripture",
    type: "scripture",
    scriptureRef: "John 3:16",
    scriptureText:
      "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.",
  },
  { id: "s-holding", name: "Holding", type: "holding", holdingMessage: "Service starting soon" },
];

const Index = () => {
  const { videoDevices, audioDevices, requestPermission, refresh } = useMediaDevices();
  const [videoDeviceId, setVideoDeviceId] = useState<string | null>(null);
  const [audioDeviceId, setAudioDeviceId] = useState<string | null>(null);
  const { stream } = useCaptureStream(videoDeviceId, audioDeviceId);
  const audioOnlyStream = useMemo(() => {
    if (!stream) return null;
    const tracks = stream.getAudioTracks();
    return tracks.length ? new MediaStream(tracks) : null;
  }, [stream]);
  const mixer = useAudioMixer(audioOnlyStream);

  const [scenes, setScenes] = useState<Scene[]>(DEFAULT_SCENES);
  const [activeSceneId, setActiveSceneId] = useState(DEFAULT_SCENES[0].id);
  const activeScene = scenes.find((s) => s.id === activeSceneId) || scenes[0];

  const [destinations, setDestinations] = useStoredDestinations();
  const [bitrate, setBitrate] = useState(4500);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engine = useStreamEngine();
  const listener = useScriptureListener();

  // Auto-pick first device once we have permission and devices appear
  useEffect(() => {
    if (!videoDeviceId && videoDevices[0]) setVideoDeviceId(videoDevices[0].deviceId);
    if (!audioDeviceId && audioDevices[0]) setAudioDeviceId(audioDevices[0].deviceId);
  }, [videoDevices, audioDevices, videoDeviceId, audioDeviceId]);

  /**
   * Apply an AI-detected scripture suggestion: update (or create) the
   * scripture scene with the new reference/text and switch to it.
   */
  const applyScripture = (s: ScriptureSuggestion) => {
    let targetId: string | null = null;
    setScenes((prev) => {
      const existing = prev.find((sc) => sc.type === "scripture");
      if (existing) {
        targetId = existing.id;
        return prev.map((sc) =>
          sc.id === existing.id
            ? { ...sc, scriptureRef: s.reference, scriptureText: s.text }
            : sc,
        );
      }
      const created: Scene = {
        id: crypto.randomUUID(),
        name: "Scripture (AI)",
        type: "scripture",
        scriptureRef: s.reference,
        scriptureText: s.text,
      };
      targetId = created.id;
      return [...prev, created];
    });
    if (targetId) setActiveSceneId(targetId);
    listener.dismiss(s.id);
    toast({
      title: "Scripture pushed live",
      description: `${s.reference} is now on the preview.`,
    });
  };

  const handleGoLive = async () => {
    if (!canvasRef.current) return;
    await engine.start({
      canvas: canvasRef.current,
      audioStream: mixer.output,
      destinations,
      videoBitrateKbps: bitrate,
      fps: 30,
    });
  };

  const enabledDestinations = destinations.filter((d) => d.enabled);
  const isLive = engine.status === "live";
  const isConnecting = engine.status === "connecting";

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top bar */}
      <header className="border-b border-border bg-card/60 backdrop-blur sticky top-0 z-20">
        <div className="px-5 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-gradient-primary grid place-items-center shadow-glow">
              <Radio className="h-5 w-5 text-primary-foreground" />
            </div>
            <div className="leading-tight">
              <h1 className="text-sm font-bold tracking-tight">Sanctuary Stream</h1>
              <p className="text-[11px] text-muted-foreground">Multi-platform church live console</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {isLive && (
              <div className="flex items-center gap-2 rounded-full bg-live/15 border border-live/40 px-3 py-1">
                <span className="live-dot" />
                <span className="text-xs font-bold text-live tracking-wider">LIVE</span>
                <span className="text-xs font-mono text-foreground/80">{formatElapsed(engine.elapsed)}</span>
              </div>
            )}
            {!isElectron() && (
              <Badge variant="outline" className="gap-1.5 border-accent/40 text-accent">
                <Monitor className="h-3 w-3" /> Browser preview
              </Badge>
            )}
          </div>
        </div>
      </header>

      <main className="p-4 lg:p-5 grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-5">
        {/* LEFT — scenes */}
        <aside className="lg:col-span-3 space-y-4">
          <Section title="Scenes" icon={Video}>
            <ScenesPanel
              scenes={scenes}
              activeId={activeSceneId}
              onChange={setScenes}
              onSelect={setActiveSceneId}
            />
          </Section>
        </aside>

        {/* CENTER — preview + go live */}
        <section className="lg:col-span-6 space-y-4">
          <div className="panel overflow-hidden">
            <div className="aspect-video bg-black relative">
              <SceneCompositor
                videoStream={stream}
                scene={activeScene}
                onCanvas={(c) => (canvasRef.current = c)}
                className="w-full h-full"
              />
              {!stream && (
                <div className="absolute inset-0 grid place-items-center text-center p-6">
                  <div className="space-y-3">
                    <div className="mx-auto h-12 w-12 rounded-full bg-secondary grid place-items-center">
                      <Video className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="font-semibold">No video device selected</p>
                      <p className="text-sm text-muted-foreground">
                        Plug in your USB capture card and grant camera permission.
                      </p>
                    </div>
                    <Button onClick={requestPermission} variant="secondary" size="sm">
                      Grant device access
                    </Button>
                  </div>
                </div>
              )}
              {/* Overlay corners */}
              <div className="absolute top-3 left-3 flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 text-[10px] font-mono uppercase tracking-wider">
                <span className={isLive ? "h-1.5 w-1.5 rounded-full bg-live" : "h-1.5 w-1.5 rounded-full bg-muted-foreground"} />
                Preview
              </div>
              <div className="absolute top-3 right-3 rounded-md bg-black/60 px-2 py-1 text-[10px] font-mono">
                {canvasRef.current?.width || 1920}×{canvasRef.current?.height || 1080} · 30fps
              </div>
            </div>

            {/* Transport bar */}
            <div className="border-t border-border p-3 flex flex-wrap items-center gap-3 bg-secondary/30">
              <div className="flex-1 min-w-[200px]">
                <p className="text-xs text-muted-foreground">
                  Streaming to{" "}
                  <span className="text-foreground font-semibold">{enabledDestinations.length}</span>{" "}
                  destination{enabledDestinations.length === 1 ? "" : "s"}
                </p>
                <div className="mt-1 flex gap-1.5">
                  {enabledDestinations.map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center gap-1 rounded-md bg-card px-1.5 py-0.5 border border-border"
                      title={d.name}
                    >
                      <PlatformIcon platform={d.platform} className="h-3 w-3" />
                      <span className="text-[10px] text-muted-foreground">
                        {engine.perDestination[d.id] === "live" ? "live" : engine.perDestination[d.id] || "idle"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              {isLive || isConnecting ? (
                <Button
                  size="lg"
                  variant="destructive"
                  onClick={engine.stop}
                  className="gap-2 shadow-live"
                >
                  <Square className="h-4 w-4 fill-current" />
                  End stream
                </Button>
              ) : (
                <Button
                  size="lg"
                  onClick={handleGoLive}
                  disabled={!stream || enabledDestinations.length === 0}
                  className="gap-2 bg-gradient-primary text-primary-foreground hover:opacity-90 shadow-glow font-bold"
                >
                  <span className="h-2.5 w-2.5 rounded-full bg-live shadow-[0_0_12px_hsl(var(--live))]" />
                  Go Live
                </Button>
              )}
            </div>
            {engine.error && (
              <div className="border-t border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /> {engine.error}
              </div>
            )}
          </div>

          {/* Destinations */}
          <Section title="Destinations" icon={Radio}>
            <DestinationsPanel destinations={destinations} onChange={setDestinations} disabled={isLive || isConnecting} />
          </Section>
        </section>

        {/* RIGHT — devices + audio + settings */}
        <aside className="lg:col-span-3 space-y-4">
          <Section title="Inputs" icon={Settings}>
            <Tabs defaultValue="video" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="video" className="gap-1.5">
                  <Video className="h-3.5 w-3.5" /> Video
                </TabsTrigger>
                <TabsTrigger value="audio" className="gap-1.5">
                  <Mic className="h-3.5 w-3.5" /> Audio
                </TabsTrigger>
              </TabsList>
              <TabsContent value="video" className="space-y-2 pt-3">
                <Label className="text-xs text-muted-foreground">USB video capture</Label>
                <Select
                  value={videoDeviceId || ""}
                  onValueChange={(v) => setVideoDeviceId(v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select camera / capture card" />
                  </SelectTrigger>
                  <SelectContent>
                    {videoDevices.filter((d) => d.deviceId).length === 0 && (
                      <SelectItem value="none" disabled>
                        No devices found — grant camera permission
                      </SelectItem>
                    )}
                    {videoDevices
                      .filter((d) => d.deviceId)
                      .map((d) => (
                        <SelectItem key={d.deviceId} value={d.deviceId}>
                          {d.label || "Unnamed camera"}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <Button onClick={refresh} variant="ghost" size="sm" className="w-full">
                  Refresh devices
                </Button>
              </TabsContent>
              <TabsContent value="audio" className="space-y-3 pt-3">
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">USB audio codec</Label>
                  <Select value={audioDeviceId || ""} onValueChange={(v) => setAudioDeviceId(v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select audio interface" />
                    </SelectTrigger>
                    <SelectContent>
                      {audioDevices.filter((d) => d.deviceId).length === 0 && (
                        <SelectItem value="none" disabled>
                          No devices found — grant microphone permission
                        </SelectItem>
                      )}
                      {audioDevices
                        .filter((d) => d.deviceId)
                        .map((d) => (
                          <SelectItem key={d.deviceId} value={d.deviceId}>
                            {d.label || "Unnamed input"}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="panel p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => mixer.setMuted(!mixer.muted)}
                        className={`grid place-items-center h-8 w-8 rounded-md transition ${
                          mixer.muted ? "bg-destructive/20 text-destructive" : "bg-secondary text-foreground hover:bg-secondary/80"
                        }`}
                        aria-label={mixer.muted ? "Unmute" : "Mute"}
                      >
                        {mixer.muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                      </button>
                      <span className="text-xs font-medium">Master</span>
                    </div>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {mixer.levelDb.toFixed(0)} dB
                    </span>
                  </div>
                  <AudioMeter levelDb={mixer.levelDb} peakDb={mixer.peakDb} />
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Gain</Label>
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {Math.round(mixer.gain * 100)}%
                      </span>
                    </div>
                    <Slider
                      value={[mixer.gain * 100]}
                      onValueChange={(v) => mixer.setGain(v[0] / 100)}
                      min={0}
                      max={200}
                      step={1}
                    />
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </Section>

          <Section title="Scripture AI" icon={BookOpen}>
            <ScriptureListenerPanel
              supported={listener.supported}
              listening={listener.listening}
              partialTranscript={listener.partialTranscript}
              lastError={listener.lastError}
              suggestions={listener.suggestions}
              callsThisSession={listener.callsThisSession}
              onStart={listener.start}
              onStop={listener.stop}
              onApply={applyScripture}
              onDismiss={listener.dismiss}
            />
          </Section>

          <Section title="Stream quality" icon={Settings}>
            <div className="space-y-3">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">Video bitrate</Label>
                  <span className="text-xs font-mono">{bitrate} kbps</span>
                </div>
                <Slider
                  value={[bitrate]}
                  onValueChange={(v) => setBitrate(v[0])}
                  min={1500}
                  max={8000}
                  step={250}
                  disabled={isLive}
                />
                <p className="text-[10px] text-muted-foreground">
                  Recommended: 4000–6000 kbps for 1080p30 to Facebook & YouTube.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Stat label="Resolution" value="1920×1080" />
                <Stat label="Frame rate" value="30 fps" />
                <Stat label="Audio" value="160 kbps · 48k" />
                <Stat label="Encoder" value={isElectron() ? "FFmpeg x264" : "Browser"} />
              </div>
            </div>
          </Section>

          {!isElectron() && (
            <div className="panel p-3 text-xs space-y-2">
              <div className="flex items-start gap-2">
                <Download className="h-4 w-4 text-accent mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold text-foreground">Get the desktop app</p>
                  <p className="text-muted-foreground">
                    RTMP push to Facebook/YouTube/Twitch requires the desktop build (uses FFmpeg). Browser preview is for layout & device tests only.
                  </p>
                </div>
              </div>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
};

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Settings;
  children: React.ReactNode;
}) {
  return (
    <section className="panel p-4 space-y-3">
      <header className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-bold tracking-tight">{title}</h2>
      </header>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-secondary/50 border border-border px-2 py-1.5">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="font-mono">{value}</p>
    </div>
  );
}

export default Index;
