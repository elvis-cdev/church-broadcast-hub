// Types shared across the streaming console.

export type DeviceInfo = {
  deviceId: string;
  label: string;
  kind: "videoinput" | "audioinput";
};

export type Destination = {
  id: string;
  platform: "facebook" | "youtube" | "twitch" | "custom";
  name: string;
  rtmpUrl: string;
  streamKey: string;
  enabled: boolean;
};

export type SceneType = "camera" | "camera-with-overlay" | "holding" | "scripture";

export type Scene = {
  id: string;
  name: string;
  type: SceneType;
  // Optional overlay payload
  title?: string;
  subtitle?: string;
  scriptureRef?: string;
  scriptureText?: string;
  holdingMessage?: string;
};

export type StreamStatus = "idle" | "connecting" | "live" | "error";

export type RtmpPreset = {
  id: Destination["platform"];
  label: string;
  rtmpUrl: string;
  helpUrl: string;
  description: string;
};

export const RTMP_PRESETS: RtmpPreset[] = [
  {
    id: "facebook",
    label: "Facebook Live",
    rtmpUrl: "rtmps://live-api-s.facebook.com:443/rtmp/",
    helpUrl: "https://www.facebook.com/live/producer",
    description: "Page → Live Producer → Streaming Software → copy Stream Key.",
  },
  {
    id: "youtube",
    label: "YouTube Live",
    rtmpUrl: "rtmp://a.rtmp.youtube.com/live2",
    helpUrl: "https://studio.youtube.com",
    description: "YouTube Studio → Go Live → Stream → copy Stream Key.",
  },
  {
    id: "twitch",
    label: "Twitch",
    rtmpUrl: "rtmp://live.twitch.tv/app",
    helpUrl: "https://dashboard.twitch.tv/settings/stream",
    description: "Creator Dashboard → Settings → Stream → copy Primary Stream Key.",
  },
  {
    id: "custom",
    label: "Custom RTMP",
    rtmpUrl: "",
    helpUrl: "",
    description: "Any RTMP/RTMPS endpoint (church website, Vimeo, restream, etc.).",
  },
];
