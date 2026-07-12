import {
  EmailProvider,
  StubEmailTransport,
  EmailTransport,
  SendGridHttpTransport,
  createEmailProvider,
  type FetchLike,
} from '../EmailProvider';
import { TelegramBot, StubTelegramClient } from '../TelegramBot';

describe('EmailProvider', () => {
  it('sends through the injected transport, applying the default from address', async () => {
    const transport = new StubEmailTransport();
    const provider = new EmailProvider(transport, { defaultFrom: 'noreply@x.test' });

    const result = await provider.send({
      to: 'user@x.test',
      subject: 'Hi',
      text: 'hello',
    });

    expect(result.accepted).toBe(true);
    expect(result.stubbed).toBe(true);
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0].from).toBe('noreply@x.test');
  });

  it('rejects a message without a recipient', async () => {
    const provider = new EmailProvider(new StubEmailTransport());
    await expect(
      provider.send({ to: '', subject: 's', text: 't' }),
    ).rejects.toThrow(/recipient/);
  });

  it('reports stubbed=false when a real (non-stub) transport is used', async () => {
    const realish: EmailTransport = {
      stubbed: false,
      send: async () => ({ id: 'real-1' }),
    };
    const provider = new EmailProvider(realish);
    const result = await provider.send({ to: 'a@b.c', subject: 's', text: 't' });
    expect(result.stubbed).toBe(false);
    expect(result.id).toBe('real-1');
  });
});

describe('SendGridHttpTransport (C3 real transport)', () => {
  it('POSTs to the SendGrid API and returns the message id; reports non-stub', async () => {
    const calls: Array<{ url: string; init: unknown }> = [];
    const fakeFetch: FetchLike = async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 202,
        text: async () => '',
        headers: { get: (n: string) => (n === 'x-message-id' ? 'sg-123' : null) },
      };
    };
    const transport = new SendGridHttpTransport('SG.key', fakeFetch);
    const provider = new EmailProvider(transport, { defaultFrom: 'from@x.test' });

    const result = await provider.send({ to: 'to@x.test', subject: 'hi', text: 'hello' });

    expect(result.accepted).toBe(true);
    expect(result.stubbed).toBe(false);
    expect(result.id).toBe('sg-123');
    expect(calls[0].url).toBe('https://api.sendgrid.com/v3/mail/send');
  });

  it('throws (never claims delivered) on a non-2xx SendGrid response', async () => {
    const fakeFetch: FetchLike = async () => ({
      ok: false,
      status: 401,
      text: async () => 'unauthorized',
      headers: { get: () => null },
    });
    const transport = new SendGridHttpTransport('SG.bad', fakeFetch);
    const provider = new EmailProvider(transport);
    await expect(
      provider.send({ to: 'to@x.test', subject: 'hi', text: 'hello' }),
    ).rejects.toThrow(/SendGrid send failed: 401/);
  });
});

describe('createEmailProvider factory (C3)', () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('warns and falls back to stub when only SMTP_URL is set (no silent delivery)', async () => {
    delete process.env.SENDGRID_API_KEY;
    process.env.SMTP_URL = 'smtp://user:pass@smtp.example.com:587';
    const warn = jest.fn();
    const provider = createEmailProvider(undefined, { logger: { warn } });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/NOT delivered/);
    // The stub does not pretend to deliver — result.stubbed is true.
    const result = await provider.send({ to: 'a@b.c', subject: 's', text: 't' });
    expect(result.stubbed).toBe(true);
  });

  it('stubs quietly when no email credentials are configured', async () => {
    delete process.env.SENDGRID_API_KEY;
    delete process.env.SMTP_URL;
    const warn = jest.fn();
    const provider = createEmailProvider(undefined, { logger: { warn } });
    expect(warn).not.toHaveBeenCalled();
    const result = await provider.send({ to: 'a@b.c', subject: 's', text: 't' });
    expect(result.stubbed).toBe(true);
  });
});

describe('TelegramBot', () => {
  it('sends via the injected client and returns the message id', async () => {
    const client = new StubTelegramClient();
    const bot = new TelegramBot(client, { botToken: '', defaultChatId: '999' });

    const result = await bot.sendMessage({ chatId: '', text: 'ping', parseMode: 'Markdown' });

    expect(result.messageId).toBe(1);
    expect(result.stubbed).toBe(true);
    expect(client.calls[0].method).toBe('sendMessage');
    expect(client.calls[0].payload).toMatchObject({
      chat_id: '999',
      text: 'ping',
      parse_mode: 'Markdown',
    });
  });

  it('throws when no chatId is provided or configured', async () => {
    const bot = new TelegramBot(new StubTelegramClient(), { botToken: '', defaultChatId: '' });
    await expect(bot.sendMessage({ chatId: '', text: 'x' })).rejects.toThrow(/chatId/);
  });
});
