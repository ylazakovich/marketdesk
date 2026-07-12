// Bull-based job queue over Redis. Thin, typed wrapper around a Bull queue so
// the rest of the app enqueues/consumes jobs without touching Bull directly.
// The Redis connection is read from config/env. A processor (JobHandler) is
// registered via process(); the DI wiring that binds concrete handlers happens
// in Group 6.

import Bull from 'bull';
import { env } from '../../config/env';

export interface BullJobQueueOptions {
  redisUrl?: string;
  prefix?: string;
  defaultJobOptions?: Bull.JobOptions;
}

export class BullJobQueue<T = unknown> {
  private readonly queue: Bull.Queue<T>;

  constructor(name: string, options: BullJobQueueOptions = {}) {
    const redisUrl = options.redisUrl ?? env.redis.url;
    this.queue = new Bull<T>(name, redisUrl, {
      prefix: options.prefix ?? 'md:jobs',
      defaultJobOptions: options.defaultJobOptions ?? {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    });
  }

  // Enqueue a job.
  add(data: T, opts?: Bull.JobOptions): Promise<Bull.Job<T>> {
    return this.queue.add(data, opts);
  }

  // Register the processor. Concrete handlers are adapted to this callback shape
  // by the wiring layer.
  process(handler: Bull.ProcessCallbackFunction<T>): void {
    void this.queue.process(handler);
  }

  // Register a promise-style processor (handler returns a value/throws).
  processAsync(handler: (job: Bull.Job<T>) => Promise<unknown>): void {
    void this.queue.process(async (job: Bull.Job<T>) => handler(job));
  }

  // Escape hatch for advanced Bull usage.
  get raw(): Bull.Queue<T> {
    return this.queue;
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}
