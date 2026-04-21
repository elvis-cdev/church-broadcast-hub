import { useEffect, useState } from "react";
import { Plus, Trash2, ExternalLink, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PlatformIcon } from "./PlatformIcon";
import { RTMP_PRESETS, type Destination } from "@/lib/streaming-types";

type Props = {
  destinations: Destination[];
  onChange: (next: Destination[]) => void;
  disabled?: boolean;
};

export function DestinationsPanel({ destinations, onChange, disabled }: Props) {
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  const add = (platform: Destination["platform"]) => {
    const preset = RTMP_PRESETS.find((p) => p.id === platform)!;
    const next: Destination = {
      id: crypto.randomUUID(),
      platform,
      name: preset.label,
      rtmpUrl: preset.rtmpUrl,
      streamKey: "",
      enabled: true,
    };
    onChange([...destinations, next]);
  };

  const update = (id: string, patch: Partial<Destination>) => {
    onChange(destinations.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  };

  const remove = (id: string) => onChange(destinations.filter((d) => d.id !== id));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {RTMP_PRESETS.map((p) => (
          <Button
            key={p.id}
            variant="secondary"
            size="sm"
            disabled={disabled}
            onClick={() => add(p.id)}
            className="gap-2"
          >
            <PlatformIcon platform={p.id} className="h-4 w-4" />
            <Plus className="h-3.5 w-3.5" />
            {p.label}
          </Button>
        ))}
      </div>

      {destinations.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Add a destination to start streaming. Your stream keys are stored encrypted on this device only.
        </div>
      ) : (
        <ul className="space-y-2">
          {destinations.map((d) => {
            const preset = RTMP_PRESETS.find((p) => p.id === d.platform);
            return (
              <li key={d.id} className="panel p-3 space-y-3">
                <div className="flex items-center gap-3">
                  <PlatformIcon platform={d.platform} className="h-5 w-5 shrink-0" />
                  <Input
                    value={d.name}
                    onChange={(e) => update(d.id, { name: e.target.value })}
                    className="h-8 bg-secondary/60 border-transparent focus-visible:border-primary"
                    placeholder="Destination name"
                  />
                  <Switch
                    checked={d.enabled}
                    onCheckedChange={(v) => update(d.id, { enabled: v })}
                    disabled={disabled}
                    aria-label="Enable destination"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => remove(d.id)}
                    disabled={disabled}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
                  <div className="sm:col-span-2 space-y-1">
                    <Label className="text-xs text-muted-foreground">RTMP URL</Label>
                    {d.platform === "custom" ? (
                      <Input
                        value={d.rtmpUrl}
                        placeholder="rtmp://your.server/live"
                        onChange={(e) => update(d.id, { rtmpUrl: e.target.value })}
                        disabled={disabled}
                        className="h-9 font-mono text-xs"
                      />
                    ) : (
                      <Select
                        value={d.rtmpUrl}
                        onValueChange={(v) => update(d.id, { rtmpUrl: v })}
                        disabled={disabled}
                      >
                        <SelectTrigger className="h-9 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={preset?.rtmpUrl ?? ""}>{preset?.rtmpUrl}</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                  <div className="sm:col-span-3 space-y-1">
                    <Label className="text-xs text-muted-foreground flex items-center justify-between">
                      Stream key
                      {preset?.helpUrl && (
                        <a
                          href={preset.helpUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-accent hover:underline inline-flex items-center gap-1"
                        >
                          Get key <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </Label>
                    <div className="relative">
                      <Input
                        type={revealed[d.id] ? "text" : "password"}
                        value={d.streamKey}
                        onChange={(e) => update(d.id, { streamKey: e.target.value })}
                        placeholder="Paste your stream key"
                        disabled={disabled}
                        className="h-9 pr-9 font-mono text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => setRevealed((r) => ({ ...r, [d.id]: !r[d.id] }))}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {revealed[d.id] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                </div>
                {preset?.description && (
                  <p className="text-xs text-muted-foreground">{preset.description}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Persist destinations locally (encrypted in Electron, plain localStorage in browser preview). */
export function useStoredDestinations() {
  const [destinations, setDestinations] = useState<Destination[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("sanctuary.destinations");
      if (raw) setDestinations(JSON.parse(raw));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("sanctuary.destinations", JSON.stringify(destinations));
    } catch {
      // ignore
    }
  }, [destinations]);

  return [destinations, setDestinations] as const;
}
