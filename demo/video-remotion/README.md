# Leash demo video

The submission video, edited in Remotion from real footage: the live site, recorded with Playwright, and real terminal output from `pnpm demo:run` and `pnpm test:fast`. Renders, clips and voice files are gitignored.

## Pipeline

1. **Capture.** `capture/rec.mjs <phase>` drives Chrome against the live site with an injected Wallet Standard wallet that signs with a burner key (`BURNER_KEY_FILE`), an eased cursor with click ripples, and a CDP screencast recorder. Phases: `create`, `check`, `run`, `post`, `after`, `why190`, `landing`, `tests`. Clips land in `capture/clips/`; copy them to `public/clips/`, and the `*-terminal.json` and `links.json` files to `src/data/`.
2. **Voice.** `scripts/tts.mjs narration.json public/vo`, run with `node --env-file=<repo>/.env`, makes one `gpt-4o-mini-tts` file per scene, then word timestamps from `whisper-1`.
3. **Captions.** `node scripts/prep-captions.mjs` writes `src/data/vo.json`: each scene's duration and captions in the narration's own words.
4. **Render.**

```console
npm i
npx remotion render LeashDemo out/leash-final.mp4 --codec=h264 --x264-preset=veryfast --crf=18
npx remotion still Thumbnail out/leash-thumbnail.png
```

The delivered file also had its audio loudness-normalized: `ffmpeg -i out/leash-final.mp4 -c:v copy -af loudnorm=I=-16:TP=-1.5:LRA=11 -c:a aac -b:a 192k demo/video/leash-final.mp4`.

Rendering a scattered `--frames` list fails in the inline audio mixer, so check frames one at a time with `npx remotion still`.

`src/data/links.json` holds the explorer links for every transaction in the recording.
