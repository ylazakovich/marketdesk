import type { MarketplaceAccountStatus, MarketplaceKey } from '../../../shared/types';
import type { IMarketplaceRepository } from '../../domain/repositories/interfaces/IMarketplaceRepository';
import {
  ConfigurationError,
  InvalidStateError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from '../../domain/shared/DomainError';

export interface OlxOAuthTokens {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  scopes: string[];
  expiresAt: Date;
  accountHandle?: string;
}

export interface MarketplaceAccountRecord {
  id: string;
  marketplaceId: string;
  handle: string;
  credentials: Record<string, unknown>;
  status: MarketplaceAccountStatus;
  scopes: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface MarketplaceAccountRepository {
  findByMarketplaceId(marketplaceId: string): Promise<MarketplaceAccountRecord | null>;
  upsert(
    account: Omit<MarketplaceAccountRecord, 'createdAt' | 'updatedAt'>
  ): Promise<MarketplaceAccountRecord>;
  updateConnectedIfUnchanged(
    account: Omit<MarketplaceAccountRecord, 'createdAt' | 'updatedAt'>,
    expectedUpdatedAt: Date
  ): Promise<MarketplaceAccountRecord | null>;
}

export interface MarketplaceOAuthStateContext {
  marketplaceId: string;
  workspaceId: string;
  providerKey: MarketplaceKey;
  expiresAt: Date;
}

export interface MarketplaceOAuthStateStore {
  save(state: string, context: MarketplaceOAuthStateContext): Promise<void>;
  consume(state: string): Promise<MarketplaceOAuthStateContext | null>;
}

export interface OlxOAuthClientPort {
  buildAuthorizationUrl(state: string): string;
  exchangeAuthorizationCode(code: string): Promise<OlxOAuthTokens>;
  refreshAccessToken(refreshToken: string): Promise<OlxOAuthTokens>;
}

export interface MarketplaceCredentialVault {
  encrypt(tokens: OlxOAuthTokens): Record<string, unknown>;
  decrypt(credentials: Record<string, unknown>): OlxOAuthTokens;
}

export interface MarketplaceOAuthRefreshLock {
  withLock<T>(
    marketplaceId: string,
    operation: (lease: MarketplaceOAuthRefreshLease) => Promise<T>
  ): Promise<T>;
}

export interface MarketplaceOAuthRefreshLease {
  assertOwned(): Promise<void>;
}

export interface MarketplaceOAuthServiceDeps {
  marketplaceRepo: IMarketplaceRepository;
  accountRepo: MarketplaceAccountRepository;
  stateStore: MarketplaceOAuthStateStore;
  oauthClient: OlxOAuthClientPort;
  credentialVault: MarketplaceCredentialVault;
  refreshLock?: MarketplaceOAuthRefreshLock;
  idGenerator: () => string;
  stateGenerator: () => string;
  now?: () => Date;
  stateTtlSeconds?: number;
}

export interface MarketplaceOAuthStatus {
  connected: boolean;
  marketplaceId: string;
  providerKey: MarketplaceKey;
  account: {
    id: string;
    handle: string;
    status: MarketplaceAccountStatus;
    scopes: string[];
  } | null;
  tokenExpiresAt?: string;
  refreshable: boolean;
}

export interface MarketplaceOAuthStartResult {
  authorizationUrl: string;
  state: string;
  expiresAt: string;
}

function requireValue(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new ValidationError(`${name} is required`);
  return trimmed;
}

function normalizeTokens(tokens: OlxOAuthTokens): OlxOAuthTokens {
  return {
    ...tokens,
    accessToken: requireValue(tokens.accessToken, 'OLX access token'),
    tokenType: tokens.tokenType || 'Bearer',
    scopes: [...new Set(tokens.scopes)],
    expiresAt: tokens.expiresAt instanceof Date ? tokens.expiresAt : new Date(tokens.expiresAt),
  };
}

const REFRESH_SKEW_MS = 60_000;

export class MarketplaceOAuthService {
  private readonly now: () => Date;
  private readonly stateTtlSeconds: number;

  constructor(private readonly deps: MarketplaceOAuthServiceDeps) {
    this.now = deps.now ?? (() => new Date());
    this.stateTtlSeconds = deps.stateTtlSeconds ?? 10 * 60;
  }

  async start(input: {
    marketplaceId: string;
    workspaceId: string;
  }): Promise<MarketplaceOAuthStartResult> {
    const marketplace = await this.requireOwnedOlxMarketplace(
      input.marketplaceId,
      input.workspaceId
    );
    const state = requireValue(this.deps.stateGenerator(), 'OAuth state');
    const expiresAt = new Date(this.now().getTime() + this.stateTtlSeconds * 1000);

    await this.deps.stateStore.save(state, {
      marketplaceId: marketplace.id,
      workspaceId: marketplace.workspaceId,
      providerKey: marketplace.key,
      expiresAt,
    });

    return {
      authorizationUrl: this.deps.oauthClient.buildAuthorizationUrl(state),
      state,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async complete(input: {
    providerKey: string;
    code: string;
    state: string;
  }): Promise<MarketplaceOAuthStatus> {
    const code = requireValue(input.code, 'OAuth authorization code');
    const state = requireValue(input.state, 'OAuth state');
    const context = await this.deps.stateStore.consume(state);
    if (!context || context.expiresAt.getTime() <= this.now().getTime()) {
      throw new InvalidStateError('OAuth state is invalid, expired, or already used');
    }
    if (context.providerKey !== input.providerKey) {
      throw new InvalidStateError('OAuth provider does not match the pending connection');
    }

    const marketplace = await this.requireOwnedOlxMarketplace(
      context.marketplaceId,
      context.workspaceId
    );

    let tokens: OlxOAuthTokens;
    try {
      tokens = normalizeTokens(await this.deps.oauthClient.exchangeAuthorizationCode(code));
    } catch (error) {
      if (
        error instanceof ValidationError ||
        error instanceof InvalidStateError ||
        error instanceof ConfigurationError
      ) {
        throw error;
      }
      throw new ServiceUnavailableError('OLX token exchange failed', error);
    }

    const existing = await this.deps.accountRepo.findByMarketplaceId(marketplace.id);
    const account = await this.deps.accountRepo.upsert({
      id: existing?.id ?? this.deps.idGenerator(),
      marketplaceId: marketplace.id,
      handle: tokens.accountHandle?.trim() || existing?.handle || 'OLX account',
      credentials: this.deps.credentialVault.encrypt(tokens),
      status: 'connected',
      scopes: [...tokens.scopes],
    });

    // The local marketplace flag becomes true only after credentials were encrypted
    // and durably persisted in marketplace_accounts.
    marketplace.connect();
    await this.deps.marketplaceRepo.save(marketplace);
    return this.toStatus(
      marketplace.id,
      marketplace.key,
      marketplace.isConnected(),
      account,
      tokens
    );
  }

  async check(input: {
    marketplaceId: string;
    workspaceId: string;
  }): Promise<MarketplaceOAuthStatus> {
    const marketplace = await this.requireOwnedOlxMarketplace(
      input.marketplaceId,
      input.workspaceId
    );
    const account = await this.deps.accountRepo.findByMarketplaceId(marketplace.id);
    if (!account) {
      return this.toStatus(marketplace.id, marketplace.key, marketplace.isConnected(), null, null);
    }

    if (account.status !== 'connected') {
      return this.toStatus(
        marketplace.id,
        marketplace.key,
        marketplace.isConnected(),
        account,
        null
      );
    }

    try {
      const tokens = normalizeTokens(this.deps.credentialVault.decrypt(account.credentials));
      return this.toStatus(
        marketplace.id,
        marketplace.key,
        marketplace.isConnected(),
        account,
        tokens
      );
    } catch {
      return this.toStatus(
        marketplace.id,
        marketplace.key,
        marketplace.isConnected(),
        { ...account, status: 'error' },
        null
      );
    }
  }

  async disconnect(input: { marketplaceId: string; workspaceId: string }): Promise<void> {
    const marketplace = await this.requireOwnedOlxMarketplace(
      input.marketplaceId,
      input.workspaceId
    );
    const disconnect = async (lease?: MarketplaceOAuthRefreshLease): Promise<void> => {
      const account = await this.deps.accountRepo.findByMarketplaceId(marketplace.id);
      await lease?.assertOwned();
      if (account) {
        await this.deps.accountRepo.upsert({
          id: account.id,
          marketplaceId: account.marketplaceId,
          handle: account.handle,
          credentials: {},
          status: 'disconnected',
          scopes: account.scopes,
        });
      }
      marketplace.disconnect();
      await this.deps.marketplaceRepo.save(marketplace);
    };
    if (this.deps.refreshLock) {
      await this.deps.refreshLock.withLock(marketplace.id, disconnect);
    } else {
      await disconnect();
    }
  }

  async getValidAccessToken(marketplaceId: string): Promise<string> {
    const account = await this.deps.accountRepo.findByMarketplaceId(marketplaceId);
    if (!account || account.status !== 'connected') {
      throw new InvalidStateError('OLX account is not connected');
    }

    const tokens = this.decryptTokens(account);
    if (tokens.expiresAt.getTime() > this.now().getTime() + REFRESH_SKEW_MS) {
      return tokens.accessToken;
    }

    const refresh = (lease?: MarketplaceOAuthRefreshLease) =>
      this.refreshAccessToken(marketplaceId, lease);
    return this.deps.refreshLock
      ? this.deps.refreshLock.withLock(marketplaceId, refresh)
      : refresh();
  }

  private async refreshAccessToken(
    marketplaceId: string,
    lease?: MarketplaceOAuthRefreshLease
  ): Promise<string> {
    const account = await this.deps.accountRepo.findByMarketplaceId(marketplaceId);
    if (!account || account.status !== 'connected') {
      throw new InvalidStateError('OLX account is not connected');
    }

    // Another worker may have refreshed while this worker waited for the lock.
    const tokens = this.decryptTokens(account);
    if (tokens.expiresAt.getTime() > this.now().getTime() + REFRESH_SKEW_MS) {
      return tokens.accessToken;
    }
    if (!tokens.refreshToken) {
      throw new InvalidStateError('OLX access token expired and no refresh token is available');
    }

    let refreshed: OlxOAuthTokens;
    try {
      refreshed = normalizeTokens(
        await this.deps.oauthClient.refreshAccessToken(tokens.refreshToken)
      );
    } catch (error) {
      if (error instanceof ConfigurationError) throw error;
      throw new ServiceUnavailableError('OLX token refresh failed', error);
    }
    if (!refreshed.refreshToken) refreshed.refreshToken = tokens.refreshToken;

    await lease?.assertOwned();
    const saved = await this.deps.accountRepo.updateConnectedIfUnchanged(
      {
        id: account.id,
        marketplaceId: account.marketplaceId,
        handle: refreshed.accountHandle?.trim() || account.handle,
        credentials: this.deps.credentialVault.encrypt(refreshed),
        status: 'connected',
        scopes: refreshed.scopes,
      },
      account.updatedAt
    );
    if (!saved) {
      throw new InvalidStateError('OLX account changed while its access token was refreshing');
    }
    return refreshed.accessToken;
  }

  private decryptTokens(account: MarketplaceAccountRecord): OlxOAuthTokens {
    try {
      return normalizeTokens(this.deps.credentialVault.decrypt(account.credentials));
    } catch (error) {
      if (error instanceof ConfigurationError) throw error;
      throw new InvalidStateError('OLX credentials cannot be decrypted; reconnect is required');
    }
  }

  private async requireOwnedOlxMarketplace(marketplaceId: string, workspaceId: string) {
    const marketplace = await this.deps.marketplaceRepo.findByIdForWorkspace(
      marketplaceId,
      workspaceId
    );
    if (!marketplace) {
      throw new NotFoundError(`Marketplace not found: ${marketplaceId}`);
    }
    if (marketplace.key !== 'olx') {
      throw new ValidationError(`OAuth is not implemented for marketplace: ${marketplace.key}`);
    }
    return marketplace;
  }

  private toStatus(
    marketplaceId: string,
    providerKey: MarketplaceKey,
    marketplaceConnected: boolean,
    account: MarketplaceAccountRecord | null,
    tokens: OlxOAuthTokens | null
  ): MarketplaceOAuthStatus {
    const connected = marketplaceConnected && account?.status === 'connected' && tokens !== null;
    return {
      connected,
      marketplaceId,
      providerKey,
      account: account
        ? {
            id: account.id,
            handle: account.handle,
            status: account.status,
            scopes: [...account.scopes],
          }
        : null,
      tokenExpiresAt: tokens?.expiresAt.toISOString(),
      refreshable: Boolean(tokens?.refreshToken),
    };
  }
}
