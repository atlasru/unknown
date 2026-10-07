/** Bound renderer reads so a workspace full of tabs cannot flood the unchanged local server. */
export function createReadQueue(limit = 2) {
  if (!Number.isInteger(limit) || limit < 1)
    throw new RangeError('Read concurrency must be positive');
  type Task = {
    run: () => Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
    signal?: AbortSignal;
    aborted: boolean;
    onAbort: () => void;
  };
  const waiting: Task[] = [];
  let active = 0;
  const pump = () => {
    while (active < limit && waiting.length) {
      const task = waiting.shift()!;
      if (task.aborted) {
        task.signal?.removeEventListener('abort', task.onAbort);
        continue;
      }
      active++;
      Promise.resolve()
        .then(task.run)
        .then(task.resolve, task.reject)
        .finally(() => {
          active--;
          task.signal?.removeEventListener('abort', task.onAbort);
          pump();
        });
    }
  };
  return <T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> =>
    new Promise((resolve, reject) => {
      const task: Task = {
        run,
        resolve: (value) => resolve(value as T),
        reject,
        signal,
        aborted: false,
        onAbort: () => {
          task.aborted = true;
          reject(signal?.reason || new DOMException('Read cancelled', 'AbortError'));
        },
      };
      if (signal?.aborted) {
        task.onAbort();
        return;
      }
      signal?.addEventListener('abort', task.onAbort, { once: true });
      waiting.push(task);
      pump();
    });
}
