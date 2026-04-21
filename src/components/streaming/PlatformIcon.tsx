import { Facebook, Youtube, Twitch, Radio } from "lucide-react";
import type { Destination } from "@/lib/streaming-types";

const ICONS = {
  facebook: Facebook,
  youtube: Youtube,
  twitch: Twitch,
  custom: Radio,
} as const;

const COLORS: Record<Destination["platform"], string> = {
  facebook: "text-[hsl(214,89%,52%)]",
  youtube: "text-[hsl(0,82%,55%)]",
  twitch: "text-[hsl(264,68%,60%)]",
  custom: "text-accent",
};

export function PlatformIcon({ platform, className = "" }: { platform: Destination["platform"]; className?: string }) {
  const Icon = ICONS[platform];
  return <Icon className={`${COLORS[platform]} ${className}`} aria-hidden />;
}

export const PLATFORM_COLOR = COLORS;
