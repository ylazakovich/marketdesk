const PRELOAD_ERROR_STORAGE_KEY = 'marketdesk:last-preload-error';

interface PreloadErrorEvent extends Event {
  payload?: unknown;
}

interface PreloadRecoveryOptions {
  target?: EventTarget;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  reload?: () => void;
}

function preloadErrorSignature(payload: unknown): string {
  if (payload instanceof Error && payload.message) return payload.message;
  if (typeof payload === 'string' && payload) return payload;
  return 'unknown-vite-preload-error';
}

function handledPreloadErrors(rawValue: string | null): Set<string> {
  if (!rawValue) return new Set();
  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (Array.isArray(parsed) && parsed.every((value) => typeof value === 'string')) {
      return new Set(parsed);
    }
  } catch {
    // Previous builds stored one plain signature instead of a JSON array.
  }
  return new Set([rawValue]);
}

/**
 * Refreshes an already-open tab once when a deployment removes one of the
 * previous build's hashed lazy chunks. Vite emits `vite:preloadError` before
 * the rejected dynamic import reaches React.
 */
export function installPreloadErrorRecovery(options: PreloadRecoveryOptions = {}): () => void {
  const target = options.target ?? window;
  const storage = options.storage ?? window.sessionStorage;
  const reload = options.reload ?? (() => window.location.reload());

  const handlePreloadError = (rawEvent: Event) => {
    const event = rawEvent as PreloadErrorEvent;
    const signature = preloadErrorSignature(event.payload);

    // If the same asset still fails after a refresh, surface the real error
    // instead of creating an infinite reload loop.
    const handled = handledPreloadErrors(storage.getItem(PRELOAD_ERROR_STORAGE_KEY));
    if (handled.has(signature)) return;

    event.preventDefault();
    handled.add(signature);
    storage.setItem(PRELOAD_ERROR_STORAGE_KEY, JSON.stringify([...handled]));
    reload();
  };

  target.addEventListener('vite:preloadError', handlePreloadError);
  return () => target.removeEventListener('vite:preloadError', handlePreloadError);
}

export { PRELOAD_ERROR_STORAGE_KEY };
