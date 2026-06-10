import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type RunWithConcurrency = <T>(key: string, work: () => Promise<T>) => Promise<T>;
type EnqueueAIRequest = <T>(model: string, work: () => Promise<T>) => Promise<T>;

async function loadModule(value: { concurrency?: string; queue?: string }): Promise<{
  runWithConcurrency: RunWithConcurrency;
  enqueueAIRequest: EnqueueAIRequest;
}> {
  vi.resetModules();
  if (value.concurrency === undefined) {
    delete process.env.OPENCODE_AI_CONCURRENCY;
  } else {
    process.env.OPENCODE_AI_CONCURRENCY = value.concurrency;
  }
  if (value.queue === undefined) {
    delete process.env.OPENCODE_AI_QUEUE;
  } else {
    process.env.OPENCODE_AI_QUEUE = value.queue;
  }
  const mod = await import('./ai.js');
  return { runWithConcurrency: mod.runWithConcurrency, enqueueAIRequest: mod.enqueueAIRequest };
}

async function loadHelperWithConcurrency(value: string): Promise<RunWithConcurrency> {
  const { runWithConcurrency } = await loadModule({ concurrency: value });
  return runWithConcurrency;
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
    delete process.env.OPENCODE_AI_QUEUE;
  });

  afterEach(() => {
    delete process.env.OPENCODE_AI_CONCURRENCY;
    delete process.env.OPENCODE_AI_QUEUE;
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

describe('enqueueAIRequest (queue toggle)', () => {
  beforeEach(() => {
    delete process.env.OPENCODE_AI_CONCURRENCY;
    delete process.env.OPENCODE_AI_QUEUE;
  });

  afterEach(() => {
    delete process.env.OPENCODE_AI_CONCURRENCY;
    delete process.env.OPENCODE_AI_QUEUE;
  });

  const DISABLED_VALUES = ['false', 'FALSE', 'False'];

  it.each(DISABLED_VALUES)(
    'bypasses the slot pool when OPENCODE_AI_QUEUE=%s (regardless of concurrency)',
    async (queueVal) => {
      const { enqueueAIRequest } = await loadModule({ concurrency: '1', queue: queueVal });
      const order: string[] = [];
      const proms = [deferred<string>(), deferred<string>(), deferred<string>()];
      const ps = proms.map((p, i) =>
        enqueueAIRequest(`eqm-off-${queueVal}`, () => p.promise.then(() => { order.push(String(i)); return String(i); }))
      );
      await new Promise(r => setTimeout(r, 20));
      proms.forEach(p => p.resolve(undefined as unknown as string));
      await Promise.all(ps);
      expect(order).toEqual(['0', '1', '2']);
    }
  );

  it('queues strictly by default (concurrency=1, queue unset)', async () => {
    const { enqueueAIRequest } = await loadModule({});
    const order: string[] = [];
    const a = deferred<string>();
    const b = deferred<string>();

    const pa = enqueueAIRequest('eqm1', () => a.promise.then(() => { order.push('a'); return 'a'; }));
    const pb = enqueueAIRequest('eqm1', () => b.promise.then(() => { order.push('b'); return 'b'; }));

    await new Promise(r => setTimeout(r, 20));
    expect(order).toEqual([]);

    a.resolve(undefined as unknown as string);
    await pa;
    await new Promise(r => setTimeout(r, 20));
    expect(order).toEqual(['a']);

    b.resolve(undefined as unknown as string);
    await pb;
    expect(order).toEqual(['a', 'b']);
  });
});
