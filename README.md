# Sanctuary Stream

Multi-platform RTMP streaming console for churches. Captures your USB video capture card and USB audio codec, mixes audio with VU metering, composites scenes (camera, lower thirds, scripture, holding screens), and pushes a single source to Facebook Live, YouTube Live, Twitch, and any custom RTMP endpoint — simultaneously.

## Requirements

- **FFmpeg** must be installed and available on PATH.
  - Windows: `winget install ffmpeg` (or `scoop install ffmpeg`)
  - macOS: `brew install ffmpeg`
  - Linux: `sudo apt install ffmpeg`

## Run as desktop app

```
npm install
npm run build
npx electron .
```

## Package an installer

```
npx @electron/packager . "Sanctuary Stream" --platform=linux --arch=x64 --out=electron-release --overwrite \
  --ignore='^/src' --ignore='^/public' --ignore='^/electron-release'
```

Cross-build with `--platform=darwin` or `--platform=win32` from any machine.

## How it works

1. The renderer opens your USB capture card via `getUserMedia`, mixes audio through WebAudio with a gain stage + analyser for VU metering, and composites the chosen scene + overlays onto a 1920×1080 canvas.
2. `MediaRecorder` encodes the canvas + mixed audio as fragmented WebM and streams chunks over IPC to the Electron main process.
3. Main spawns one **FFmpeg** process per enabled destination, decodes the WebM, transcodes to H.264 + AAC, and pushes RTMP/RTMPS in parallel.
4. Stream keys are encrypted at rest via Electron `safeStorage` and never leave your machine except to the platform RTMP endpoint you target.
