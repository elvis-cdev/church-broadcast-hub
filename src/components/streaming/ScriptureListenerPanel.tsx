import { Headphones, MicOff, Mic, X, Send, BookOpen, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ScriptureSuggestion } from "@/hooks/use-scripture-listener";

type Props = {
  supported: boolean;
  listening: boolean;
  partialTranscript: string;
  lastError: string | null;
  suggestions: ScriptureSuggestion[];
  callsThisSession: number;
  onStart: () => void;
  onStop: () => void;
  onApply: (s: ScriptureSuggestion) => void;
  onDismiss: (id: string) => void;
};

export function ScriptureListenerPanel({
  supported,
  listening,
  partialTranscript,
  lastError,
  suggestions,
  callsThisSession,
  onStart,
  onStop,
  onApply,
  onDismiss,
}: Props) {
  if (!supported) {
    return (
      <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
        Speech recognition isn't supported in this browser. Use Chrome or Edge for AI scripture detection.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {listening ? (
          <Button onClick={onStop} variant="destructive" size="sm" className="gap-1.5">
            <MicOff className="h-3.5 w-3.5" /> Stop listening
          </Button>
        ) : (
          <Button onClick={onStart} size="sm" className="gap-1.5">
            <Mic className="h-3.5 w-3.5" /> Listen for scripture
          </Button>
        )}
        <div className="ml-auto flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Headphones className="h-3 w-3" />
          {callsThisSession} AI {callsThisSession === 1 ? "call" : "calls"}
        </div>
      </div>

      {listening && (
        <div className="rounded-md bg-secondary/40 border border-border p-2 text-xs">
          <div className="flex items-center gap-2 text-muted-foreground">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-live opacity-60 animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-live" />
            </span>
            <span>Listening for Bible references…</span>
          </div>
          {partialTranscript && (
            <p className="mt-1 italic text-foreground/70 line-clamp-2">"{partialTranscript}"</p>
          )}
        </div>
      )}

      {lastError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive flex items-start gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          {lastError}
        </div>
      )}

      {suggestions.length === 0 && listening && (
        <p className="text-[11px] text-muted-foreground">
          References will appear here as soon as they're spoken. Click <span className="font-semibold text-foreground">Push live</span> to display on stream.
        </p>
      )}

      {suggestions.length > 0 && (
        <ul className="space-y-2">
          {suggestions.map((s) => (
            <li key={s.id} className="panel p-2.5 space-y-2">
              <div className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-primary shrink-0" />
                <span className="text-sm font-bold">{s.reference}</span>
                <Badge variant="outline" className="text-[10px] uppercase">
                  {s.translation}
                </Badge>
                <Badge variant="secondary" className="text-[10px]">
                  {Math.round(s.confidence * 100)}%
                </Badge>
                <button
                  onClick={() => onDismiss(s.id)}
                  className="ml-auto rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  aria-label="Dismiss"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="text-xs text-foreground/85 leading-relaxed line-clamp-3">{s.text}</p>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] text-muted-foreground italic line-clamp-1">
                  heard: "{s.transcript}"
                </p>
                <Button size="sm" onClick={() => onApply(s)} className="gap-1.5 h-7">
                  <Send className="h-3 w-3" /> Push live
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
