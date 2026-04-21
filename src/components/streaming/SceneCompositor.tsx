import { useEffect, useRef } from "react";
import type { Scene } from "@/lib/streaming-types";

type Props = {
  videoStream: MediaStream | null;
  scene: Scene;
  width?: number;
  height?: number;
  onCanvas?: (canvas: HTMLCanvasElement) => void;
  className?: string;
};

/**
 * Composites the live video device + the active scene's overlays onto a canvas.
 * The canvas is the single source of truth that gets piped into the encoder.
 */
export function SceneCompositor({
  videoStream,
  scene,
  width = 1920,
  height = 1080,
  onCanvas,
  className,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.autoplay = true;
    videoRef.current = v;
    return () => {
      v.srcObject = null;
    };
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (videoStream && videoStream.getVideoTracks().length > 0) {
      v.srcObject = videoStream;
      v.play().catch(() => undefined);
    } else {
      v.srcObject = null;
    }
  }, [videoStream]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;
    onCanvas?.(canvas);

    const draw = () => {
      // Background
      ctx.fillStyle = "#0a0d14";
      ctx.fillRect(0, 0, width, height);

      const v = videoRef.current;
      const showVideo = scene.type !== "holding" && scene.type !== "scripture";
      if (showVideo && v && v.readyState >= 2 && v.videoWidth > 0) {
        // contain-fit
        const ar = v.videoWidth / v.videoHeight;
        const targetAr = width / height;
        let dw = width;
        let dh = height;
        if (ar > targetAr) {
          dh = width / ar;
        } else {
          dw = height * ar;
        }
        const dx = (width - dw) / 2;
        const dy = (height - dh) / 2;
        ctx.drawImage(v, dx, dy, dw, dh);
      }

      if (scene.type === "holding") {
        drawHolding(ctx, width, height, scene.holdingMessage || "Service starting soon");
      } else if (scene.type === "scripture") {
        drawScripture(ctx, width, height, scene.scriptureRef || "", scene.scriptureText || "");
      } else if (scene.type === "camera-with-overlay") {
        drawLowerThird(ctx, width, height, scene.title || "", scene.subtitle || "");
      }

      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [scene, width, height, onCanvas]);

  return <canvas ref={canvasRef} className={className} />;
}

function drawLowerThird(ctx: CanvasRenderingContext2D, w: number, h: number, title: string, subtitle: string) {
  if (!title && !subtitle) return;
  const padX = w * 0.04;
  const barH = h * 0.13;
  const y = h - barH - h * 0.06;

  const grad = ctx.createLinearGradient(0, y, w, y);
  grad.addColorStop(0, "rgba(245, 138, 36, 0.95)");
  grad.addColorStop(1, "rgba(255, 184, 84, 0.85)");
  ctx.fillStyle = grad;
  ctx.fillRect(padX, y, w - padX * 2, barH);

  ctx.fillStyle = "rgba(10, 13, 20, 0.92)";
  ctx.fillRect(padX, y, w * 0.012, barH);

  ctx.fillStyle = "#0a0d14";
  ctx.font = `700 ${Math.round(barH * 0.4)}px Inter, system-ui, sans-serif`;
  ctx.textBaseline = "top";
  ctx.fillText(title, padX + w * 0.03, y + barH * 0.12);
  if (subtitle) {
    ctx.font = `500 ${Math.round(barH * 0.22)}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = "rgba(10, 13, 20, 0.75)";
    ctx.fillText(subtitle, padX + w * 0.03, y + barH * 0.62);
  }
}

function drawHolding(ctx: CanvasRenderingContext2D, w: number, h: number, message: string) {
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, "#0f1320");
  grad.addColorStop(1, "#1a1208");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // soft accent glow
  const r = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.4);
  r.addColorStop(0, "rgba(245, 138, 36, 0.25)");
  r.addColorStop(1, "rgba(245, 138, 36, 0)");
  ctx.fillStyle = r;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = "#f7f8fa";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `800 ${Math.round(h * 0.09)}px Inter, system-ui, sans-serif`;
  ctx.fillText(message, w / 2, h / 2 - h * 0.04);
  ctx.font = `500 ${Math.round(h * 0.035)}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = "rgba(247, 248, 250, 0.7)";
  ctx.fillText("Thank you for joining us today", w / 2, h / 2 + h * 0.06);
  ctx.textAlign = "start";
}

function drawScripture(ctx: CanvasRenderingContext2D, w: number, h: number, ref: string, text: string) {
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#0a0d14");
  grad.addColorStop(1, "#141a28");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = "#f7f8fa";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const maxWidth = w * 0.78;
  const fontSize = Math.round(h * 0.055);
  ctx.font = `500 ${fontSize}px Inter, system-ui, sans-serif`;
  const lines = wrapText(ctx, `“${text}”`, maxWidth);
  const lineH = fontSize * 1.35;
  const startY = h / 2 - ((lines.length - 1) * lineH) / 2 - h * 0.05;
  lines.forEach((line, i) => ctx.fillText(line, w / 2, startY + i * lineH));

  ctx.fillStyle = "hsl(28, 96%, 60%)";
  ctx.font = `700 ${Math.round(h * 0.04)}px Inter, system-ui, sans-serif`;
  ctx.fillText(ref, w / 2, startY + lines.length * lineH + h * 0.02);
  ctx.textAlign = "start";
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}
