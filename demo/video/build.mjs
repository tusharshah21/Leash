// node demo/video/build.mjs [out/marks.json] [leash-draft.mp4]. Cuts the recorded segments, speeds up
// the ones marked faster, and joins them into one H.264 file at 1440x900, 30 fps, no audio.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const marksPath = resolve(process.argv[2] || "demo/video/out/marks.json");
const output = resolve(process.argv[3] || "demo/video/leash-draft.mp4");
// Each segment names its own video (one per scene). Older marks files had one video for all.
const { video, segments } = JSON.parse(readFileSync(marksPath, "utf8"));
const work = join(dirname(marksPath), "segments");
mkdirSync(work, { recursive: true });

const ffmpeg = (args) =>
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: "inherit" });
const ENCODE = [
  "-c:v",
  "libx264",
  "-preset",
  "veryfast",
  "-crf",
  "18",
  "-pix_fmt",
  "yuv420p",
  "-an",
];

const parts = segments.map((s, i) => {
  const file = join(work, `${String(i).padStart(2, "0")}-${s.name}.mp4`);
  const length = (s.out - s.in) / s.speed;
  // The recorder only writes a frame when the page repaints, so a still stretch can come up short.
  // Cloning the last frame pads every segment to the length it was meant to have.
  ffmpeg([
    "-ss",
    s.in.toFixed(3),
    "-to",
    s.out.toFixed(3),
    "-i",
    s.video ?? video,
    "-vf",
    `setpts=(PTS-STARTPTS)/${
      s.speed
    },fps=30,scale=1440:900:flags=lanczos,tpad=stop_mode=clone:stop_duration=${length.toFixed(3)}`,
    "-t",
    length.toFixed(3),
    ...ENCODE,
    file,
  ]);
  console.log(`${s.name.padEnd(14)} ${((s.out - s.in) / s.speed).toFixed(1)}s`);
  return file;
});

const list = join(work, "list.txt");
writeFileSync(list, parts.map((p) => `file '${p.replace(/\\/g, "/")}'`).join("\n") + "\n");
ffmpeg(["-f", "concat", "-safe", "0", "-i", list, ...ENCODE, "-movflags", "+faststart", output]);
const total = segments.reduce((sum, s) => sum + (s.out - s.in) / s.speed, 0);
console.log(`${output}: ${total.toFixed(1)}s`);
