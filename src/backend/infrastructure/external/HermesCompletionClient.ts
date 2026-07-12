// Hermes API Server-backed implementation of the AITextCompletionClient boundary.
//
// The MarketDesk app runs in Docker and calls the Hermes Agent gateway/API server
// on the same VPS. Hermes then decides which configured model/provider/tools to
// use; MarketDesk no longer owns a direct Claude/Anthropic integration.

import type {
  AITextCompletionClient,
  AICompletionRequest,
  HermesAIConfig,
} from './HermesAI';
import { loadHermesConfig } from './HermesAI';

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
}

export class HermesCompletionClient implements AITextCompletionClient {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly defaultMaxTokens: number;
  private readonly timeoutMs: number;

  constructor(config: HermesAIConfig = loadHermesConfig()) {
    this.apiUrl = config.apiUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.defaultMaxTokens = config.maxTokens;
    this.timeoutMs = config.timeoutMs;
  }

  async complete(request: AICompletionRequest): Promise<string> {
    try {
      const response = await fetch(`${this.apiUrl}/chat/completions`, {
        method: 'POST',
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
          ...(request.sessionKey ? { 'X-Hermes-Session-Key': request.sessionKey } : {}),
        },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          max_tokens: request.maxTokens ?? this.defaultMaxTokens,
          messages: [
            { role: 'system', content: this.withJsonSchemaInstruction(request) },
            { role: 'user', content: request.prompt },
          ],
        }),
      });

      const body = await this.parseResponseBody(response);
      if (!response.ok) {
        const message = body.error?.message || `Hermes API request failed with ${response.status}`;
        throw new Error(message);
      }

      const content = body.choices?.[0]?.message?.content?.trim();
      if (!content) {
        throw new Error('Hermes API response did not include assistant content');
      }
      return content;
    } catch (error) {
      if (this.isTimeoutError(error)) {
        throw new Error(`Hermes API request timed out after ${this.timeoutMs}ms`);
      }
      throw error;
    }
  }

  private async parseResponseBody(response: Response): Promise<ChatCompletionResponse> {
    try {
      return (await response.json()) as ChatCompletionResponse;
    } catch {
      if (response.ok) {
        throw new Error('Hermes API returned a non-JSON success response');
      }
      return {};
    }
  }

  private isTimeoutError(error: unknown): boolean {
    return error instanceof DOMException
      ? error.name === 'TimeoutError' || error.name === 'AbortError'
      : error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
  }

  private withJsonSchemaInstruction(request: AICompletionRequest): string {
    if (!request.jsonSchema) return request.system;

    return [
      request.system,
      'Return only valid JSON. Do not include markdown fences, comments, prose, or extra keys.',
      `The JSON must match this schema: ${JSON.stringify(request.jsonSchema)}.`,
    ].join('\n');
  }
}
