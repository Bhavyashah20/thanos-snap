// Renders the demo footage by driving the extension's real effect code (Pipeline: captured room, dust dissolve,
// lighting match, return) over a synthetic scene: a drawn room and a cartoon person whose exact outline is used
// as the "segmentation". No camera, no film footage, no real face.
//   node scripts/render-demo.mjs [--out clip.mp4] [--gif clip.gif]   (needs ffmpeg)
import { Pipeline } from '../src/pipeline.js';
import { spawnSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdtempSync, appendFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
const OUT_MP4 = arg('--out', 'docs/demo/clip.mp4');
const OUT_GIF = arg('--gif', null);
const W = 1280, H = 720, FPS = 30, SECONDS = 5.0;
const S = W / 640; // the scene is drawn in 640x360 units and scaled
const SNAP1 = 0.7, SNAP2 = 3.7; // seconds: dissolve 0.7-2.4, empty room 2.4-3.7, return 3.7-4.3

const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const inEllipse = (x, y, cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
const noise = (x, y) => { const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return (n - Math.floor(n)) - 0.5; };

function roomColor(x, y) {
  // wall: warm gradient with a soft sunlit patch on the right
  let c = mix([218, 209, 192], [194, 183, 166], y / H);
  const sun = Math.max(0, 1 - Math.hypot(x - 540, y - 170) / 190);
  c = mix(c, [240, 228, 205], sun * 0.45);
  // window with bars and a bright garden outside
  if (x >= 70 && x < 300 && y >= 46 && y < 262) {
    const frame = x < 80 || x >= 290 || y < 56 || y >= 252 || (x >= 181 && x < 189) || (y >= 148 && y < 154);
    if (frame) return [58, 48, 44];
    let g = mix([252, 249, 238], [228, 238, 214], (y - 56) / 196);
    if (inEllipse(x, y, 130, 210, 46, 34) || inEllipse(x, y, 235, 225, 55, 30)) g = [96, 138, 84];
    if (x > 205 && x < 217 && y > 120) g = [92, 74, 60]; // tree trunk
    return g;
  }
  // curtains
  if ((x >= 28 && x < 70) || (x >= 300 && x < 352)) {
    const fold = 0.5 + 0.5 * Math.sin(x * 0.9);
    return mix([120, 92, 112], [168, 140, 158], fold);
  }
  // picture frame
  if (x >= 470 && x < 566 && y >= 58 && y < 146) {
    if (x < 476 || x >= 560 || y < 64 || y >= 140) return [50, 38, 34];
    return mix([226, 142, 60], [48, 92, 150], ((x - 476) / 84 + (y - 64) / 76) / 2);
  }
  // floor / bed
  if (y >= 304) {
    if (x < 250) return mix([196, 214, 210], [170, 192, 190], (y - 304) / 56);
    return mix([128, 98, 76], [98, 74, 58], (y - 304) / 56);
  }
  return c;
}

// The cartoon person. Returns an [r,g,b] where the person is, else null (this doubles as the mask).
function personColor(x, y, cx) {
  const head = inEllipse(x, y, cx, 168, 52, 64);
  const hair = inEllipse(x, y, cx, 128, 56, 40) && y < 150;
  if (hair) return [38, 28, 26];
  if (head) {
    if (inEllipse(x, y, cx - 18, 168, 5, 4) || inEllipse(x, y, cx + 18, 168, 5, 4)) return [40, 30, 28];
    if (y > 200 && y < 205 && x > cx - 14 && x < cx + 14) return [140, 80, 72];
    return mix([208, 154, 124], [186, 130, 104], (y - 110) / 120);
  }
  if (x > cx - 22 && x < cx + 22 && y >= 220 && y < 260) return [190, 134, 108];
  if (inEllipse(x, y, cx, 372, 150, 120) && y >= 250) {
    const collar = inEllipse(x, y, cx, 262, 30, 14) && y > 250;
    return collar ? [60, 76, 90] : mix([104, 124, 140], [74, 92, 108], (x - (cx - 150)) / 300);
  }
  return null;
}

const raw = join(mkdtempSync(join(tmpdir(), 'snap-demo-')), 'frames.rgba');
writeFileSync(raw, '');

const room = new Uint8ClampedArray(W * H * 4);
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const c = roomColor(x / S, y / S), n = noise(x, y) * 3;
    room.set([clamp(c[0] + n), clamp(c[1] + n), clamp(c[2] + n), 255], (y * W + x) * 4);
  }

let mask = new Uint8Array(W * H);
const pipeline = new Pipeline({ width: W, height: H, segment: () => mask, minBackgroundFrames: 1 });
pipeline.beginCapture();
pipeline.captureFrame(room);
pipeline.commitCapture(); // "Capture empty room"

const frame = new Uint8ClampedArray(W * H * 4);
const out = new Uint8ClampedArray(W * H * 4);
const total = Math.round(SECONDS * FPS);
let fired1 = false, fired2 = false;
for (let i = 0; i < total; i++) {
  const t = i / FPS;
  const cx = 400 + 7 * Math.sin(t * 2.1); // in 640-space
  frame.set(room);
  mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const c = personColor(x / S, y / S, cx);
      if (!c) continue;
      const n = noise(x + 7, y) * 3;
      frame.set([clamp(c[0] + n), clamp(c[1] + n), clamp(c[2] + n), 255], (y * W + x) * 4);
      mask[y * W + x] = 1;
    }
  const ms = t * 1000;
  if (!fired1 && t >= SNAP1) { pipeline.trigger(ms); fired1 = true; }
  if (!fired2 && t >= SNAP2) { pipeline.trigger(ms); fired2 = true; }
  pipeline.processFrame(frame, out, ms);
  appendFileSync(raw, out);
}

const run = (args) => { const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' }); if (r.status) throw new Error('ffmpeg failed'); };
const input = ['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(FPS), '-i', raw];
mkdirSync(dirname(OUT_MP4), { recursive: true });
run([...input, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '14', '-movflags', '+faststart', OUT_MP4]);
if (OUT_GIF) run([...input, '-vf', 'fps=20,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4', '-loop', '0', OUT_GIF]);
rmSync(raw, { force: true });
console.log(`rendered ${total} frames (${SECONDS}s) -> ${OUT_MP4}`);
