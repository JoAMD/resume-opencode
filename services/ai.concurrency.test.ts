import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type RunWithConcurrency = <T>(key: string, work: () => Promise<T>) => Promise<T>;

async function loadHelperWithConcurrency(value: string): Promise<RunWithConcurrency> {
  vi.resetModules();
  if (value === '') {
    delete process.env.OPENCODE_AI_CONCURRENCY;
  } else {
    process.env.OPENCODE_AI_CONCURRENCY = value;
  }
  const mod = await import('./ai.js');
  return mod.runWithConcurrency;
}

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

type Job = { key: string; tag: string };

function scheduleJobs(run: RunWithConcurrency, jobs: Job[]): { order: string[]; proms: Deferred<string>[]; ps: Promise<string>[] } {
  const order: string[] = [];
  const proms = jobs.map(() => deferred<string>());
  const ps = jobs.map((j, i) =>
    run(j.key, () => proms[i].promise.then(() => { order.push(j.tag); return j.tag; }))
  );
  return { order, proms, ps };
}

const CASES: Array<{ cap: string; jobs: Job[]; resolveFirstN: number; expectedAfterFirst: string[]; expectedFinal: string[] }> = [
  {
    cap: '',
    jobs: [{ key: 'm1', tag: 'a' }, { key: 'm1', tag: 'b' }],
    resolveFirstN: 1,
    expectedAfterFirst: ['a'],
    expectedFinal: ['a', 'b'],
  },
  {
    cap: '2',
    jobs: [
      { key: 'm2', tag: 'a' },
      { key: 'm2', tag: 'b' },
      { key: 'm2', tag: 'c' },
    ],
    resolveFirstN: 2,
    expectedAfterFirst: ['a', 'b'],
    expectedFinal: ['a', 'b', 'c'],
  },
  {
    cap: '3',
    jobs: [
      { key: 'm3', tag: '0' },
      { key: 'm3', tag: '1' },
      { key: 'm3', tag: '2' },
      { key: 'm3', tag: '3' },
    ],
    resolveFirstN: 3,
    expectedAfterFirst: ['0', '1', '2'],
    expectedFinal: ['0', '1', '2', '3'],
  },
  {
    cap: '1',
    jobs: [
      { key: 'mx', tag: 'mx-a' },
      { key: 'my', tag: 'my-b' },
    ],
    resolveFirstN: 2,
    expectedAfterFirst: ['mx-a', 'my-b'],
    expectedFinal: ['mx-a', 'my-b'],
  },
];

describe('runWithConcurrency (per-model slot pool)', () => {
  beforeEach(() => {
    delete process.env.OPENCODE_AI_CONCURRENCY;
  });

  afterEach(() => {
    delete process.env.OPENCODE_AI_CONCURRENCY;
  });

  it.each(CASES)(
    'cap=$cap with $jobs.length jobs enqueues the (cap+1)th onward',
    async ({ cap, jobs, resolveFirstN, expectedAfterFirst, expectedFinal }) => {
      const run = await loadHelperWithConcurrency(cap);
      const { order, proms, ps } = scheduleJobs(run, jobs);

      await new Promise(r => setTimeout(r, 20));
      expect(order).toEqual([]);

      proms.slice(0, resolveFirstN).forEach(p => p.resolve(undefined as unknown as string));
      await Promise.all(ps.slice(0, resolveFirstN));
      await new Promise(r => setTimeout(r, 20));
      expect([...order].sort()).toEqual([...expectedAfterFirst].sort());

      proms.slice(resolveFirstN).forEach(p => p.resolve(undefined as unknown as string));
      await Promise.all(ps.slice(resolveFirstN));
      expect(order).toEqual(expectedFinal);
    }
  );

  it('slot is released even when work throws', async () => {
    const run = await loadHelperWithConcurrency('1');
    const order: string[] = [];
    await expect(
      run('mfail', () =>
        Promise.reject(new Error('boom')).catch(() => {
          order.push('failed');
          throw new Error('boom');
        })
      )
    ).rejects.toThrow('boom');
    expect(order).toEqual(['failed']);

    let secondStarted = false;
    await run('mfail', () => {
      secondStarted = true;
      order.push('ok');
      return Promise.resolve();
    });
    expect(secondStarted).toBe(true);
    expect(order).toEqual(['failed', 'ok']);
  });
});
