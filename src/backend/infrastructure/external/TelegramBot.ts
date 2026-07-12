// Telegram notification sender behind an injectable client. The concrete HTTP
// client (calling the Telegram Bot API) is swappable via the TelegramClient
// boundary. When no bot token is configured, a stub client records messages
// instead of sending them.

export interface TelegramMessage {
  chatId: string;
  text: string;
  // Telegram parse mode; defaults to plain text when omitted.
  parseMode?: 'Markdown' | 'MarkdownV2' | 'HTML';
}

export interface TelegramSendResult {
  messageId: number;
  stubbed: boolean;
}

export interface ITelegramNotifier {
  sendMessage(message: TelegramMessage): Promise<TelegramSendResult>;
}

// Low-level client boundary. A real client posts to
// https://api.telegram.org/bot<token>/<method>.
export interface TelegramClient {
  call(method: string, payload: Record<string, unknown>): Promise<{ message_id: number }>;
  readonly stubbed: boolean;
}

export interface TelegramConfig {
  botToken: string;
  defaultChatId: string;
}

export function loadTelegramConfig(): TelegramConfig {
  return {
    botToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
    defaultChatId: process.env.TELEGRAM_CHAT_ID ?? '',
  };
}

export class StubTelegramClient implements TelegramClient {
  readonly stubbed = true;
  readonly calls: Array<{ method: string; payload: Record<string, unknown> }> = [];

  async call(
    method: string,
    payload: Record<string, unknown>,
  ): Promise<{ message_id: number }> {
    this.calls.push({ method, payload });
    return { message_id: this.calls.length };
  }
}

export class TelegramBot implements ITelegramNotifier {
  private readonly client: TelegramClient;
  private readonly defaultChatId: string;

  constructor(client?: TelegramClient, config: TelegramConfig = loadTelegramConfig()) {
    this.client = client ?? new StubTelegramClient();
    this.defaultChatId = config.defaultChatId;
  }

  async sendMessage(message: TelegramMessage): Promise<TelegramSendResult> {
    const chatId = message.chatId || this.defaultChatId;
    if (!chatId) {
      throw new Error('TelegramBot: chatId is required (none provided or configured)');
    }
    if (!message.text?.trim()) {
      throw new Error('TelegramBot: message text is required');
    }
    const payload: Record<string, unknown> = { chat_id: chatId, text: message.text };
    if (message.parseMode) payload.parse_mode = message.parseMode;

    const result = await this.client.call('sendMessage', payload);
    return { messageId: result.message_id, stubbed: this.client.stubbed };
  }
}

// Absent a bot token, return a stubbed notifier.
export function createTelegramBot(client?: TelegramClient): TelegramBot {
  if (client) return new TelegramBot(client);
  return new TelegramBot(new StubTelegramClient());
}
