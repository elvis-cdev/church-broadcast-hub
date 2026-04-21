import { Plus, Trash2, Camera, Type, Image as ImageIcon, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Scene, SceneType } from "@/lib/streaming-types";
import { cn } from "@/lib/utils";

const SCENE_ICONS: Record<SceneType, typeof Camera> = {
  camera: Camera,
  "camera-with-overlay": Type,
  holding: ImageIcon,
  scripture: BookOpen,
};

type Props = {
  scenes: Scene[];
  activeId: string;
  onChange: (next: Scene[]) => void;
  onSelect: (id: string) => void;
};

export function ScenesPanel({ scenes, activeId, onChange, onSelect }: Props) {
  const active = scenes.find((s) => s.id === activeId);

  const add = (type: SceneType) => {
    const defaults: Record<SceneType, Partial<Scene>> = {
      camera: { name: "Camera", type },
      "camera-with-overlay": { name: "Lower third", type, title: "Pastor Name", subtitle: "Sunday Service" },
      holding: { name: "Holding", type, holdingMessage: "Service starting soon" },
      scripture: {
        name: "Scripture",
        type,
        scriptureRef: "John 3:16",
        scriptureText: "For God so loved the world, that he gave his only begotten Son.",
      },
    };
    const next: Scene = { id: crypto.randomUUID(), name: "Scene", type, ...defaults[type] } as Scene;
    onChange([...scenes, next]);
    onSelect(next.id);
  };

  const update = (patch: Partial<Scene>) => {
    if (!active) return;
    onChange(scenes.map((s) => (s.id === active.id ? { ...s, ...patch } : s)));
  };

  const remove = (id: string) => {
    const next = scenes.filter((s) => s.id !== id);
    onChange(next);
    if (id === activeId && next[0]) onSelect(next[0].id);
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {scenes.map((s) => {
          const Icon = SCENE_ICONS[s.type];
          const isActive = s.id === activeId;
          return (
            <button
              key={s.id}
              onClick={() => onSelect(s.id)}
              className={cn(
                "group relative rounded-lg border p-3 text-left transition-all",
                isActive
                  ? "border-primary bg-primary/10 shadow-glow"
                  : "border-border bg-secondary/40 hover:border-primary/40",
              )}
            >
              <div className="flex items-center gap-2">
                <Icon className={cn("h-4 w-4", isActive ? "text-primary" : "text-muted-foreground")} />
                <span className="text-sm font-medium truncate">{s.name}</span>
              </div>
              <span className="mt-1 block text-[10px] uppercase tracking-wider text-muted-foreground">
                {s.type.replace("-", " ")}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  remove(s.id);
                }}
                className="absolute right-1.5 top-1.5 rounded p-1 text-muted-foreground opacity-0 transition hover:bg-destructive/20 hover:text-destructive group-hover:opacity-100"
                aria-label="Remove scene"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        <AddSceneButton icon={Camera} label="Camera" onClick={() => add("camera")} />
        <AddSceneButton icon={Type} label="Lower third" onClick={() => add("camera-with-overlay")} />
        <AddSceneButton icon={BookOpen} label="Scripture" onClick={() => add("scripture")} />
        <AddSceneButton icon={ImageIcon} label="Holding" onClick={() => add("holding")} />
      </div>

      {active && (active.type !== "camera") && (
        <div className="panel p-3 space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Edit “{active.name}”
          </h3>
          {active.type === "camera-with-overlay" && (
            <>
              <Field label="Title">
                <Input
                  value={active.title || ""}
                  onChange={(e) => update({ title: e.target.value })}
                  placeholder="Pastor John Smith"
                />
              </Field>
              <Field label="Subtitle">
                <Input
                  value={active.subtitle || ""}
                  onChange={(e) => update({ subtitle: e.target.value })}
                  placeholder="Sunday Service • Living Faith Church"
                />
              </Field>
            </>
          )}
          {active.type === "scripture" && (
            <>
              <Field label="Reference">
                <Input
                  value={active.scriptureRef || ""}
                  onChange={(e) => update({ scriptureRef: e.target.value })}
                  placeholder="John 3:16"
                />
              </Field>
              <Field label="Verse">
                <Textarea
                  value={active.scriptureText || ""}
                  onChange={(e) => update({ scriptureText: e.target.value })}
                  rows={3}
                  placeholder="For God so loved the world..."
                />
              </Field>
            </>
          )}
          {active.type === "holding" && (
            <Field label="Message">
              <Input
                value={active.holdingMessage || ""}
                onChange={(e) => update({ holdingMessage: e.target.value })}
                placeholder="Service starting soon"
              />
            </Field>
          )}
        </div>
      )}
    </div>
  );
}

function AddSceneButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Camera;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} className="gap-1.5 text-muted-foreground hover:text-foreground">
      <Plus className="h-3.5 w-3.5" />
      <Icon className="h-3.5 w-3.5" />
      {label}
    </Button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
