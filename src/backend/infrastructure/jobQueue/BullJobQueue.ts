// Bull-based job queue over Redis. Thin, typed wrapper around a Bull queue so
// the rest of the app enqueues/consumes jobs without touching Bull directly.
// The Redis connection is read from config/env. A processor (JobHandler) is
// registered via process(); the DI wiring that binds concrete handlers happens
// in Group 6.

import { randomUUID } from 'node:crypto';

import Bull from 'bull';
import { env } from '../../config/env';

const BULK_RESERVATION_TTL_MS = 5 * 60 * 1000;

const RESERVE_BULK_JOB_IDS_SCRIPT = `
local count = tonumber(ARGV[1])
local token = ARGV[2]
local ttl = tonumber(ARGV[3])

for index = 1, count do
  if redis.call('EXISTS', KEYS[count + index]) == 1 then
    return {0, 'existing_job', index}
  end
end

for index = 1, count do
  if redis.call('SET', KEYS[index], token, 'NX', 'PX', ttl) == false then
    for releaseIndex = 1, index - 1 do
      if redis.call('GET', KEYS[releaseIndex]) == token then
        redis.call('DEL', KEYS[releaseIndex])
      end
    end
    return {0, 'reserved_job_id', index}
  end
end

return {1, 'reserved', 0}
`;

const RELEASE_BULK_JOB_IDS_SCRIPT = `
local token = ARGV[1]
for index = 1, #KEYS do
  if redis.call('GET', KEYS[index]) == token then
    redis.call('DEL', KEYS[index])
  end
end
return #KEYS
`;

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

  // Enqueue a bounded group under explicit Redis-backed reservations. Classic
  // Bull uses a Redis transaction for addBulk, but duplicate custom job ids are
  // logical no-ops rather than batch failures. The reservation fence rejects any
  // duplicate/in-flight job id before accepting new jobs, and compensation
  // removes owned jobs if Bull reports an add failure.
  async addBulk(items: Array<{ data: T; opts?: Bull.JobOptions }>): Promise<Array<Bull.Job<T>>> {
    if (items.length === 0) return [];
    const jobIds = items.map((item) => item.opts?.jobId).map((jobId) => String(jobId ?? ''));
    if (jobIds.some((jobId) => jobId.length === 0)) {
      throw new Error('Bulk enqueue requires a custom jobId for every job');
    }
    if (new Set(jobIds).size !== jobIds.length) {
      throw new Error('Bulk enqueue requires unique jobIds within the batch');
    }

    await this.queue.isReady();
    const reservationKeys = jobIds.map((jobId) => this.queue.toKey(`bulk-reservation:${jobId}`));
    const jobKeys = jobIds.map((jobId) => this.queue.toKey(jobId));
    const token = randomUUID();
    const reserved = await this.queue.client.eval(
      RESERVE_BULK_JOB_IDS_SCRIPT,
      reservationKeys.length + jobKeys.length,
      ...reservationKeys,
      ...jobKeys,
      String(jobIds.length),
      token,
      String(BULK_RESERVATION_TTL_MS)
    );
    const [ok, reason, index] = reserved as [number, string, number];
    if (ok !== 1) {
      throw new Error(`Bulk enqueue rejected ${jobIds[index - 1] ?? 'unknown'}: ${reason}`);
    }

    try {
      return await this.queue.addBulk(items);
    } catch (error) {
      const jobs = await Promise.all(jobIds.map((jobId) => this.queue.getJob(jobId)));
      await Promise.all(jobs.map((job) => job?.remove()));
      throw error;
    } finally {
      await this.queue.client.eval(
        RELEASE_BULK_JOB_IDS_SCRIPT,
        reservationKeys.length,
        ...reservationKeys,
        token
      );
    }
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
