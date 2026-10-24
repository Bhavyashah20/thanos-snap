import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });

const entries = [['src/inject.js', 'dist/inject.js'], ['src/bridge.js', 'dist/bridge.js'], ['popup/popup.js', 'dist/popup/popup.js']];
for (const [entry, out] of entries) {
  if (existsSync(entry)) await build({ entryPoints: [entry], outfile: out, bundle: true, format: 'iife', target: 'chrome111' });
}
cpSync('manifest.json', 'dist/manifest.json');
if (existsSync('popup/popup.html')) cpSync('popup/popup.html', 'dist/popup/popup.html');
cpSync('node_modules/@mediapipe/selfie_segmentation', 'dist/mediapipe', { recursive: true });
console.log('built dist/');
