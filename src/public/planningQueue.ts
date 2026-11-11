/** Serialize state-producing novel analysis; image rendering retains its own concurrency. */
type Job = { floor: number; run: () => Promise<unknown>; resolve: (value: unknown) => void; reject: (reason: unknown) => void };
const queues = new Map<string, { active: boolean; jobs: Job[] }>();
export function queueNovelPlan<T>(chat: string, floor: number, run: () => Promise<T>): Promise<T> {
  let q = queues.get(chat);
  if (!q) { q = { active: false, jobs: [] }; queues.set(chat, q); }
  const queue = q;
  const result = new Promise<T>((resolve, reject) => queue.jobs.push({ floor, run, resolve: v => resolve(v as T), reject }));
  queueMicrotask(async () => {
    if (queue.active) return;
    queue.active = true;
    try {
      while (queue.jobs.length) {
        queue.jobs.sort((a,b) => a.floor-b.floor);
        const job = queue.jobs.shift()!;
        try { job.resolve(await job.run()); } catch(e) { job.reject(e); }
      }
    } finally { queue.active = false; if (!queue.jobs.length) queues.delete(chat); }
  });
  return result;
}
