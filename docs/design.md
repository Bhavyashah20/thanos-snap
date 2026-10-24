# Thanos Snap — Chrome extension design

## Intent
Snap your fingers in front of your webcam and *you* turn to dust and blow away, like the Infinity War snap. Everything else in the frame stays. Works in Meet, Zoom (web), and any site that uses the webcam. For fun/demo; the video stays on-device.

## Goals
- Snap sound (mic) triggers the effect.
- Only the person dissolves: dark-brown ash flakes break off starting at one shoulder, sweep across the body over ~1.5-2s, drift sideways with wind. Matches the reference clip (the Infinity War "snap" dust-away scene; the clip itself is not in this repo).
- After it ends, the room is shown empty (no hole, no ghost).
- Works on any page that calls `getUserMedia`.

## Non-goals
- No hand/finger-visual detection in v1 (the fallback if audio is unreliable; design the trigger as a swappable module).
- No upload of video or audio anywhere. No account, no server.
- Not screen capture; webcam only.

## Anti-goals (failure even if it "works")
- Adds visible lag or drops frames in a call.
- Triggers on claps, keyboard, speech.
- Leaves a blurry smear or the person's outline after disappearing.

## How it works (builder's call, not yet agreed with Bhavya)
1. A content script injected at `document_start` in the page's own JS world wraps `navigator.mediaDevices.getUserMedia`. For a video request it gets the real camera stream, runs it through a canvas pipeline, and returns `canvas.captureStream()` (audio track passes through untouched).
2. Person mask: MediaPipe selfie segmentation (WASM, bundled in the extension, no network).
3. Background plate: running per-pixel model updated only where the mask says "not person", so after the person is removed the plate fills the gap.
4. Dust effect: on trigger, the person's pixels are split into particles; each has a dissolve time based on distance from the start edge (plus noise); once dissolved it flies off along a wind vector with fade and shrink, drawn over the background plate.
5. Snap detector: separate `getUserMedia({audio})` in the extension's own context; short-window high-frequency transient detector (sharp onset, short duration, energy in ~1-5 kHz), with a cooldown and a sensitivity setting.
6. State: snap toggles between "present" and "dust-gone". A second snap brings you back (reverse dissolve or fade-in; builder's call). Popup has an on/off switch and sensitivity slider.

## Constraints
- Chrome, Manifest V3. Needs camera and mic permission (the mic one is a second prompt for snap detection).
- Must hold ~30fps at call resolution on a MacBook.
- Segmentation quality varies; hair edges will be imperfect.

## Left to the builder
Particle count/shape, easing, exact wind, reappear animation, popup design, file layout, test harness (a local test page with a fake camera).

## Risks to check early
- Snap sound detection reliability (the reason for the fallback).
- Meet/Zoom may request camera before the page script wrapper runs; verify injection timing.
- Background plate looks wrong if the camera moves or lighting changes.
