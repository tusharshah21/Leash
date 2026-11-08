import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import React from "react";
import { useVideoConfig } from "remotion";
import { Card, Close, Hook, Kill, Layers, PhoneScene, Proof, Run, Setup, Why } from "./scenes";

// Scene lengths are each voiceover plus room to breathe. Total: 4,833 frames minus 9 fades of 12.
const FADE_FRAMES = 12;

export const LeashDemo: React.FC = () => {
  const { fps } = useVideoConfig();
  const fadeT = () => <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: FADE_FRAMES })} />;
  return (
    <TransitionSeries name="Scenes">
      <TransitionSeries.Sequence name="1 Hook" durationInFrames={Math.round(14 * fps)}>
        <Hook />
      </TransitionSeries.Sequence>
      {fadeT()}
      <TransitionSeries.Sequence name="2 Three layers" durationInFrames={Math.round(22.5 * fps)}>
        <Layers />
      </TransitionSeries.Sequence>
      {fadeT()}
      <TransitionSeries.Sequence name="3 Setup" durationInFrames={Math.round(10 * fps)}>
        <Setup />
      </TransitionSeries.Sequence>
      {fadeT()}
      <TransitionSeries.Sequence name="4 Live run" durationInFrames={Math.round(25 * fps)}>
        <Run />
      </TransitionSeries.Sequence>
      {fadeT()}
      <TransitionSeries.Sequence name="5 Attacker card" durationInFrames={Math.round(18 * fps)}>
        <Card />
      </TransitionSeries.Sequence>
      {fadeT()}
      <TransitionSeries.Sequence name="6 Why" durationInFrames={Math.round(20.4 * fps)}>
        <Why />
      </TransitionSeries.Sequence>
      {fadeT()}
      <TransitionSeries.Sequence name="7 Phone" durationInFrames={Math.round(19.6 * fps)}>
        <PhoneScene />
      </TransitionSeries.Sequence>
      {fadeT()}
      <TransitionSeries.Sequence name="8 Kill switch" durationInFrames={Math.round(9 * fps)}>
        <Kill />
      </TransitionSeries.Sequence>
      {fadeT()}
      <TransitionSeries.Sequence name="9 Proof" durationInFrames={Math.round(13.6 * fps)}>
        <Proof />
      </TransitionSeries.Sequence>
      {fadeT()}
      <TransitionSeries.Sequence name="10 Close" durationInFrames={Math.round(9 * fps)}>
        <Close />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  );
};
