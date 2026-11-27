// Adds the caption strip under the recorded page and exports MP4 (H.264) and WebM.
// Usage: node finish-video.mjs <dir with video-draft.webm and captions.json> <output basename>
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const [dir, outBase] = process.argv.slice(2);
const { total, caps } = JSON.parse(readFileSync(`${dir}/captions.json`, "utf8"));
const ts = (s) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return `${h}:${String(m).padStart(2, "0")}:${x.toFixed(2).padStart(5, "0")}`; };
const lines = caps.map((c, i) => {
  const end = i + 1 < caps.length ? caps[i + 1].t : total;
  return `Dialogue: 0,${ts(c.t)},${ts(end)},Cap,,0,0,0,,${c.text.replace(/[{}]/g, "")}`;
});
const ass = `[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Inter,27,&H00FFFFFF,&H00FFFFFF,&H00101010,&H00101010,0,0,0,0,100,100,0,0,1,0,0,2,60,60,24,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${lines.join("\n")}
`;
writeFileSync(`${dir}/captions.ass`, ass);
// SRT too, for YouTube or any player that takes a separate subtitle file.
const srtTs = (s) => ts(s).replace(/^(\d):/, "0$1:").replace(".", ",") + "0";
writeFileSync(`${outBase}.en.srt`, caps.map((c, i) => `${i + 1}\n${srtTs(c.t)} --> ${srtTs(i + 1 < caps.length ? caps[i + 1].t : total)}\n${c.text}\n`).join("\n"));
const vf = `pad=1280:720:0:0:color=0x101010,ass=${dir}/captions.ass`;
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", `${dir}/video-draft.webm`, "-vf", vf, "-r", "30", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-preset", "slow", "-movflags", "+faststart", "-an", `${outBase}.mp4`], { stdio: "inherit" });
console.log(`wrote ${outBase}.mp4 and ${outBase}.en.srt (${caps.length} captions, ${total.toFixed(1)} s)`);
