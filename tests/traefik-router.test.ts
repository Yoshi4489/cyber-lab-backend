import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileTraefikRouter } from '../src/orchestrator/traefik-router.js';

const instanceId = '77777777-7777-4777-8777-777777777777';
const routeKey = 'abcdefghijklmnopqrstuvwx12345678';

describe('Traefik file routes', () => {
  it('writes a supported YAML route and removes it with the instance', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cyber-range-traefik-'));
    try {
      const router = new FileTraefikRouter(directory);
      await router.upsert({ instanceId, routeKey, targetHost: 'cr-target', targetPort: 8080 });
      const files = await readdir(directory);
      expect(files).toEqual(['lab-77777777777747778777777777777777.yml']);
      const route = await readFile(join(directory, files[0]!), 'utf8');
      expect(route).toContain(`rule: "PathPrefix(\`/labs/${routeKey}/\`)"`);
      expect(route).toContain(`prefixes: ["/labs/${routeKey}"]`);
      expect(route).toContain('servers: [{url: "http://cr-target:8080"}]');
      await router.remove(instanceId);
      expect(await readdir(directory)).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
