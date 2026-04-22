
Goal: make streaming work only in the real desktop runtime, and make scripture detection listen to the selected church audio input instead of the browser’s default microphone.

What I found
- The current streaming code explicitly pretends the stream is live in browser mode when Electron is not available. That means if the app is opened with plain `npm` web serving, the UI can look live while nothing is actually being sent to Facebook/YouTube/Twitch.
- The scripture listener currently uses `SpeechRecognition.start()` with the browser mic, not the selected USB audio input. It is not wired to the chosen audio device or the mixed program audio.
- No recent `scripture-detect` backend calls were recorded, which means the “no network” issue is happening before AI verification; the speech-recognition layer is failing first.
- The browser speech API can depend on an online recognition service, so “no network” is a browser speech-service failure, not a failure in Bible lookup or the AI detector.

Implementation plan

1. Make RTMP streaming desktop-only and remove false success states
- Update `src/hooks/use-stream-engine.ts` so it never marks destinations as live when Electron is missing.
- Hard-block `Go Live` in browser mode and return a clear error like: “RTMP streaming requires the desktop app.”
- Keep the preview usable for layout/device checks, but stop simulating successful stream delivery.
- In `src/pages/Index.tsx`, make the runtime status much clearer and show the exact launch path for desktop mode.

2. Improve actual stream connection diagnostics
- In `electron/main.cjs`, capture and surface more FFmpeg stderr output per destination so connection failures are readable.
- Tighten the “live” detection so a destination is only marked live after real RTMP connection progress, not just local encoder startup.
- Validate RTMP URL + stream key before starting and show destination-specific errors in the UI.
- Add better handling for common platform failures: bad key, refused connection, handshake/auth failure, unsupported URL format.

3. Ensure the Electron app really loads in desktop mode during development
- Review the Electron boot path so desktop development reliably opens an Electron window instead of letting the user stay in a browser-only flow.
- Clean up the dev/runtime distinction in `electron/main.cjs`, `package.json`, and related UI messaging so “run through npm” cannot be mistaken for “desktop streaming is active.”

4. Make scripture detection listen to input audio instead of the default browser mic
- Refactor `src/hooks/use-scripture-listener.ts` to accept a `MediaStreamTrack` from the selected church audio input.
- Feed it from the selected USB audio source or the processed mixer output so detection follows the same audio being used for streaming.
- Use `SpeechRecognition.start(audioTrack)` where supported, instead of relying only on the browser’s default microphone.
- If track-based recognition is unavailable, fall back to an explicit user-gesture mic startup tied to the selected input and show a clear fallback message.

5. Fix the microphone / “no network” startup flow
- Start media permission and speech recognition directly from the button click path, so browser security rules don’t block audio access after async gaps.
- Add specific error handling for:
  - microphone blocked
  - no audio input found
  - audio device busy
  - browser speech service unavailable / offline
- Update `src/components/streaming/ScriptureListenerPanel.tsx` so the message explains the real issue instead of only showing “Mic: no-network”.

6. Keep credit usage low while improving accuracy for Kenyan-accented speech
- Preserve the current low-cost approach: local filtering, throttling, deduping, and short transcript windows.
- Adjust the transcript normalization prompt and candidate handling for Kenyan-accent phrasing, but avoid sending every sound fragment to AI.
- Continue fetching verse text from `bible-api.com` after a reference is normalized.

7. Wire the UI to the actual selected audio source
- Pass the active church audio stream from `src/pages/Index.tsx` into the scripture-listener hook.
- Show which input is currently being used for scripture listening, so the operator knows whether the listener is following “USB Audio Codec” or another source.
- Add a visible “listening from program audio / selected input” status.

Files to update
- `src/hooks/use-stream-engine.ts`
- `src/pages/Index.tsx`
- `electron/main.cjs`
- `src/hooks/use-scripture-listener.ts`
- `src/components/streaming/ScriptureListenerPanel.tsx`
- `src/hooks/use-media-devices.ts`
- possibly `README.md` / `package.json` for clearer desktop-run instructions

Expected result
- In browser mode, the app will no longer fake a successful live stream.
- In Electron mode, failed social-platform connections will show actionable errors.
- Scripture detection will listen from the church input audio path, not the random browser mic.
- “No network” will be handled as a speech-service/mic-state issue with clearer recovery steps.
- Credit usage stays controlled while still being tuned for Kenyan-accent scripture references.
