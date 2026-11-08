// node --env-file=~/projects/leash/.env tts.mjs <narration.json> <outdir>
// One gpt-4o-mini-tts file per scene, then whisper-1 word timestamps for subtitles. Never logs the key.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const [, , narrationPath, outDir] = process.argv;
const key = process.env.OPENAI_API_KEY;
if (!key) throw new Error("OPENAI_API_KEY is not set");
mkdirSync(outDir, { recursive: true });
const scenes = JSON.parse(readFileSync(narrationPath, "utf8"));
const only = process.env.ONLY?.split(",");

const INSTRUCTIONS =
  "Voice: a calm, clear, confident engineer giving a product demo to judges. Natural conversational pace, " +
  "slightly measured. Plain and sincere, no salesy energy, no hype. Short natural pauses between sentences. " +
  "Pronounce 'onchain' as 'on-chain', 'dUSDC' never appears, 'Leash' like the dog leash, 'GPT' as letters.";

for (const s of scenes) {
  if (only && !only.includes(s.id)) continue;
  const mp3 = `${outDir}/${s.id}.mp3`;
  if (!existsSync(mp3) || only) {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: process.env.VOICE || "marin",
        input: s.text,
        instructions: INSTRUCTIONS,
        response_format: "mp3",
      }),
    });
    if (!res.ok) throw new Error(`speech ${s.id}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    writeFileSync(mp3, Buffer.from(await res.arrayBuffer()));
  }
  const form = new FormData();
  form.append("file", new Blob([readFileSync(mp3)], { type: "audio/mpeg" }), `${s.id}.mp3`);
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  form.append("prompt", s.text);
  const tr = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}` },
    body: form,
  });
  if (!tr.ok) throw new Error(`transcribe ${s.id}: HTTP ${tr.status} ${(await tr.text()).slice(0, 200)}`);
  const j = await tr.json();
  writeFileSync(`${outDir}/${s.id}.words.json`, JSON.stringify({ duration: j.duration, words: j.words }, null, 1));
  console.log(`${s.id}: ${j.duration.toFixed(2)}s, ${j.words.length} words`);
}
