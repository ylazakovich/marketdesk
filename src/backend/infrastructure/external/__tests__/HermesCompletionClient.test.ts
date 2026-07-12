import { HermesCompletionClient } from '../HermesCompletionClient';

const originalFetch = globalThis.fetch;

describe('HermesCompletionClient', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('posts OpenAI-compatible chat completions to Hermes API Server', async () => {
    const fetchMock = jest.fn<Promise<Response>, [string | URL, RequestInit?]>(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '  Done  ' } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const client = new HermesCompletionClient({
      apiUrl: 'http://host.docker.internal:8642/v1/',
      apiKey: 'secret-key',
      model: 'hermes-agent',
      maxTokens: 123,
      timeoutMs: 5000,
    });

    const result = await client.complete({
      system: 'System prompt',
      prompt: 'User prompt',
      jsonSchema: { type: 'object', required: ['ok'] },
    });

    expect(result).toBe('Done');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://host.docker.internal:8642/v1/chat/completions');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer secret-key',
    });
    expect(init?.headers).not.toHaveProperty('X-Hermes-Session-Key');

    const body = JSON.parse(init?.body as string);
    expect(body.model).toBe('hermes-agent');
    expect(body.max_tokens).toBe(123);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toContain('Return only valid JSON');
    expect(body.messages[1]).toEqual({ role: 'user', content: 'User prompt' });
  });

  it('throws a redacted high-level error when Hermes returns an error response', async () => {
    globalThis.fetch = jest.fn(async () =>
      new Response(JSON.stringify({ error: { message: 'Hermes unavailable' } }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as typeof fetch;

    const client = new HermesCompletionClient({
      apiUrl: 'http://127.0.0.1:8642/v1',
      apiKey: '',
      model: 'hermes-agent',
      maxTokens: 123,
      timeoutMs: 5000,
    });

    await expect(client.complete({ system: 's', prompt: 'p' })).rejects.toThrow(
      'Hermes unavailable',
    );
  });

  it('throws when a successful Hermes response has no assistant content', async () => {
    globalThis.fetch = jest.fn(async () =>
      new Response(JSON.stringify({ choices: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as typeof fetch;

    const client = new HermesCompletionClient({
      apiUrl: 'http://127.0.0.1:8642/v1',
      apiKey: '',
      model: 'hermes-agent',
      maxTokens: 123,
      timeoutMs: 5000,
    });

    await expect(client.complete({ system: 's', prompt: 'p' })).rejects.toThrow(
      'Hermes API response did not include assistant content',
    );
  });

  it('throws when a successful Hermes response is not JSON', async () => {
    globalThis.fetch = jest.fn(async () =>
      new Response('not json', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      }),
    ) as typeof fetch;

    const client = new HermesCompletionClient({
      apiUrl: 'http://127.0.0.1:8642/v1',
      apiKey: '',
      model: 'hermes-agent',
      maxTokens: 123,
      timeoutMs: 5000,
    });

    await expect(client.complete({ system: 's', prompt: 'p' })).rejects.toThrow(
      'Hermes API returned a non-JSON success response',
    );
  });

  it('sends a Hermes session key only when request scope is provided', async () => {
    const fetchMock = jest.fn<Promise<Response>, [string | URL, RequestInit?]>(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const client = new HermesCompletionClient({
      apiUrl: 'http://127.0.0.1:8642/v1',
      apiKey: 'secret-key',
      model: 'hermes-agent',
      maxTokens: 123,
      timeoutMs: 5000,
    });

    await client.complete({ system: 's', prompt: 'p', sessionKey: 'workspace:42:user:7' });

    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      'X-Hermes-Session-Key': 'workspace:42:user:7',
    });
  });

  it('throws a clear error when the Hermes request times out', async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new DOMException('The operation timed out', 'TimeoutError');
    }) as typeof fetch;

    const client = new HermesCompletionClient({
      apiUrl: 'http://127.0.0.1:8642/v1',
      apiKey: '',
      model: 'hermes-agent',
      maxTokens: 123,
      timeoutMs: 50,
    });

    await expect(client.complete({ system: 's', prompt: 'p' })).rejects.toThrow(
      'Hermes API request timed out after 50ms',
    );
  });
});
