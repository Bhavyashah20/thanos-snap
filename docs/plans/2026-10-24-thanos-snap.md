# Thanos Snap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Chrome extension that, on the sound of a finger snap, dissolves the person in the webcam feed into drifting ash and shows the empty room, on any site.

**Architecture:** A MAIN-world content script wraps `navigator.mediaDevices.getUserMedia`; for video requests it returns a canvas `captureStream()` fed by a pipeline (segment -> background plate -> state machine -> dust composite). A snap detector listens on a separate audio stream. All logic is in small pure modules tested under Node; browser glue is thin.

**Tech Stack:** Chrome MV3, vanilla ES modules, esbuild (bundle), `node:test` (tests), `@mediapipe/selfie_segmentation` (bundled WASM/model, no network).

**Spec:** `docs/design.md`

## Global Constraints

- Chrome, Manifest V3; content script `"world": "MAIN"`, `"run_at": "document_start"`, `"all_frames": true`, matches `<all_urls>`.
- No network use at runtime; MediaPipe assets ship inside the extension.
- Audio track from the page's own request passes through untouched; audio-only requests are never modified.
- Target ~30fps at the camera's native resolution on a MacBook.
- Snap trigger toggles present <-> gone. Dust sweep duration ~1.5-2.0s, ash color dark brown, flakes drift sideways.
- Detector is a swappable module (`trigger.js` interface) so a finger-visual trigger can replace it later.
- No git commit trailers/attribution lines.

## Review Focus

- Page requests `{audio:true}` only or with `video:false`: must return the real stream unchanged.
- Page calls `track.stop()` / `stream.getTracks().forEach(stop)`: the real camera must actually turn off (LED off), and the pipeline loop must end.
- No person in frame / segmentation returns an empty mask: output is the plain camera frame, no crash, no black frame.
- Two people in frame: both dissolve (mask is not "largest blob only").
- Tab hidden / minimized during a call: output must keep producing frames (no frozen video).
- Camera resolution changes mid-session (`applyConstraints`, device switch): canvas resizes, plate resets.
- Loud non-snap sounds (clap, keyboard, speech, a 1s noise burst): must not trigger.

---

### Task 1: Scaffold, build, test runner

**Files:**
- Create: `package.json`, `manifest.json`, `build.mjs`, `src/` (empty modules added later), `test/smoke.test.mjs`, `.gitignore`

**Interfaces:**
- Produces: `npm test` (runs `node --test test/`), `npm run build` (esbuild bundles `src/inject.js` -> `dist/inject.js` and `src/bridge.js` -> `dist/bridge.js`, copies `manifest.json`, `popup/`, and MediaPipe assets into `dist/`). Load `dist/` as the unpacked extension.

- [ ] **Step 1:** `git init`; write `test/smoke.test.mjs` asserting `1+1===2`; run `npm test`, expect PASS.
- [ ] **Step 2:** `manifest.json`: two content scripts, `inject.js` (world MAIN) and `bridge.js` (isolated, relays settings from `chrome.storage.local` to the page via `window.postMessage({source:'snap-ext', type:'settings', ...})`); `action` popup; permissions `["storage"]`; `web_accessible_resources` for MediaPipe assets.
- [ ] **Step 3:** `build.mjs` per Interfaces; run `npm run build`, expect `dist/manifest.json` and `dist/inject.js` exist.
- [ ] **Step 4:** Commit.

### Task 2: Snap detector

**Files:**
- Create: `src/snap-detector.js`, `test/snap-detector.test.mjs`

**Interfaces:**
- Produces: `class SnapDetector { constructor({sampleRate:number, sensitivity:number /*0..1, default 0.5*/, cooldownMs:number /*default 1500*/}); setSensitivity(s:number):void; feed(frame:Float32Array, nowMs:number): boolean }` — `frame` is one block of mono samples (e.g. 512); returns true exactly when a snap onset is confirmed.

- [ ] **Step 1: Write failing tests** (synthesize signals in the test): a ~10 ms exponentially decaying noise burst high-passed above 1 kHz at amplitude 0.5 -> `feed` returns true once across the burst; same burst repeated 300 ms later -> false (cooldown); 1 s of steady white noise at the same peak amplitude -> never true; 200 Hz sine speech-like tone with an amplitude step -> never true; silence -> false; `sensitivity=1` triggers on an amplitude-0.1 burst, `sensitivity=0` does not.
- [ ] **Step 2:** Run, expect FAIL (module missing).
- [ ] **Step 3:** Implement `SnapDetector`: per frame, high-pass (~1 kHz) energy vs. a slow running noise-floor average; onset = high-band energy jumps > threshold(sensitivity) x floor AND the burst falls back below half its peak within ~60 ms (rejects sustained noise); apply cooldown.
- [ ] **Step 4:** Run tests, expect PASS. Commit.

### Task 3: Background plate

**Files:**
- Create: `src/background-plate.js`, `test/background-plate.test.mjs`

**Interfaces:**
- Produces: `class BackgroundPlate { constructor(width:number, height:number); update(rgba:Uint8ClampedArray, mask:Uint8Array /*1=person*/):void; read():Uint8ClampedArray; reset(width,height):void; coverage():number /*0..1 fraction of pixels ever seen as background*/ }`

- [ ] **Step 1: Write failing tests:** where mask=0, plate converges to the frame pixel (blend ~0.1/frame, so within 40 frames of constant input it's within 2 levels); where mask=1, plate pixel is unchanged; a pixel never seen as background keeps value 0 and is excluded from `coverage()`; `reset` with new dimensions clears and resizes.
- [ ] **Step 2:** Run, expect FAIL.
- [ ] **Step 3:** Implement with a `seen` bitmap; first sighting copies the pixel directly, later ones blend.
- [ ] **Step 4:** Run, expect PASS. Commit.

### Task 4: Dust effect

**Files:**
- Create: `src/dust.js`, `test/dust.test.mjs`

**Interfaces:**
- Consumes: frame RGBA + mask as in Task 3.
- Produces: `class DustEffect { constructor(opts?:{durationMs?:1700, seed?:number}); start(rgba:Uint8ClampedArray, mask:Uint8Array, width:number, height:number, nowMs:number):void; render(plate:Uint8ClampedArray, out:Uint8ClampedArray, nowMs:number):boolean /*false when finished*/ ; reverse(nowMs:number):void /*fade person back in over 600 ms*/ }` — `render` writes background plate everywhere then composites remaining person pixels and flying particles over it.

- [ ] **Step 1: Write failing tests** with a small synthetic frame (64x48), mask = a rectangle: at `t=start` the output equals the original frame in the person region; at `t=start+durationMs+500` output equals the plate exactly and `render` returns false; at mid-time, the dissolved fraction of person pixels is between 20% and 80% and dissolution begins at the left-most mask column (earliest-dissolved pixels have smaller x than latest); same `seed` gives identical output; no output pixel outside the person's bounding box expanded by the drift distance differs from the plate.
- [ ] **Step 2:** Run, expect FAIL.
- [ ] **Step 3:** Implement: each person pixel group (sample every ~3px) gets dissolve time = `(x-minX)/(width of bbox) * 0.7*duration + noise`; once dissolved it becomes a flake (dark brown tint blended with source color, 1-3 px) moving along wind `(+vx, -vy small)` with fade. Pixels not yet dissolved stay in place. No per-frame allocation.
- [ ] **Step 4:** Run, expect PASS. Commit.

### Task 5: Pipeline state machine

**Files:**
- Create: `src/pipeline.js`, `test/pipeline.test.mjs`

**Interfaces:**
- Consumes: `BackgroundPlate`, `DustEffect`; a `segment(imageData):Uint8Array` function injected at construction.
- Produces: `class Pipeline { constructor({segment, width, height}); trigger(nowMs:number):void; processFrame(rgba:Uint8ClampedArray, out:Uint8ClampedArray, nowMs:number):void; get state(): 'present'|'dusting'|'gone'|'returning'; resize(width,height):void }`

- [ ] **Step 1: Write failing tests** with a fake `segment`: state is `present` and output equals input; `trigger` -> `dusting`, then `gone` after duration; in `gone` output person region equals plate (not the live frame); `trigger` while `gone` -> `returning` -> `present`; `trigger` during `dusting` is ignored; empty mask in `present` -> output equals input, no throw; `resize` resets plate and keeps state `present`; two disjoint rectangles in the mask both dissolve.
- [ ] **Step 2:** Run, expect FAIL.
- [ ] **Step 3:** Implement. In `gone`/`dusting` the plate keeps updating from non-person pixels; person that re-enters the frame in `gone` stays hidden (mask area is always replaced by plate).
- [ ] **Step 4:** Run, expect PASS. Commit.

### Task 6: Segmenter and getUserMedia wrapper

**Files:**
- Create: `src/segmenter.js`, `src/audio-trigger.js`, `src/inject.js`, `src/bridge.js`, `test/inject.test.mjs`

**Interfaces:**
- Produces: `createSegmenter():Promise<(imageBitmapOrCanvas)=>Uint8Array>` wrapping MediaPipe selfie segmentation (threshold 0.5, model 1/landscape); `startAudioTrigger(getUserMediaOrig, detector, onSnap:()=>void):{stop():void}` (AudioWorklet or ScriptProcessor feeding `SnapDetector.feed`, opened lazily on first video request); `wrapGetUserMedia(mediaDevices, deps):void` replaces `getUserMedia`.
- `test/inject.test.mjs` tests `wrapGetUserMedia` with a fake `mediaDevices` and fake deps (no real canvas): audio-only request returns the original stream object; video request returns a stream with a processed video track and the original audio track; stopping the returned video track calls `stop()` on the real camera track and ends the pipeline loop; segmenter load failure falls back to returning the real stream (never break the call).

- [ ] **Step 1:** Write the four failing tests above; run, expect FAIL.
- [ ] **Step 2:** Implement `wrapGetUserMedia` with injected deps (`createPipelineRunner`, `startAudioTrigger`) so the logic is testable; the frame loop uses `requestVideoFrameCallback` on a hidden `<video>`, with a `setInterval(33ms)` fallback when `document.hidden` so hidden tabs keep producing frames.
- [ ] **Step 3:** Implement `segmenter.js`, `audio-trigger.js`, and the real wiring in `inject.js` (reads settings from `postMessage` events from `bridge.js`: `enabled:boolean`, `sensitivity:number`; when `enabled` is false the original `getUserMedia` is used).
- [ ] **Step 4:** Run tests, expect PASS. Commit.

### Task 7: Popup and manual verification

**Files:**
- Create: `popup/popup.html`, `popup/popup.js`, `test-page/index.html`

**Interfaces:**
- Consumes: settings keys `enabled` (bool, default true), `sensitivity` (0..1, default 0.5) in `chrome.storage.local`.

- [ ] **Step 1:** Popup with an on/off toggle and a sensitivity slider writing to `chrome.storage.local`; `bridge.js` posts changes to the page live.
- [ ] **Step 2:** `test-page/index.html`: calls `getUserMedia({video:true,audio:true})`, shows the video, a live state readout (`present/dusting/gone/returning`) and a mic level bar.
- [ ] **Step 3:** `npm run build`; load `dist/` unpacked; open the test page; verify with the user's real camera: snap -> dissolve ~1.7s -> empty room -> snap again -> returns. Check fps counter >= 25. Report any false triggers (clap, typing, speech) and missed snaps.
- [ ] **Step 4:** Open meet.google.com/new, confirm the same behavior in the preview tile and that mic/camera still work after a snap cycle.
- [ ] **Step 5:** Commit.
