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
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

declare global {
  interface Window {
    SpeechRecognition?: { new (): ISpeechRecognition };
    webkitSpeechRecognition?: { new (): ISpeechRecognition };
  }
}

export type ScriptureSuggestion = {
  id: string;
  reference: string; // e.g. "John 3:16"
  text: string; // verse text from bible-api
  translation: string; // e.g. "kjv"
  confidence: number;
  detectedAt: number;
  transcript: string; // the snippet that triggered detection
};

// Bible book names (66 books) used in the keyword pre-filter so we never
// spend AI credits on transcripts that obviously contain no scripture.
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
  // Common spoken cues
  "chapter", "verse",
];

const BOOK_REGEX = new RegExp(`\\b(${BOOK_KEYWORDS.join("|")})\\b`, "i");

// Throttle: only one AI call every N ms, regardless of how much speech arrives.
const MIN_CALL_INTERVAL_MS = 4000;
// Don't re-detect the same reference within this window.
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

export type ListenerState = {
  supported: boolean;
  listening: boolean;
  partialTranscript: string;
  lastError: string | null;
  suggestions: ScriptureSuggestion[];
  callsThisSession: number;
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

  const start = useCallback(() => {
    if (recogRef.current) return;
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) {
      setState((s) => ({ ...s, lastError: "Speech recognition not supported in this browser." }));
      return;
    }
    const r = new Ctor();
    r.lang = "en-KE"; // Kenyan English; falls back to en-US if unsupported
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
        // Keep a sliding window of ~2 sentences worth
        if (pendingTextRef.current.length > 400) {
          pendingTextRef.current = pendingTextRef.current.slice(-400);
        }
        setState((s) => ({ ...s, partialTranscript: "" }));
        void detect(pendingTextRef.current);
      }
    };

    r.onerror = (e) => {
      const err = e.error || "speech_error";
      // 'no-speech' and 'aborted' are expected; don't surface
      if (err !== "no-speech" && err !== "aborted") {
        setState((s) => ({ ...s, lastError: `Mic: ${err}` }));
      }
    };

    r.onend = () => {
      // Auto-restart if user still wants to listen
      if (wantRunningRef.current && recogRef.current === r) {
        try { r.start(); } catch { /* ignore */ }
      } else {
        recogRef.current = null;
        setState((s) => ({ ...s, listening: false }));
      }
    };

    recogRef.current = r;
    wantRunningRef.current = true;
    try {
      r.start();
      setState((s) => ({ ...s, listening: true, lastError: null }));
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
