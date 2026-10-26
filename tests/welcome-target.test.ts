import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { WELCOME_CHALLENGE_ID } from '../src/catalog/definitions.js';
import { createWelcomeRuntimeManifest } from '../src/catalog/welcome-runtime-manifest.js';
import { RuntimeManifestRegistry } from '../src/orchestrator/runtime-manifests.js';

type Handler = (request: IncomingMessage, response: ServerResponse) => void;
const { createWelcomeHandler } = await import(new URL('../challenges/welcome/handler.mjs', import.meta.url).href) as {
  createWelcomeHandler: (flag: string | undefined) => Handler;
};
const { checkWelcome } = await import(new URL('../challenges/welcome/check.mjs', import.meta.url).href) as {
  checkWelcome: (baseUrl: string, request: typeof fetch) => Promise<void>;
};
const marker = 'runtime-only-test-marker';

function request(handler: Handler, url: string, method = 'GET') {
  const writeHead = vi.fn();
  const end = vi.fn();
  handler({ url, method } as IncomingMessage, { writeHead, end } as unknown as ServerResponse);
  return { writeHead, end, body: end.mock.calls[0]?.[0] as string | undefined };
}

describe('harmless Welcome target handler without starting a target', () => {
  it('renders only the injected value with static relative-safe content', () => {
    const page = request(createWelcomeHandler(marker), '/');
    expect(page.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
    }));
    expect(page.body).toContain(`<code>${marker}</code>`);
    expect(page.body).toContain('Welcome to your first lab');
    expect(page.body).not.toMatch(/https?:|href=|action=|<script|set-cookie/iu);
  });

  it('escapes runtime text and ignores forwarded headers and query values', () => {
    const flag = '<welcome & "new" \'learner\'>';
    const page = request(createWelcomeHandler(flag), '/?flag=untrusted');
    expect(page.body).toContain('&lt;welcome &amp; &quot;new&quot; &#39;learner&#39;&gt;');
    expect(page.body).not.toContain(flag);
    expect(page.body).not.toContain('untrusted');
  });

  it('keeps health, errors, HEAD and rejected methods free of runtime text', () => {
    const handler = createWelcomeHandler(marker);
    for (const [url, method, status, body] of [
      ['/health', 'GET', 200, 'ok\n'], ['/missing', 'GET', 404, 'not found\n'],
      ['/', 'HEAD', 200, undefined], ['/health', 'HEAD', 200, undefined],
      ['/', 'POST', 405, 'method not allowed\n'],
    ] as const) {
      const response = request(handler, url, method);
      expect(response.writeHead).toHaveBeenCalledWith(status, expect.any(Object));
      expect(response.body).toBe(body);
      expect(response.body ?? '').not.toContain(marker);
    }
  });

  it('refuses missing, blank, oversized and control-character configuration with a generic error', () => {
    for (const flag of [undefined, '', '   ', 'x'.repeat(513), 'marker\n']) {
      expect(() => createWelcomeHandler(flag)).toThrow('A valid runtime flag is required');
    }
  });

  it('builds from a pinned base and excludes helpers and flags from the image context', async () => {
    const dockerfile = await readFile(new URL('../challenges/welcome/Dockerfile', import.meta.url), 'utf8');
    const ignores = await readFile(new URL('../challenges/welcome/.dockerignore', import.meta.url), 'utf8');
    const handler = await readFile(new URL('../challenges/welcome/handler.mjs', import.meta.url), 'utf8');
    const server = await readFile(new URL('../challenges/welcome/server.mjs', import.meta.url), 'utf8');
    expect(dockerfile).toMatch(/^FROM node:22-alpine@sha256:[a-f0-9]{64}$/mu);
    expect(dockerfile).toContain('USER 65532:65532');
    expect(dockerfile).not.toMatch(/ENV |ARG |COPY \.|FLAG\{/u);
    expect(ignores.trim().split(/\r?\n/u)).toEqual(['*', '!Dockerfile', '!handler.mjs', '!server.mjs', '!healthcheck.mjs']);
    expect(handler + server).not.toContain('FLAG{');
    expect(server).toContain('process.env.CYBER_RANGE_FLAG');
  });
});

describe('benign Welcome readiness check', () => {
  it('keeps a routed prefix and never consumes the page flag body', async () => {
    const cancel = vi.fn(async () => undefined);
    const pageText = vi.fn(async () => marker);
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response('ok\n'))
      .mockResolvedValueOnce({ status: 200, headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }), body: { cancel }, text: pageText } as unknown as Response);
    await checkWelcome('https://labs.example.test/labs/assigned-key/', fetch);
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      'https://labs.example.test/labs/assigned-key/health', 'https://labs.example.test/labs/assigned-key/',
    ]);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error' });
    expect(cancel).toHaveBeenCalledOnce();
    expect(pageText).not.toHaveBeenCalled();
  });

  it('rejects unsafe URL shapes and redirects without printing their response', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    for (const url of ['file:///tmp/', 'https://user:password@example.test/', 'https://example.test/path', 'https://example.test/?flag=value']) {
      await expect(checkWelcome(url, fetch)).rejects.toThrow('Invalid Welcome target URL');
    }
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockResolvedValueOnce(new Response('redirect', { status: 302 }));
    await expect(checkWelcome('https://example.test/', fetch)).rejects.toThrow('Welcome health check failed');
  });
});

describe('trusted Welcome runtime manifest', () => {
  it('binds the immutable image to fixed identity, health, non-root and limits', () => {
    const image = `sha256:${'b'.repeat(64)}`;
    const manifest = createWelcomeRuntimeManifest(image);
    expect(new RuntimeManifestRegistry([manifest]).get(WELCOME_CHALLENGE_ID)).toEqual(manifest);
    expect(manifest).toMatchObject({
      image, challengeId: WELCOME_CHALLENGE_ID, user: '65532:65532', containerPort: 8080,
      healthcheck: { test: ['CMD', 'node', '/app/healthcheck.mjs'] },
      resources: { memoryMb: 128, cpuCores: 0.5, pids: 64, tmpfsMb: 16 },
    });
    expect(JSON.stringify(manifest)).not.toContain('FLAG');
  });

  it.each(['node:22-alpine', 'node:latest', 'sha256:bad'])('refuses mutable or malformed image %s', (image) => {
    expect(() => createWelcomeRuntimeManifest(image)).toThrow();
  });
});
