export type SafeErrorDetails = {
  name: string;
  message: string;
  code?: string;
  syscall?: string;
  address?: string;
  port?: number | string;
};

function redact(text: string, sensitiveValues: readonly (string | undefined)[]): string {
  let result = text;
  for (const value of sensitiveValues) {
    if (value) result = result.split(value).join('[redacted]');
  }

  return result
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'`]+/gi, '[redacted-connection-string]')
    .replace(/\b(password|pass|pwd)\s*[=:]\s*[^\s,;]+/gi, '$1=[redacted]');
}

export function safeErrorDetails(
  error: unknown,
  sensitiveValues: readonly (string | undefined)[] = [],
): SafeErrorDetails {
  if (!(error instanceof Error)) {
    return { name: 'Error', message: 'Unknown startup error' };
  }

  const systemError = error as NodeJS.ErrnoException & {
    address?: unknown;
    port?: unknown;
  };
  const details: SafeErrorDetails = {
    name: error.name,
    message: redact(error.message, sensitiveValues),
  };
  if (typeof systemError.code === 'string') details.code = systemError.code;
  if (typeof systemError.syscall === 'string') details.syscall = systemError.syscall;
  if (typeof systemError.address === 'string') details.address = systemError.address;
  if (typeof systemError.port === 'number' || typeof systemError.port === 'string') {
    details.port = systemError.port;
  }
  return details;
}