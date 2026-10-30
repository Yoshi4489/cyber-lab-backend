import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CHALLENGE_DEFINITIONS } from '../src/catalog/definitions.js';
import { CHALLENGES_DIRECTORY, loadChallengePackages } from '../src/catalog/packages.js';
import { calculateAward } from '../src/services/challenge-content.js';

describe('challenge packages', () => {
  const temporary: string[] = [];
  afterEach(async () => {
    await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  async function copyOfInvoicePeek(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'challenge-packages-'));
    temporary.push(directory);
    await cp(join(CHALLENGES_DIRECTORY, 'invoice-peek'), join(directory, 'invoice-peek'), { recursive: true });
    return directory;
  }
  async function editDefinition(directory: string, change: (definition: Record<string, unknown>) => void) {
    const path = join(directory, 'invoice-peek/definition.json');
    const definition = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    change(definition);
    await writeFile(path, JSON.stringify(definition));
  }

  it('loads every committed lab with exec flag delivery and unique ids', async () => {
    const packages = await loadChallengePackages();
    expect(packages.map(({ slug }) => slug)).toEqual([
      'caesars-memo', 'invoice-peek', 'leaky-capture', 'license-check', 'log-viewer',
      'lost-photo', 'ping-tool', 'small-e', 'staff-login',
    ]);
    for (const lab of packages) {
      if (lab.kind === 'artifact') expect(lab.runtime).toBeNull();
      else expect(lab.runtime?.flagDelivery.mode).toBe('exec');
      expect(CHALLENGE_DEFINITIONS.some(({ id }) => id === lab.id)).toBe(false);
    }
  });

  it('refuses a lab that would expose its flag through the environment', async () => {
    const directory = await copyOfInvoicePeek();
    const path = join(directory, 'invoice-peek/runtime.json');
    const runtime = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    await writeFile(path, JSON.stringify({ ...runtime, flagDelivery: { mode: 'env' } }));
    await expect(loadChallengePackages(directory)).rejects.toThrow('must not expose their flag');
  });

  it('refuses a flag value in published text', async () => {
    const directory = await copyOfInvoicePeek();
    await writeFile(join(directory, 'invoice-peek/walkthrough.md'), 'The answer is CTF{v1_real-looking}.');
    await expect(loadChallengePackages(directory)).rejects.toThrow('must not publish a flag value');
  });

  it('refuses points that do not match the difficulty', async () => {
    const directory = await copyOfInvoicePeek();
    await editDefinition(directory, (definition) => { definition.points = 999; });
    await expect(loadChallengePackages(directory)).rejects.toThrow('Points must match the difficulty');
  });

  it('refuses a missing solver, because every lab must be proven solvable', async () => {
    const directory = await copyOfInvoicePeek();
    await rm(join(directory, 'invoice-peek/solve/solve.mjs'));
    await expect(loadChallengePackages(directory)).rejects.toThrow();
  });
});

describe('calculateAward', () => {
  const hint = (costApplied: number) => ({ item: 'hint:1', costApplied });

  it('awards the base with no unlocks', () => {
    expect(calculateAward(100, [])).toBe(100);
  });
  it('subtracts hint costs', () => {
    expect(calculateAward(100, [hint(10), hint(25)])).toBe(65);
  });
  it('never falls below 10% of base', () => {
    expect(calculateAward(100, [hint(95)])).toBe(10);
    expect(calculateAward(10, [hint(50)])).toBe(1);
  });
  it('forfeits everything after a walkthrough', () => {
    expect(calculateAward(100, [{ item: 'walkthrough', costApplied: 0 }])).toBe(0);
  });
});
