// Shared lab runtime. Deliberately small: no lab-specific behavior belongs here.
import { readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';

export const FLAG_FILE = '/tmp/.cr-flag';

/** Reads the worker-delivered flag once and removes it, so it is not left for a file read to find. */
export async function takeFlag() {
  for (;;) {
    const flag = await readFile(FLAG_FILE, 'utf8').catch(() => '');
    if (flag) {
      await rm(FLAG_FILE, { force: true });
      return flag;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Starts listening only after setup, so readiness means the lab holds its flag. */
export function serve(handler) {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://lab.invalid');
    if (url.pathname === '/healthz') return send(response, 200, 'ok', 'text/plain');
    try {
      await handler(request, response, url);
    } catch {
      send(response, 500, page('Error', '<p>Something went wrong.</p>'));
    }
  });
  server.listen(8080, '0.0.0.0');
}

export function send(response, status, body, type = 'text/html; charset=utf-8', headers = {}) {
  response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...headers });
  response.end(body);
}

/** Relative targets only: ingress strips the lab's route prefix before forwarding. */
export function redirect(response, target, headers = {}) {
  response.writeHead(303, { Location: target, ...headers });
  response.end();
}

export async function readForm(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16_384) throw new Error('Form too large');
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

export function cookies(request) {
  return Object.fromEntries((request.headers.cookie ?? '').split(';').flatMap((part) => {
    const separator = part.indexOf('=');
    return separator < 0 ? [] : [[part.slice(0, separator).trim(), part.slice(separator + 1).trim()]];
  }));
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/gu, (character) => `&#${character.charCodeAt(0)};`);
}

export function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;color:#1f2a24}input,button{font:inherit;padding:.4rem .6rem;margin:.2rem 0}table{border-collapse:collapse;width:100%}td,th{border:1px solid #cfd8d2;padding:.4rem .6rem;text-align:left}pre{background:#f1f4f2;padding:.8rem;overflow:auto}</style></head><body>${body}</body></html>`;
}
