// The image a Blink shows. Satori lays this out, so every element with children needs display flex,
// and colors are literal because there is no stylesheet here.
import { ImageResponse } from "next/og";

const SIZE = 800;
const COLOR = {
  bg: "#0B0E11",
  line: "#232B33",
  ink: "#E6EDF3",
  muted: "#8B98A5",
  safe: "#3DDC97",
  blocked: "#FF5C5C",
  pending: "#FFB020",
};

export interface CardProps {
  /** The short line across the top, such as NOT ON ALLOWLIST. */
  banner: string;
  tone: keyof Pick<typeof COLOR, "safe" | "blocked" | "pending" | "muted">;
  headline: string;
  unit?: string;
  lines: string[];
}

export function actionCard({ banner, tone, headline, unit, lines }: CardProps) {
  return new ImageResponse(
    (
      <div
        style={{
          width: SIZE,
          height: SIZE,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 56,
          background: COLOR.bg,
          color: COLOR.ink,
          border: `12px solid ${COLOR[tone]}`,
        }}
      >
        <div style={{ display: "flex", color: COLOR[tone], fontSize: 44, fontWeight: 700 }}>
          {banner}
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "baseline" }}>
            <div style={{ display: "flex", fontSize: 128, fontWeight: 700, lineHeight: 1.05 }}>
              {headline}
            </div>
            {unit && (
              <div style={{ display: "flex", marginLeft: 20, fontSize: 40, color: COLOR.muted }}>
                {unit}
              </div>
            )}
          </div>
          {lines.map((line) => (
            <div key={line} style={{ display: "flex", marginTop: 16, fontSize: 38 }}>
              {line}
            </div>
          ))}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            paddingTop: 24,
            borderTop: `2px solid ${COLOR.line}`,
            color: COLOR.muted,
            fontSize: 30,
          }}
        >
          <div style={{ display: "flex" }}>LEASH</div>
          <div style={{ display: "flex" }}>Devnet</div>
        </div>
      </div>
    ),
    {
      width: SIZE,
      height: SIZE,
      headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=30" },
    }
  );
}
