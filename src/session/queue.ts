import { checkRequest, currentRequest, RequestStopped } from './request.js';

export interface SerialTaskQueue {
  <T>(operation: () => Promise<T>): Promise<T>;
  shutdown(): Promise<void>;
}
export function createSerialTaskQueue(maxPending = 32): SerialTaskQueue {
  let tail: Promise<unknown> = Promise.resolve();
  let pending = 0;
  let closed = false;
  const queue: SerialTaskQueue = <T>(operation: () => Promise<T>): Promise<T> => {
    if (closed) return Promise.reject(new RequestStopped('server_closed'));
    if (pending >= maxPending) return Promise.reject(new RequestStopped('queue_full'));
    pending++;
    let started = false;
    const result = tail.then(() => {
      pending--;
      started = true;
      if (closed) throw new RequestStopped('server_closed');
      checkRequest();
      return operation();
    });
    tail = result.catch(() => {});
    const signal = currentRequest()?.signal;
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => { if (!started) reject(signal?.reason); };
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
      const cleanup = () => signal?.removeEventListener('abort', onAbort);
      result.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    });
  };
  queue.shutdown = async () => { closed = true; await tail; };
  return queue;
}
