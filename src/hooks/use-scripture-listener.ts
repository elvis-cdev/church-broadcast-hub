import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Web Speech API typing shim — not in standard lib
type SpeechRecognitionAlternative = { transcript: string; confidence: number };
type SpeechRecognitionResult = {
  isFinal: boolean;
  0: SpeechRecognitionAlternative;
  length: number;
};
type SpeechRecognitionEvent = {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResult>;
};
type ISpeechRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: { error: string; message?: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
};

declare global {
  interface Window {
    SpeechRecognition?: { new (): ISpeechRecognition };
    webkitSpeechRecognition?: { new (): ISpeechRecognition };
  }
}

export type ScriptureSuggestion = {
  id: string;
  reference: string;
  text: string;
  translation: string;
  confidence: number;
  detectedAt: number;
  transcript: string;
};

const BOOK_KEYWORDS = [
  "genesis", "exodus", "leviticus", "numbers", "deuteronomy",
  "joshua", "judges", "ruth", "samuel", "kings", "chronicles",
  "ezra", "nehemiah", "esther", "job", "psalm", "psalms",
  "proverbs", "ecclesiastes", "song of solomon", "song of songs",
  "isaiah", "jeremiah", "lamentations", "ezekiel", "daniel",
  "hosea", "joel", "amos", "obadiah", "jonah", "micah", "nahum",
  "habakkuk", "zephaniah", "haggai", "zechariah", "malachi",
  "matthew", "mark", "luke", "john", "acts", "romans",
  "corinthians", "galatians", "ephesians", "philippians",
  "colossians", "thessalonians", "timothy", "titus", "philemon",
  "hebrews", "james", "peter", "jude", "revelation", "revelations",
  "chapter", "verse",
];

const BOOK_REGEX = new RegExp(`\\b(${BOOK_KEYWORDS.join("|")})\\b`, "i");

const MIN_CALL_INTERVAL_MS = 4000;
const DEDUPE_WINDOW_MS = 60_000;

function looksLikeScripture(text: string): boolean {
  return BOOK_REGEX.test(text);
}

async function fetchVerseText(reference: string): Promise<string | null> {
  try {
    const url = `https://bible-api.com/${encodeURIComponent(reference)}?translation=kjv`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const data = await r.json();
    if (typeof data?.text === "string") {
      return data.text.trim().replace(/\s+/g, " ");
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Translate raw Web Speech API error codes into operator-friendly messages.
 * The browser's "no-network" specifically means Chrome's cloud speech service
 * is unreachable — it has nothing to do with our Bible/AI lookups.
 */
function explainSpeechError(code: string): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone blocked. Allow mic access in your browser settings, then click Listen again.";
    case "no-speech":
      return "No speech detected yet. Speak near the selected microphone.";
    case "audio-capture":
      return "No microphone found, or the selected device is in use by another app.";
    case "network":
    case "no-network":
      return "Speech recognition service is offline. Chrome's speech API needs internet access — check your connection and try again.";
    case "aborted":
      return "Listening stopped.";
    case "language-not-supported":
      return "This browser doesn't support the chosen speech language. Try Chrome or Edge.";
    default:
      return `Speech error: ${code}`;
  }
}

export type ListenerState = {
  supported: boolean;
  listening: boolean;
  partialTranscript: string;
  lastError: string | null;
  suggestions: ScriptureSuggestion[];
  callsThisSession: number;
  sourceLabel: string;
};

type StartOptions = {
  /** Optional label describing where audio is coming from (shown in UI). */
  sourceLabel?: string;
};

export function useScriptureListener() {
  const [state, setState] = useState<ListenerState>({
    supported: typeof window !== "undefined" &&
      !!(window.SpeechRecognition || window.webkitSpeechRecognition),
    listening: false,
    partialTranscript: "",
    lastError: null,
    suggestions: [],
    callsThisSession: 0,
    sourceLabel: "",
  });

  const recogRef = useRef<ISpeechRecognition | null>(null);
  const lastCallAtRef = useRef<number>(0);
  const recentRefsRef = useRef<Map<string, number>>(new Map());
  const pendingTextRef = useRef<string>("");
  const wantRunningRef = useRef<boolean>(false);

  const detect = useCallback(async (transcript: string) => {
    const now = Date.now();
    if (now - lastCallAtRef.current < MIN_CALL_INTERVAL_MS) return;
    if (!looksLikeScripture(transcript)) return;
    lastCallAtRef.current = now;

    setState((s) => ({ ...s, callsThisSession: s.callsThisSession + 1 }));

    try {
      const { data, error } = await supabase.functions.invoke("scripture-detect", {
        body: { transcript },
      });
      if (error) {
        const msg = error.message || "AI detect failed";
        setState((s) => ({ ...s, lastError: msg }));
        return;
      }
      if (!data?.found || !data?.reference) return;

      const ref: string = data.reference;
      const last = recentRefsRef.current.get(ref) || 0;
      if (now - last < DEDUPE_WINDOW_MS) return;
      recentRefsRef.current.set(ref, now);

      const text = await fetchVerseText(ref);
      if (!text) return;

      const suggestion: ScriptureSuggestion = {
        id: crypto.randomUUID(),
        reference: ref,
        text,
        translation: "kjv",
        confidence: typeof data.confidence === "number" ? data.confidence : 0.7,
        detectedAt: now,
        transcript,
      };
      setState((s) => ({
        ...s,
        suggestions: [suggestion, ...s.suggestions].slice(0, 8),
        lastError: null,
      }));
    } catch (e) {
      setState((s) => ({
        ...s,
        lastError: e instanceof Error ? e.message : "detection failed",
      }));
    }
  }, []);

  /**
   * Start listening. MUST be called from a user-gesture handler (button click)
   * so browser security allows mic permission and SpeechRecognition.start().
   *
   * The Web Speech API only listens to the browser's *default* input device —
   * it cannot be bound to a specific MediaStreamTrack. So we ask the user (in the UI)
   * to set the chosen USB audio input as the system default, and we surface the
   * label here so they can confirm what's being listened to.
   */
  const start = useCallback(async (opts: StartOptions = {}) => {
    if (recogRef.current) return;
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) {
      setState((s) => ({
        ...s,
        lastError: "Speech recognition not supported. Use Chrome or Edge.",
      }));
      return;
    }

    // Pre-flight: confirm we can actually open the mic. This surfaces clear
    // errors (NotAllowedError, NotFoundError, NotReadableError) before we hand off
    // to the speech engine, which only reports vague codes like "audio-capture".
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      probe.getTracks().forEach((t) => t.stop());
    } catch (e) {
      const name = e instanceof Error ? e.name : "";
      let msg = "Could not access microphone.";
      if (name === "NotAllowedError") {
        msg = "Microphone blocked. Allow mic access in your browser settings, then click Listen again.";
      } else if (name === "NotFoundError") {
        msg = "No microphone found. Connect your USB audio interface and refresh devices.";
      } else if (name === "NotReadableError") {
        msg = "Microphone is in use by another app. Close OBS / Zoom / etc. and retry.";
      }
      setState((s) => ({ ...s, lastError: msg, listening: false }));
      return;
    }

    const r = new Ctor();
    r.lang = "en-KE";
    r.continuous = true;
    r.interimResults = true;

    r.onresult = (event) => {
      let interim = "";
      let finalChunk = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const txt = res[0]?.transcript ?? "";
        if (res.isFinal) finalChunk += " " + txt;
        else interim += " " + txt;
      }
      if (interim) {
        setState((s) => ({ ...s, partialTranscript: interim.trim() }));
      }
      if (finalChunk) {
        pendingTextRef.current = (pendingTextRef.current + " " + finalChunk).trim();
        if (pendingTextRef.current.length > 400) {
          pendingTextRef.current = pendingTextRef.current.slice(-400);
        }
        setState((s) => ({ ...s, partialTranscript: "" }));
        void detect(pendingTextRef.current);
      }
    };

    r.onerror = (e) => {
      const code = e.error || "speech_error";
      if (code === "no-speech" || code === "aborted") return;
      const friendly = explainSpeechError(code);
      setState((s) => ({ ...s, lastError: friendly }));
      // Network errors from the browser speech service are usually transient
      // but the recognizer will stop. Don't auto-restart on hard failures.
      if (code === "network" || code === "not-allowed" || code === "service-not-allowed") {
        wantRunningRef.current = false;
      }
    };

    r.onstart = () => {
      setState((s) => ({ ...s, listening: true, lastError: null }));
    };

    r.onend = () => {
      if (wantRunningRef.current && recogRef.current === r) {
        try { r.start(); } catch { /* ignore */ }
      } else {
        recogRef.current = null;
        setState((s) => ({ ...s, listening: false }));
      }
    };

    recogRef.current = r;
    wantRunningRef.current = true;
    setState((s) => ({ ...s, sourceLabel: opts.sourceLabel || "system default microphone" }));
    try {
      r.start();
    } catch (e) {
      setState((s) => ({
        ...s,
        listening: false,
        lastError: e instanceof Error ? e.message : "Could not start mic",
      }));
      recogRef.current = null;
      wantRunningRef.current = false;
    }
  }, [detect]);

  const stop = useCallback(() => {
    wantRunningRef.current = false;
    const r = recogRef.current;
    if (r) {
      try { r.stop(); } catch { /* ignore */ }
    }
    recogRef.current = null;
    setState((s) => ({ ...s, listening: false, partialTranscript: "" }));
  }, []);

  const dismiss = useCallback((id: string) => {
    setState((s) => ({ ...s, suggestions: s.suggestions.filter((x) => x.id !== id) }));
  }, []);

  const clear = useCallback(() => {
    setState((s) => ({ ...s, suggestions: [] }));
  }, []);

  useEffect(() => () => {
    wantRunningRef.current = false;
    if (recogRef.current) {
      try { recogRef.current.abort(); } catch { /* ignore */ }
      recogRef.current = null;
    }
  }, []);

  return { ...state, start, stop, dismiss, clear };
}
