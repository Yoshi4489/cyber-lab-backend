import { describe, expect, it } from 'vitest';
import type { ClaimedLifecycleOperation } from '../src/queue/contracts.js';
import { SerializedLifecycleRunner } from '../src/services/serialized-lifecycle-runner.js';

describe('shared lifecycle/sweep serialization', () => {
  it('serializes timer sweeps with queue execution in both directions', async () => {
    const events: string[] = [];
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const runner = new SerializedLifecycleRunner({ handle: async () => {
      events.push('handle-start'); await barrier; events.push('handle-end');
    } }, { sweep: async () => { events.push('sweep'); } });
    const job = runner.handle({} as ClaimedLifecycleOperation);
    const sweep = runner.sweep();
    await Promise.resolve();
    expect(events).toEqual(['handle-start']);
    release();
    await Promise.all([job, sweep]);
    expect(events).toEqual(['handle-start', 'handle-end', 'sweep']);

    events.length = 0;
    const reverse = new SerializedLifecycleRunner({ handle: async () => { events.push('handle'); } }, {
      sweep: async () => { events.push('sweep-start'); await Promise.resolve(); events.push('sweep-end'); },
    });
    await Promise.all([reverse.sweep(), reverse.handle({} as ClaimedLifecycleOperation)]);
    expect(events).toEqual(['sweep-start', 'sweep-end', 'handle']);
    await reverse.drain();
  });

  it('keeps the gate usable after a failed sweep', async () => {
    let handled = false;
    const runner = new SerializedLifecycleRunner({ handle: async () => { handled = true; } }, {
      sweep: async () => { throw new Error('dependency unavailable'); },
    });
    await expect(runner.sweep()).rejects.toThrow('dependency unavailable');
    await runner.handle({} as ClaimedLifecycleOperation);
    await runner.drain();
    expect(handled).toBe(true);
  });

  it('drains a pending sweep and queued handle before shutdown can close dependencies', async () => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const events: string[] = [];
    const runner = new SerializedLifecycleRunner({ handle: async () => { events.push('handle'); } }, {
      sweep: async () => { await barrier; events.push('sweep'); },
    });
    const sweep = runner.sweep();
    const handle = runner.handle({} as ClaimedLifecycleOperation);
    const drain = runner.drain().then(() => events.push('closed'));
    await Promise.resolve();
    expect(events).toEqual([]);
    release();
    await Promise.all([sweep, handle, drain]);
    expect(events).toEqual(['sweep', 'handle', 'closed']);
  });
});
