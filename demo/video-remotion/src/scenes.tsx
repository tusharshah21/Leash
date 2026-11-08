// The ten scenes of the Leash demo. Footage is real: the live site and real terminal output.
import { Audio, Video } from "@remotion/media";
import React from "react";
import { AbsoluteFill, Freeze, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import {
  Appear, Backdrop, C, Camera, Chip, Crop, EASE, LowerThird, MONO, Phone, SANS, Subtitles, Terminal, type TermLine,
} from "./components";
import runTerm from "./data/run-terminal.json";
import testsTerm from "./data/tests-terminal.json";
import vo from "./data/vo.json";

type VoId = keyof typeof vo;
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** One voiceover file and its subtitles, starting `at` seconds into the scene. */
const Voice: React.FC<{ id: VoId; at: number }> = ({ id, at }) => {
  const { fps } = useVideoConfig();
  return (
    <Sequence name={`Voice: ${id}`} from={Math.round(at * fps)}>
      <Audio src={staticFile(`vo/${id}.mp3`)} />
      <Subtitles captions={vo[id].captions} />
    </Sequence>
  );
};

const Clip: React.FC<{ name: string; from: number; rate?: number }> = ({ name, from, rate = 1 }) => {
  const { fps } = useVideoConfig();
  return (
    <Video
      src={staticFile(`clips/${name}.mp4`)}
      trimBefore={Math.round(from * fps)}
      playbackRate={rate}
      style={{ width: 1920, height: 1080 }}
    />
  );
};

const explorer = (l: string) =>
  l.replace(/https:\/\/explorer\.solana\.com\/tx\/(\w{6})\w+\?cluster=devnet/g, "explorer/tx/$1...").replace(/\*\*/g, "");

const RUN_LINES: TermLine[] = runTerm.lines
  .filter((l) => !/bigint|sudo|^> |OUTCOME \{|^\s*$|^#+ |^If you need/.test(l.line))
  .map((l) => ({ t: l.t, line: explorer(l.line) }));

const firstTick = testsTerm.lines.find((l) => l.line.includes("✔"))?.t ?? 0;
const TEST_LINES: TermLine[] = testsTerm.lines
  .filter((l) => l.t >= firstTick - 1 && !/bigint|Warning|To eliminate|Running|^\s+[\w ()]+: \d+$|^\s*$|node:/.test(l.line))
  .map((l) => ({ t: l.t, line: l.line.replace(/^ {2}/, "") }));

/* 1. Title, then the landing page's attack replay. */
export const Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const titleOut = interpolate(frame, [3.7 * fps, 4.3 * fps], [1, 0], clamp);
  const draw = interpolate(frame, [0.4 * fps, 1.6 * fps], [0, 1], { ...clamp, easing: EASE });
  return (
    <AbsoluteFill>
      <Sequence name="Landing" from={Math.round(3.7 * fps)}>
        <Camera keys={[{ t: 0, x: 960, y: 540, z: 1 }, { t: 3.4, x: 960, y: 540, z: 1 }, { t: 6, x: 1394, y: 420, z: 1.5 }]}>
          <Clip name="landing" from={1.4} />
        </Camera>
      </Sequence>
      <AbsoluteFill style={{ opacity: titleOut }}>
        <Backdrop>
          <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
            <Appear from={0.2}>
              <div style={{ fontFamily: MONO, fontSize: 22, letterSpacing: 6, color: C.safe }}>MLH SOLANA HACKATHON  ·  DEVNET</div>
            </Appear>
            <Appear from={0.35} rise={30}>
              <div style={{ fontFamily: MONO, fontSize: 168, fontWeight: 600, letterSpacing: 18, color: C.ink, marginTop: 18 }}>LEASH</div>
            </Appear>
            <svg width={760} height={20} style={{ marginTop: 6 }}>
              <line x1={0} y1={10} x2={760 * draw} y2={10} stroke={C.safe} strokeWidth={4} />
              <circle cx={760 * draw} cy={10} r={8} fill={C.safe} opacity={draw > 0.02 ? 1 : 0} />
            </svg>
            <Appear from={1.2}>
              <div style={{ fontFamily: SANS, fontSize: 46, color: C.muted, marginTop: 26 }}>An onchain firewall for AI agents</div>
            </Appear>
          </AbsoluteFill>
        </Backdrop>
      </AbsoluteFill>
      <Voice id="hook" at={1.2} />
    </AbsoluteFill>
  );
};

/* 2. The three layers, built piece by piece on the narration's cues. */
const TIERS = [
  { at: 8.4, name: "LOW", color: C.safe, title: "Mandate", rule: "Small, to a listed vendor", path: "Executes. Agent signs alone." },
  { at: 11.2, name: "MEDIUM", color: C.pending, title: "Guard co-sign", rule: "Up to the per-payment limit", path: "Needs the guard's signature." },
  { at: 16.2, name: "HIGH", color: C.blocked, title: "You decide", rule: "Larger, or not on the list", path: "Waits onchain for the owner." },
];

const Node: React.FC<{ label: string; sub: string; color: string; children?: React.ReactNode }> = ({ label, sub, color, children }) => (
  <div style={{ width: 520, padding: "26px 30px", background: C.surface, border: `1px solid ${C.lineStrong}`, borderTop: `4px solid ${color}` }}>
    <div style={{ fontFamily: MONO, fontSize: 20, letterSpacing: 3, color }}>{label}</div>
    <div style={{ fontFamily: SANS, fontSize: 34, fontWeight: 600, color: C.ink, marginTop: 8 }}>{sub}</div>
    {children}
  </div>
);

export const Layers: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = frame / fps;
  const arrow = interpolate(frame, [2.2 * fps, 3.6 * fps], [0, 1], { ...clamp, easing: EASE });
  // A payment token travels from the agent to the program, then down to the tier being described.
  const active = [...TIERS].reverse().find((t) => s >= t.at - 0.6);
  const tierX = (i: number) => 230 + i * 500 + 230;
  return (
    <Backdrop>
      <Appear from={0.3} style={{ position: "absolute", left: 140, top: 110 }}>
        <Node label="AI AGENT" sub="Holds only its own key" color={C.muted}>
          <div style={{ fontFamily: SANS, fontSize: 24, color: C.muted, marginTop: 10 }}>Can ask to pay. Cannot move funds.</div>
        </Node>
      </Appear>
      <svg width={1920} height={1080} style={{ position: "absolute" }}>
        <line x1={690} y1={200} x2={690 + 550 * arrow} y2={200} stroke={C.lineStrong} strokeWidth={3} strokeDasharray="10 8" />
        {arrow > 0.98 ? <polygon points="1240,190 1258,200 1240,210" fill={C.lineStrong} /> : null}
        {TIERS.map((t, i) => {
          const p = interpolate(frame, [(5.2 + i * 0.25) * fps, (6.2 + i * 0.25) * fps], [0, 1], { ...clamp, easing: EASE });
          return <line key={t.name} x1={1500} y1={300} x2={1500 + (tierX(i) - 1500) * p} y2={300 + 160 * p} stroke={C.line} strokeWidth={2} />;
        })}
      </svg>
      <Appear from={1.6} style={{ position: "absolute", left: 1262, top: 110 }}>
        <Node label="SOLANA PROGRAM" sub="Vault holds the funds" color={C.safe}>
          <div style={{ fontFamily: SANS, fontSize: 24, color: C.muted, marginTop: 10 }}>Checks every payment against your mandate.</div>
        </Node>
      </Appear>
      <Appear from={5.0} style={{ position: "absolute", left: 230, top: 400, fontFamily: MONO, fontSize: 22, letterSpacing: 4, color: C.muted }}>
        EVERY PAYMENT PASSES THREE LAYERS
      </Appear>
      {TIERS.map((t, i) => {
        const lit = interpolate(frame, [(t.at - 0.2) * fps, (t.at + 0.4) * fps], [0, 1], clamp);
        return (
          <Appear key={t.name} from={5.3 + i * 0.25} style={{ position: "absolute", left: 230 + i * 500, top: 460 }}>
            <div
              style={{
                width: 460,
                height: 300,
                padding: "28px 30px",
                background: C.surface,
                border: `1px solid ${lit > 0.5 ? t.color : C.lineStrong}`,
                boxShadow: `0 0 ${60 * lit}px ${t.color}33`,
                opacity: 0.45 + 0.55 * lit,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", fontFamily: MONO, fontSize: 20, letterSpacing: 3 }}>
                <span style={{ color: C.muted }}>LAYER {i + 1}</span>
                <span style={{ color: t.color }}>{t.name}</span>
              </div>
              <div style={{ fontFamily: SANS, fontSize: 40, fontWeight: 600, color: C.ink, marginTop: 22 }}>{t.title}</div>
              <div style={{ fontFamily: SANS, fontSize: 26, color: C.muted, marginTop: 12 }}>{t.rule}</div>
              <div style={{ fontFamily: MONO, fontSize: 22, color: t.color, marginTop: 34 }}>{t.path}</div>
            </div>
          </Appear>
        );
      })}
      {active ? (
        <div
          style={{
            position: "absolute",
            width: 22,
            height: 22,
            borderRadius: 11,
            background: active.color,
            boxShadow: `0 0 24px ${active.color}`,
            left: interpolate(frame, [(active.at - 0.6) * fps, active.at * fps], [1500, tierX(TIERS.indexOf(active))], { ...clamp, easing: EASE }) - 11,
            top: interpolate(frame, [(active.at - 0.6) * fps, active.at * fps], [300, 452], { ...clamp, easing: EASE }) - 11,
          }}
        />
      ) : null}
      <Appear from={19.4} style={{ position: "absolute", left: 230, top: 800, fontFamily: MONO, fontSize: 24, color: C.ink }}>
        The program enforces all three. No offchain service can override it.
      </Appear>
      <Voice id="layers" at={0.8} />
    </Backdrop>
  );
};

/* 3. Creating the vault on the live site, one signature. */
export const Setup: React.FC = () => (
  <AbsoluteFill style={{ background: C.bg }}>
    <Camera keys={[{ t: 0, x: 960, y: 470, z: 1.3 }, { t: 7.6, x: 960, y: 470, z: 1.3 }, { t: 8.6, x: 960, y: 540, z: 1 }]}>
      <Clip name="create" from={1.2} rate={2.4} />
    </Camera>
    <Chip text="2.4x" />
    <LowerThird from={2.4} to={9.6} kicker="One signature" text="Vault, mandate, 3 vendors and 2,000 dUSDC, atomically" />
    <Voice id="setup" at={0.6} />
  </AbsoluteFill>
);

/* 4. The live run: real terminal output beside the live console, same clock. */
const RUN_FROM = 2.5;
const RUN_RATE = 4.8;
const RUN_FOR = 22;
export const Run: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const src = RUN_FROM + Math.min(frame / fps, RUN_FOR) * RUN_RATE;
  return (
    <Backdrop>
      <div style={{ position: "absolute", left: 40, top: 46, fontFamily: MONO, fontSize: 20, letterSpacing: 3, color: C.muted }}>
        AGENT  ·  pnpm demo:run
      </div>
      <div style={{ position: "absolute", left: 880, top: 46, fontFamily: MONO, fontSize: 20, letterSpacing: 3, color: C.muted }}>
        LIVE CONSOLE  ·  leash-ruddy.vercel.app
      </div>
      <div style={{ position: "absolute", left: 40, top: 86 }}>
        <Terminal
          title="leash: pnpm demo:run --vault HTzY...JqBH"
          lines={RUN_LINES}
          now={src}
          width={810}
          height={800}
          fontSize={19}
          highlight={/Attacker balance/}
          highlightFrom={RUN_FOR + 0.3}
        />
      </div>
      <div style={{ position: "absolute", left: 880, top: 86, border: `1px solid ${C.lineStrong}`, boxShadow: "0 30px 80px rgba(0,0,0,0.6)" }}>
        <Crop x={510} y={60} w={1230} h={966} scale={0.8275}>
          <Freeze frame={Math.round(RUN_FOR * fps)} active={(f) => f >= RUN_FOR * fps}>
            <Clip name="run" from={RUN_FROM} rate={RUN_RATE} />
          </Freeze>
        </Crop>
      </div>
      <Chip text={`${RUN_RATE}x`} />
      <LowerThird from={RUN_FOR + 0.2} to={25} kicker="Result" text="Attacker balance: 0 before, 0 after" color={C.blocked} />
      <Voice id="run" at={0.6} />
    </Backdrop>
  );
};

/* 5. The attacker's card: a proposal that cannot execute. */
export const Card: React.FC = () => {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Camera
        keys={[
          { t: 0, x: 960, y: 540, z: 1 },
          { t: 1.6, x: 790, y: 560, z: 1.75 },
          { t: 10.8, x: 790, y: 560, z: 1.75 },
          { t: 12.2, x: 800, y: 700, z: 2.05 },
          { t: 18, x: 800, y: 700, z: 2.05 },
        ]}
      >
        <Freeze frame={Math.round(7.6 * fps)} active={(f) => f >= 7.6 * fps}>
          <Clip name="why" from={0} />
        </Freeze>
      </Camera>
      <LowerThird from={5.4} to={11.2} kicker="Onchain rule" text="Not on the allowlist: it can only wait as a proposal" color={C.blocked} />
      <LowerThird from={12.4} to={17.6} kicker="Guard review" text="Advisory only. The chain is the limit." color={C.pending} />
      <Voice id="card" at={0.6} />
    </AbsoluteFill>
  );
};

/* 6. Why: verified reasoning, the guard's refusal, the chain's refusal. */
export const Why: React.FC = () => {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Sequence name="Verified reasoning" durationInFrames={Math.round(8 * fps)}>
        <Camera keys={[{ t: 0, x: 1400, y: 560, z: 1.3 }, { t: 1.3, x: 1400, y: 640, z: 1.95 }]}>
          <Clip name="why" from={7.6} rate={1.1} />
        </Camera>
        <LowerThird from={1.4} to={7.8} kicker="Verified" text="sha256 of the reasoning matches the hash onchain" />
      </Sequence>
      <Sequence name="Guard refusal" from={Math.round(8 * fps)} durationInFrames={Math.round(7.4 * fps)}>
        <Camera keys={[{ t: 0, x: 1400, y: 560, z: 1.4 }, { t: 1.2, x: 1400, y: 690, z: 1.95 }]}>
          <Clip name="why190" from={0.8} rate={1.2} />
        </Camera>
        <LowerThird from={1.3} to={7.2} kicker="Guard" text="Refused to co-sign: 190 asked, the task said 60" color={C.pending} />
      </Sequence>
      <Sequence name="Chain refusal" from={Math.round(15.4 * fps)}>
        <Camera keys={[{ t: 0, x: 1400, y: 420, z: 1.4 }, { t: 1, x: 1400, y: 470, z: 1.9 }]}>
          <Clip name="why" from={25} rate={1.4} />
        </Camera>
        <LowerThird from={1.0} to={5.6} kicker="Chain" text="Direct call with the agent key: NotAllowlisted" color={C.blocked} />
      </Sequence>
      <Voice id="why" at={0.8} />
    </AbsoluteFill>
  );
};

/* 7. Deciding from a phone: the QR, then the Blink rejecting and approving. */
export const PhoneScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const qrOut = interpolate(frame, [5 * fps, 5.6 * fps], [1, 0], clamp);
  return (
    <Backdrop>
      <Sequence name="QR" durationInFrames={Math.round(5.6 * fps)}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", opacity: qrOut }}>
          <Appear from={0.2}>
            <div style={{ fontFamily: MONO, fontSize: 22, letterSpacing: 4, color: C.muted, textAlign: "center" }}>APPROVE FROM PHONE</div>
          </Appear>
          <Appear from={0.3} rise={24} style={{ marginTop: 24, border: `1px solid ${C.lineStrong}`, padding: 18, background: C.surface }}>
            <Crop x={792} y={458} w={336} h={276} scale={1.9}>
              <Freeze frame={Math.round(36.2 * fps)}>
                <Clip name="why" from={0} />
              </Freeze>
            </Crop>
          </Appear>
          <Appear from={0.8}>
            <div style={{ fontFamily: SANS, fontSize: 32, color: C.ink, marginTop: 26 }}>Each pending payment opens as a Blink</div>
          </Appear>
        </AbsoluteFill>
      </Sequence>
      <Sequence name="Phones" from={Math.round(5 * fps)} durationInFrames={Math.round(11 * fps)}>
        <AbsoluteFill style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 160 }}>
          {[
            { name: "blink-reject", label: "REJECT  ·  attacker, 150", color: C.blocked, delay: 0 },
            { name: "blink-approve", label: "APPROVE  ·  DataLabs, 340", color: C.safe, delay: 1.5 },
          ].map((p) => (
            <Appear key={p.name} from={p.delay} rise={40} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{ fontFamily: MONO, fontSize: 22, letterSpacing: 3, color: p.color, marginBottom: 18 }}>{p.label}</div>
              <Phone height={760}>
                <Sequence from={Math.round(p.delay * fps)}>
                  <Video src={staticFile(`clips/${p.name}.mp4`)} trimBefore={Math.round(1 * fps)} style={{ width: "100%", height: "100%" }} />
                </Sequence>
              </Phone>
            </Appear>
          ))}
        </AbsoluteFill>
      </Sequence>
      <Sequence name="Console updated" from={Math.round(15.6 * fps)}>
        <Camera keys={[{ t: 0, x: 1400, y: 360, z: 1.5 }, { t: 1, x: 1400, y: 380, z: 1.85 }]}>
          <Clip name="after" from={0.3} />
        </Camera>
        <LowerThird from={0.6} to={3.9} kicker="Onchain" text="Rejected and paid, both signed by the owner" />
      </Sequence>
      <Voice id="phone" at={0.6} />
    </Backdrop>
  );
};

/* 8. The kill switch. */
export const Kill: React.FC = () => (
  <AbsoluteFill style={{ background: C.bg }}>
    <Camera
      keys={[
        { t: 0, x: 450, y: 780, z: 1.5 },
        { t: 1.6, x: 450, y: 780, z: 1.5 },
        { t: 2.2, x: 960, y: 540, z: 1 },
        { t: 5.7, x: 960, y: 540, z: 1 },
        { t: 6.7, x: 520, y: 220, z: 1.9 },
      ]}
    >
      <Clip name="after" from={7.0} rate={1.3} />
    </Camera>
    <LowerThird from={7.0} to={9} kicker="Kill switch" text="Agent revoked onchain. Vault paused." color={C.blocked} />
    <Voice id="kill" at={0.6} />
  </AbsoluteFill>
);

/* 9. Proof: the real test run. */
const TEST_FROM = firstTick - 0.5;
const TEST_RATE = 7;
export const Proof: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const src = TEST_FROM + (frame / fps) * TEST_RATE;
  return (
    <Backdrop>
      <div style={{ position: "absolute", left: 160, top: 70 }}>
        <Terminal title="leash: pnpm test:fast" lines={TEST_LINES} now={src} width={1600} height={720} fontSize={24} />
      </div>
      <Chip text={`${TEST_RATE}x`} />
      <LowerThird from={6.4} to={9.6} kicker="Tests" text="97 passing. Each attack asserts the exact error." />
      <LowerThird from={9.9} to={13.4} kicker="README" text="A threat model that says what Leash does not cover" color={C.pending} />
      <Voice id="proof" at={0.6} />
    </Backdrop>
  );
};

/* 10. End card. */
export const Close: React.FC = () => (
  <Backdrop>
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
      <Appear from={0.9}>
        <div style={{ fontFamily: SANS, fontSize: 76, fontWeight: 600, color: C.ink }}>The agent can be fooled.</div>
      </Appear>
      <Appear from={2.2}>
        <div style={{ fontFamily: SANS, fontSize: 76, fontWeight: 600, color: C.safe }}>The money can't.</div>
      </Appear>
      <Appear from={3.6} style={{ marginTop: 70, display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
        <div style={{ fontFamily: MONO, fontSize: 64, fontWeight: 600, letterSpacing: 12, color: C.ink }}>LEASH</div>
        <div style={{ fontFamily: MONO, fontSize: 30, color: C.ink }}>leash-ruddy.vercel.app</div>
        <div style={{ fontFamily: MONO, fontSize: 30, color: C.muted }}>github.com/tusharshah21/Leash</div>
      </Appear>
      <Appear from={4.4} style={{ marginTop: 44 }}>
        <div style={{ fontFamily: MONO, fontSize: 22, letterSpacing: 4, color: C.safe, border: `1px solid ${C.safe}55`, padding: "10px 20px" }}>
          BUILT ON SOLANA  ·  DEVNET
        </div>
      </Appear>
    </AbsoluteFill>
    <Voice id="close" at={1.0} />
  </Backdrop>
);
