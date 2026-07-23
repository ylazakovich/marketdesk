import { BullJobQueue } from '../BullJobQueue';

const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const runRedisTests = process.env.SKIP_REDIS_TESTS === 'true' ? describe.skip : describe;

type Payload = { value: string };

runRedisTests('BullJobQueue bulk enqueue reservations', () => {
  let queue: BullJobQueue<Payload>;
  let counter = 0;

  beforeEach(() => {
    counter += 1;
    queue = new BullJobQueue<Payload>(`bulk-${process.pid}-${counter}`, {
      redisUrl,
      prefix: `md:test:${process.pid}:${Date.now()}:${counter}`,
      defaultJobOptions: { attempts: 1, removeOnComplete: false, removeOnFail: false },
    });
  });

  afterEach(async () => {
    if (!queue) return;
    await queue.raw.obliterate({ force: true });
    await queue.close();
  });

  it('accepts a unique custom-id batch against Redis', async () => {
    await queue.addBulk([
      { data: { value: 'first' }, opts: { jobId: 'job:first' } },
      { data: { value: 'second' }, opts: { jobId: 'job:second' } },
    ]);

    await expect(queue.raw.getJob('job:first')).resolves.not.toBeNull();
    await expect(queue.raw.getJob('job:second')).resolves.not.toBeNull();
    await expect(queue.raw.getJobCounts()).resolves.toMatchObject({ waiting: 2 });
  });

  it('rejects a duplicate existing job id without accepting any new batch jobs', async () => {
    await queue.add({ value: 'existing' }, { jobId: 'job:duplicate' });

    await expect(
      queue.addBulk([
        { data: { value: 'duplicate' }, opts: { jobId: 'job:duplicate' } },
        { data: { value: 'new' }, opts: { jobId: 'job:new' } },
      ])
    ).rejects.toThrow('existing_job');

    await expect(queue.raw.getJob('job:duplicate')).resolves.not.toBeNull();
    await expect(queue.raw.getJob('job:new')).resolves.toBeNull();
    await expect(queue.raw.getJobCounts()).resolves.toMatchObject({ waiting: 1 });
  });

  it('rejects duplicate ids inside one batch before accepting any job', async () => {
    await expect(
      queue.addBulk([
        { data: { value: 'first' }, opts: { jobId: 'job:same' } },
        { data: { value: 'second' }, opts: { jobId: 'job:same' } },
      ])
    ).rejects.toThrow('unique jobIds');

    await expect(queue.raw.getJob('job:same')).resolves.toBeNull();
    await expect(queue.raw.getJobCounts()).resolves.toMatchObject({ waiting: 0 });
  });

  it('compensates already accepted jobs if Bull reports a mid-batch failure', async () => {
    const originalAddBulk = queue.raw.addBulk.bind(queue.raw);
    jest.spyOn(queue.raw, 'addBulk').mockImplementationOnce(async (items) => {
      await originalAddBulk([items[0]]);
      throw new Error('simulated mid-batch failure');
    });

    await expect(
      queue.addBulk([
        { data: { value: 'first' }, opts: { jobId: 'job:first' } },
        { data: { value: 'second' }, opts: { jobId: 'job:second' } },
      ])
    ).rejects.toThrow('simulated mid-batch failure');

    await expect(queue.raw.getJob('job:first')).resolves.toBeNull();
    await expect(queue.raw.getJob('job:second')).resolves.toBeNull();
    await expect(queue.raw.getJobCounts()).resolves.toMatchObject({ waiting: 0 });
  });
});
