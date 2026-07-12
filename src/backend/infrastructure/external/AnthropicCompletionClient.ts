// Anthropic-SDK-backed implementation of the AITextCompletionClient boundary.
// This is the ONLY file that imports the Anthropic SDK, keeping the LLM vendor
// dependency isolated behind the thin completion interface that ClaudeAI depends
// on. The model id and API key come from config/env (never hardcoded).

import Anthropic from '@anthropic-ai/sdk';
import type {
  AITextCompletionClient,
  AICompletionRequest,
  ClaudeAIConfig,
} from './ClaudeAI';
import { loadClaudeConfig } from './ClaudeAI';

// Minimal structural view of a Messages API response — decouples us from exact
// SDK type churn across versions while still being type-safe on what we read.
interface MessageContentBlock {
  type: string;
  text?: string;
}
interface MessageResponse {
  content: MessageContentBlock[];
}

export class AnthropicCompletionClient implements AITextCompletionClient {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly defaultMaxTokens: number;

  constructor(config: ClaudeAIConfig = loadClaudeConfig(), client?: Anthropic) {
    this.model = config.model;
    this.defaultMaxTokens = config.maxTokens;
    // The SDK also reads ANTHROPIC_API_KEY from the environment; passing it
    // explicitly keeps CLAUDE_API_KEY as the canonical source for this app.
    this.client = client ?? new Anthropic({ apiKey: config.apiKey || undefined });
  }

  async complete(request: AICompletionRequest): Promise<string> {
    const params: Record<string, unknown> = {
      model: this.model,
      max_tokens: request.maxTokens ?? this.defaultMaxTokens,
      system: request.system,
      messages: [{ role: 'user', content: request.prompt }],
    };
    if (request.jsonSchema) {
      params.output_config = {
        format: { type: 'json_schema', schema: request.jsonSchema },
      };
    }

    // Cast at the SDK boundary: params are validated by the API, and this keeps
    // us resilient to minor SDK type differences (output_config, etc.).
    const response = (await this.client.messages.create(
      params as never,
    )) as unknown as MessageResponse;

    return response.content
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text as string)
      .join('')
      .trim();
  }
}
