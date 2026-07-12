// Email delivery behind an injectable transport. The domain/application layers
// depend on IEmailProvider; the concrete send mechanism (SendGrid, SMTP, ...) is
// swappable via the EmailTransport boundary. When no credentials are configured
// the provider falls back to a stub transport that records messages instead of
// sending them — safe for local/dev/test.

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  from?: string;
}

export interface EmailSendResult {
  id: string;
  accepted: boolean;
  // True when the message was handled by the stub (no real delivery).
  stubbed: boolean;
}

export interface IEmailProvider {
  send(message: EmailMessage): Promise<EmailSendResult>;
}

// Low-level transport. A real SendGrid/SMTP transport implements this and is
// injected in Group 6 DI.
export interface EmailTransport {
  send(message: Required<Pick<EmailMessage, 'from' | 'to' | 'subject' | 'text'>> & EmailMessage): Promise<{ id: string }>;
  readonly stubbed: boolean;
}

export interface EmailProviderConfig {
  defaultFrom: string;
}

export function loadEmailConfig(): EmailProviderConfig {
  return {
    defaultFrom: process.env.EMAIL_FROM ?? 'no-reply@marketdesk.local',
  };
}

// Minimal HTTP client shape so the SendGrid transport is testable without a
// real network call (tests inject a fake).
export interface FetchLike {
  (
    url: string,
    init: {
      method: string;
      headers: Record<string, string>;
      body: string;
    },
  ): Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
    headers: { get(name: string): string | null };
  }>;
}

// Real SendGrid transport (HTTP v3 mail/send). Used when SENDGRID_API_KEY is
// configured. Throws on a non-2xx response so a failed send is never reported as
// accepted (C3).
export class SendGridHttpTransport implements EmailTransport {
  readonly stubbed = false;

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
  ) {}

  async send(
    message: Required<Pick<EmailMessage, 'from' | 'to' | 'subject' | 'text'>> & EmailMessage,
  ): Promise<{ id: string }> {
    const content = [{ type: 'text/plain', value: message.text }];
    if (message.html) content.push({ type: 'text/html', value: message.html });
    const res = await this.fetchImpl('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: message.to }] }],
        from: { email: message.from },
        subject: message.subject,
        content,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`SendGrid send failed: ${res.status} ${detail}`.trim());
    }
    return { id: res.headers.get('x-message-id') ?? `sendgrid-${Date.now()}` };
  }
}

// Records sent messages in memory instead of delivering them. Used when no
// email credentials are present.
export class StubEmailTransport implements EmailTransport {
  readonly stubbed = true;
  readonly sent: EmailMessage[] = [];

  async send(
    message: Required<Pick<EmailMessage, 'from' | 'to' | 'subject' | 'text'>> & EmailMessage,
  ): Promise<{ id: string }> {
    this.sent.push(message);
    return { id: `stub-email-${this.sent.length}` };
  }
}

export class EmailProvider implements IEmailProvider {
  private readonly transport: EmailTransport;
  private readonly defaultFrom: string;

  constructor(transport?: EmailTransport, config: EmailProviderConfig = loadEmailConfig()) {
    this.transport = transport ?? new StubEmailTransport();
    this.defaultFrom = config.defaultFrom;
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    if (!message.to?.trim()) {
      throw new Error('EmailProvider: recipient "to" is required');
    }
    if (!message.subject?.trim()) {
      throw new Error('EmailProvider: "subject" is required');
    }
    const result = await this.transport.send({
      ...message,
      from: message.from ?? this.defaultFrom,
    });
    return { id: result.id, accepted: true, stubbed: this.transport.stubbed };
  }
}

export interface CreateEmailProviderOptions {
  logger?: { warn: (msg: string) => void };
}

// Choose a transport based on available credentials (C3):
//   - explicit transport injected  -> use it
//   - SENDGRID_API_KEY set          -> real SendGrid HTTP transport (delivers)
//   - SMTP_URL set (no SMTP client bundled) -> stub, but LOG A WARNING so it is
//     never silently treated as delivered
//   - no credentials                -> stub (safe for local/dev/test)
export function createEmailProvider(
  transport?: EmailTransport,
  options: CreateEmailProviderOptions = {},
): EmailProvider {
  if (transport) return new EmailProvider(transport);

  const sendgridKey = process.env.SENDGRID_API_KEY;
  if (sendgridKey) {
    return new EmailProvider(new SendGridHttpTransport(sendgridKey));
  }

  const logger = options.logger ?? console;
  if (process.env.SMTP_URL) {
    logger.warn(
      'EmailProvider: SMTP_URL is set but no SMTP transport is bundled; ' +
        'falling back to the stub transport — emails are NOT delivered. ' +
        'Configure SENDGRID_API_KEY or inject a concrete EmailTransport.',
    );
  }
  return new EmailProvider(new StubEmailTransport());
}
