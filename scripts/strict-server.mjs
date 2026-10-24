// Serves the project root with a Meet-like strict policy so we can reproduce page-security failures locally:
// Trusted Types required for scripts, no foreign scripts, no foreign connections, same-origin frames only.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = process.cwd();
const port = Number(process.argv[2] || 8124);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.wasm': 'application/wasm', '.json': 'application/json' };
const csp = process.env.NO_CSP ? null : "default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src 'self'; worker-src 'self' blob:; img-src * data: blob:; media-src * blob: mediastream:; require-trusted-types-for 'script'";

createServer(async (req, res) => {
  try {
    let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (p.endsWith('/')) p += 'index.html';
    const data = await readFile(join(root, p));
    const h = { 'Content-Type': types[extname(p)] || 'application/octet-stream' };
    if (csp) h['Content-Security-Policy'] = csp;
    res.writeHead(200, h).end(data);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, () => console.log(`strict server on ${port}`));
