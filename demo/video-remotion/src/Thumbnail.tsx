import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { Backdrop, C, MONO, SANS } from "./components";

/** 1280x720 thumbnail: the promise on the left, the real attacker card on the right. */
export const Thumbnail: React.FC = () => (
  <Backdrop>
    <AbsoluteFill style={{ padding: "70px 64px", flexDirection: "row", alignItems: "center", gap: 48 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: MONO, fontSize: 22, letterSpacing: 5, color: C.safe }}>ONCHAIN FIREWALL FOR AI AGENTS</div>
        <div style={{ fontFamily: SANS, fontSize: 70, fontWeight: 700, color: C.ink, lineHeight: 1.05, marginTop: 22 }}>
          The agent can be fooled.
        </div>
        <div style={{ fontFamily: SANS, fontSize: 70, fontWeight: 700, color: C.safe, lineHeight: 1.05, marginTop: 8 }}>
          The money can't.
        </div>
        <div style={{ fontFamily: MONO, fontSize: 48, fontWeight: 600, letterSpacing: 10, color: C.ink, marginTop: 44 }}>LEASH</div>
        <div style={{ fontFamily: MONO, fontSize: 20, color: C.muted, marginTop: 8 }}>Built on Solana</div>
      </div>
      <Img
        src={staticFile("thumb-card.png")}
        style={{ width: 470, border: `2px solid ${C.blocked}`, boxShadow: `0 0 70px ${C.blocked}44`, rotate: "2deg" }}
      />
    </AbsoluteFill>
  </Backdrop>
);
