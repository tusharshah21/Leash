// Shared pieces of the Leash demo, in the dashboard's "Control Room" style.
import type { Caption } from "@remotion/captions";
import { createTikTokStyleCaptions } from "@remotion/captions";
import { loadFont as loadMono } from "@remotion/google-fonts/IBMPlexMono";
import { loadFont as loadSans } from "@remotion/google-fonts/IBMPlexSans";
import React, { useMemo } from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

export const SANS = loadSans("normal", { weights: ["400", "500", "600", "700"], subsets: ["latin"] }).fontFamily;
export const MONO = loadMono("normal", { weights: ["400", "500", "600"], subsets: ["latin"] }).fontFamily;

export const C = {
  bg: "#0b0e11",
  surface: "#12171c",
  raised: "#181f26",
  line: "#232b33",
  lineStrong: "#36414c",
  ink: "#e6edf3",
  muted: "#8b98a5",
  safe: "#3ddc97",
  blocked: "#ff5c5c",
  pending: "#ffb020",
};

export const EASE = Easing.bezier(0.16, 1, 0.3, 1);
export const EASE_IO = Easing.bezier(0.65, 0, 0.35, 1);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Near-black background with the console's faint grid. */
export const Backdrop: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill
    style={{
      backgroundColor: C.bg,
      backgroundImage: `linear-gradient(${C.line}55 1px, transparent 1px), linear-gradient(90deg, ${C.line}55 1px, transparent 1px)`,
      backgroundSize: "48px 48px",
    }}
  >
    {children}
  </AbsoluteFill>
);

export type CamKey = { t: number; x: number; y: number; z: number };

/**
 * Zoom and pan over 1920x1080 footage. Each key centers source point (x, y) at zoom z, at t seconds
 * into the parent sequence. Edges are clamped so the frame never shows past the footage.
 */
export const Camera: React.FC<{ keys: CamKey[]; children: React.ReactNode }> = ({ keys, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const at = (pick: (k: CamKey) => number) =>
    keys.length === 1
      ? pick(keys[0])
      : interpolate(frame, keys.map((k) => k.t * fps), keys.map(pick), { ...clamp, easing: EASE_IO });
  const z = at((k) => k.z);
  const tx = Math.min(0, Math.max(1920 - 1920 * z, 960 - at((k) => k.x) * z));
  const ty = Math.min(0, Math.max(1080 - 1080 * z, 540 - at((k) => k.y) * z));
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill style={{ transformOrigin: "0 0", translate: `${tx}px ${ty}px`, scale: z }}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
};

/** Fades its children in at `from` and out at `to` (seconds), with a small rise. */
export const Appear: React.FC<{ from: number; to?: number; children: React.ReactNode; style?: React.CSSProperties; rise?: number }> = ({
  from,
  to = 1e6,
  children,
  style,
  rise = 16,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const inP = interpolate(frame, [from * fps, from * fps + 0.45 * fps], [0, 1], { ...clamp, easing: EASE });
  const outP = interpolate(frame, [to * fps - 0.3 * fps, to * fps], [1, 0], clamp);
  return (
    <div style={{ ...style, opacity: Math.min(inP, outP), translate: `0px ${(1 - inP) * rise}px` }}>{children}</div>
  );
};

/** A key fact, bottom left, with a colored bar. */
export const LowerThird: React.FC<{ from: number; to: number; kicker: string; text: string; color?: string }> = ({
  from,
  to,
  kicker,
  text,
  color = C.safe,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const bar = interpolate(frame, [from * fps, from * fps + 0.5 * fps], [0, 1], { ...clamp, easing: EASE });
  return (
    <Appear from={from} to={to} style={{ position: "absolute", left: 72, bottom: 190, maxWidth: 980 }}>
      <div
        style={{
          display: "flex",
          background: "rgba(11,14,17,0.92)",
          border: `1px solid ${C.lineStrong}`,
          boxShadow: "0 18px 50px rgba(0,0,0,0.55)",
        }}
      >
        <div style={{ width: 6, background: color, scale: `1 ${bar}`, transformOrigin: "top" }} />
        <div style={{ padding: "18px 26px 20px" }}>
          <div style={{ fontFamily: MONO, fontSize: 19, letterSpacing: 3, color, textTransform: "uppercase" }}>{kicker}</div>
          <div style={{ fontFamily: SANS, fontSize: 36, fontWeight: 600, color: C.ink, marginTop: 6, lineHeight: 1.2 }}>{text}</div>
        </div>
      </div>
    </Appear>
  );
};

/** Small mono chip, top right, e.g. a speed-up factor. */
export const Chip: React.FC<{ text: string; color?: string; from?: number }> = ({ text, color = C.muted, from = 0 }) => (
  <Appear from={from} style={{ position: "absolute", right: 56, top: 44 }} rise={0}>
    <div
      style={{
        fontFamily: MONO,
        fontSize: 22,
        letterSpacing: 2,
        color,
        border: `1px solid ${C.lineStrong}`,
        background: "rgba(11,14,17,0.85)",
        padding: "8px 16px",
      }}
    >
      {text}
    </div>
  </Appear>
);

/**
 * Burned-in subtitles of the voiceover. Adapted from Remotion's Basic Captions element: same paging
 * through createTikTokStyleCaptions, restyled for the console.
 */
export const Subtitles: React.FC<{ captions: Caption[] }> = ({ captions }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pages = useMemo(
    () => createTikTokStyleCaptions({ captions, combineTokensWithinMilliseconds: 2600 }).pages,
    [captions]
  );
  const ms = (frame / fps) * 1000;
  const page = pages.find((p) => ms >= p.startMs && ms < p.startMs + p.durationMs);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 42, display: "flex", justifyContent: "center" }}>
      {page ? (
        <div
          style={{
            maxWidth: 1460,
            background: "rgba(11,14,17,0.86)",
            border: `1px solid ${C.line}`,
            color: C.ink,
            fontFamily: SANS,
            fontSize: 38,
            fontWeight: 500,
            lineHeight: 1.3,
            padding: "12px 26px",
            textAlign: "center",
            textWrap: "balance",
            whiteSpace: "pre-wrap",
          }}
        >
          {page.text.trim()}
        </div>
      ) : null}
    </div>
  );
};

export type TermLine = { t: number; line: string };

const lineColor = (l: string) => {
  if (/deny|Refused|NotAllowlisted|ATTACKER|BLOCKED|failing|Attacker balance/.test(l)) return C.blocked;
  if (/HIGH: pending|review approve|Guard review/.test(l)) return C.pending;
  if (/LOW: paid|MEDIUM: paid|guard approve|Outcome matches|✔|passing/.test(l)) return C.safe;
  if (/^===|^\s{0,4}[A-Z][\w :]+$/.test(l)) return C.ink;
  return C.muted;
};

/** A terminal window replaying real, timestamped output up to source time `now`. */
export const Terminal: React.FC<{
  title: string;
  lines: TermLine[];
  now: number;
  width: number;
  height: number;
  fontSize?: number;
  highlight?: RegExp;
  highlightFrom?: number;
}> = ({ title, lines, now, width, height, fontSize = 20, highlight, highlightFrom = 1e9 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const charW = fontSize * 0.6;
  const cols = Math.floor((width - 48) / charW);
  const lineH = fontSize * 1.45;
  const maxRows = Math.floor((height - 64) / lineH);
  const shown = lines.filter((l) => l.t <= now);
  // Tail that fits, counting wrapped rows.
  const tail: TermLine[] = [];
  let rows = 0;
  for (let i = shown.length - 1; i >= 0; i--) {
    const r = Math.max(1, Math.ceil(shown[i].line.length / cols));
    if (rows + r > maxRows) break;
    rows += r;
    tail.unshift(shown[i]);
  }
  const pulse = 0.55 + 0.45 * Math.sin(((frame - highlightFrom * fps) / fps) * Math.PI * 2);
  return (
    <div
      style={{
        width,
        height,
        background: "#07090b",
        border: `1px solid ${C.lineStrong}`,
        boxShadow: "0 30px 80px rgba(0,0,0,0.6)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div style={{ height: 44, display: "flex", alignItems: "center", gap: 10, padding: "0 18px", borderBottom: `1px solid ${C.line}`, background: C.surface }}>
        {[C.blocked, C.pending, C.safe].map((c) => (
          <div key={c} style={{ width: 12, height: 12, borderRadius: 6, background: c, opacity: 0.8 }} />
        ))}
        <div style={{ fontFamily: MONO, fontSize: 18, color: C.muted, marginLeft: 12 }}>{title}</div>
      </div>
      <div style={{ padding: "12px 24px", fontFamily: MONO, fontSize, lineHeight: `${lineH}px` }}>
        {tail.map((l, i) => {
          const hl = highlight && highlight.test(l.line) && frame >= highlightFrom * fps;
          return (
            <div
              key={`${l.t}-${i}`}
              style={{
                color: lineColor(l.line),
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
                fontWeight: hl ? 600 : 400,
                background: hl ? `rgba(255,92,92,${0.12 + 0.12 * pulse})` : undefined,
                outline: hl ? `2px solid rgba(255,92,92,${0.5 + 0.5 * pulse})` : undefined,
                outlineOffset: 2,
              }}
            >
              {l.line || " "}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** A phone bezel around a 390x844 recording. */
export const Phone: React.FC<{ height: number; children: React.ReactNode }> = ({ height, children }) => {
  const width = Math.round((height * 390) / 844);
  return (
    <div
      style={{
        width: width + 28,
        height: height + 28,
        borderRadius: 54,
        background: "#1a2128",
        border: `2px solid ${C.lineStrong}`,
        padding: 14,
        boxShadow: "0 40px 90px rgba(0,0,0,0.7)",
      }}
    >
      <div style={{ width, height, borderRadius: 40, overflow: "hidden", position: "relative", background: C.bg }}>{children}</div>
    </div>
  );
};

/** Source-pixel crop of 1920x1080 footage into a box. */
export const Crop: React.FC<{ x: number; y: number; w: number; h: number; scale: number; children: React.ReactNode; style?: React.CSSProperties }> = ({
  x,
  y,
  w,
  h,
  scale,
  children,
  style,
}) => (
  <div style={{ width: w * scale, height: h * scale, overflow: "hidden", position: "relative", ...style }}>
    <div style={{ position: "absolute", width: 1920, height: 1080, transformOrigin: "0 0", scale, translate: `${-x * scale}px ${-y * scale}px` }}>
      {children}
    </div>
  </div>
);
