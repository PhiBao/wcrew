#!/usr/bin/env node
/**
 * wcrew — static server with WebMCP-friendly headers.
 * Serves the repo root on the given port (default 8788).
 * Adds Origin-Agent-Cluster for WebMCP origin isolation and
 * correct MIME for .mjs/.js/.json/.html/.css.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.argv[2] ?? process.env.PORT ?? 8788);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};

function mimeFor(p) {
  return MIME[extname(p).toLowerCase()] ?? 'application/octet-stream';
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${port}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.includes('\0')) pathname = '/';
    // SPA: serve index.html for root, otherwise file
    if (pathname === '/') pathname = '/index.html';
    const filePath = join(root, normalize(pathname).replace(/^\/+/, ''));
    // prevent escape
    if (!filePath.startsWith(root)) {
      res.writeHead(403); res.end('forbidden'); return;
    }
    let st;
    try { st = await stat(filePath); } catch { st = null; }
    if (!st || st.isDirectory()) {
      // try index.html fallback for pretty routes
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found: ' + pathname);
      return;
    }
    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': mimeFor(filePath),
      'Cache-Control': 'no-store',
      // Required for WebMCP origin-isolation (`document.modelContext` gated)
      'Origin-Agent-Cluster': '?1',
      // Allow Tool Inspector / ChatGPT Sites iframe with tools perm
      'Permissions-Policy': 'tools=(self)',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
  } catch (e) {
    console.error(e);
    try { res.writeHead(500); res.end('internal error'); } catch {}
  }
});

server.listen(port, () => {
  console.log(`[wcrew] serving ${root} → http://localhost:${port}`);
  console.log(`[wcrew] WebMCP: open in Chrome 149+ with chrome://flags/#enable-webmcp-testing → Enabled, or ChatGPT in-app browser`);
});
