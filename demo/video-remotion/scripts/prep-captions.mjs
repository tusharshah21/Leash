// Builds src/data/vo.json: per scene, the voice duration and Caption[] in the narration's own words
// (with punctuation), timed by aligning character offsets to whisper's word timestamps.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const root = new URL("..", import.meta.url);
const scenes = JSON.parse(readFileSync(new URL("narration.json", root), "utf8"));
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const out = {};
for (const s of scenes) {
  const mp3 = new URL(`public/vo/${s.id}.mp3`, root);
  const dur = Number(
    execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp3.pathname.replace(/^\/([A-Z]:)/, "$1")])
      .toString()
      .trim()
  );
  const { words } = JSON.parse(readFileSync(new URL(`public/vo/${s.id}.words.json`, root), "utf8"));
  // Cumulative normalized character offsets on both sides.
  const wOff = [];
  let wTotal = 0;
  for (const w of words) {
    wOff.push(wTotal);
    wTotal += norm(w.word).length || 1;
  }
  const tokens = s.text.split(/\s+/).filter(Boolean);
  const tOff = [];
  let tTotal = 0;
  for (const t of tokens) {
    tOff.push(tTotal);
    tTotal += norm(t).length || 1;
  }
  const timeAt = (frac) => {
    const target = frac * wTotal;
    let i = 0;
    while (i + 1 < words.length && wOff[i + 1] <= target) i++;
    const w = words[i];
    const span = (norm(w.word).length || 1);
    const within = Math.min(1, Math.max(0, (target - wOff[i]) / span));
    return w.start + (w.end - w.start) * within;
  };
  const captions = tokens.map((t, i) => {
    const start = timeAt(tOff[i] / tTotal);
    const end = i + 1 < tokens.length ? timeAt(tOff[i + 1] / tTotal) : words.at(-1).end;
    return {
      text: (i === 0 ? "" : " ") + t,
      startMs: Math.round(start * 1000),
      endMs: Math.round(Math.max(end, start + 0.05) * 1000),
      timestampMs: Math.round(start * 1000),
      confidence: null,
      ...(/[.?!:]$/.test(t) ? { pageBreakAfter: true } : {}),
    };
  });
  out[s.id] = { durationMs: Math.round(dur * 1000), captions };
  console.log(s.id.padEnd(7), dur.toFixed(2), tokens.length, "tokens /", words.length, "words");
}
writeFileSync(new URL("src/data/vo.json", root), JSON.stringify(out, null, 1));
