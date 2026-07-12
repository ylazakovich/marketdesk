// Marketplace aggregate root. Per ARCHITECTURE.md §3/§7. A marketplace must be
// connected before a listing can be published to it.

import { Result, Ok, Err } from '../shared/Result';
import { ValidationError } from '../shared/DomainError';
import type { MarketplaceKey, SyncMode } from '../../../shared/types';
import { MARKETPLACE_KEY_LIST, SYNC_MODE_LIST } from '../../../shared/constants';

export interface CreateMarketplaceProps {
  id: string;
  workspaceId: string;
  key: MarketplaceKey;
  name: string;
  connected?: boolean;
  syncMode?: SyncMode;
  lastSyncAt?: Date | null;
  errorCount?: number;
  capacity?: number;
  createdAt?: Date;
}

export class Marketplace {
  private constructor(
    public readonly id: string,
    public readonly workspaceId: string,
    public readonly key: MarketplaceKey,
    private _name: string,
    private _connected: boolean,
    private _syncMode: SyncMode,
    private _lastSyncAt: Date | null,
    private _errorCount: number,
    private _capacity: number,
    public readonly createdAt: Date,
  ) {}

  static create(props: CreateMarketplaceProps): Result<Marketplace> {
    if (!props.id?.trim()) {
      return Err(new ValidationError('Marketplace id is required'));
    }
    if (!props.workspaceId?.trim()) {
      return Err(new ValidationError('Marketplace workspaceId is required'));
    }
    if (!MARKETPLACE_KEY_LIST.includes(props.key)) {
      return Err(new ValidationError(`Unsupported marketplace key: ${props.key}`));
    }
    if (!props.name?.trim()) {
      return Err(new ValidationError('Marketplace name is required'));
    }
    const syncMode = props.syncMode ?? 'manual';
    if (!SYNC_MODE_LIST.includes(syncMode)) {
      return Err(new ValidationError(`Invalid sync mode: ${syncMode}`));
    }
    const capacity = props.capacity ?? 100;
    if (capacity < 0) {
      return Err(new ValidationError('capacity must be >= 0'));
    }

    return Ok(
      new Marketplace(
        props.id,
        props.workspaceId,
        props.key,
        props.name.trim(),
        props.connected ?? false,
        syncMode,
        props.lastSyncAt ?? null,
        props.errorCount ?? 0,
        capacity,
        props.createdAt ?? new Date(),
      ),
    );
  }

  // --- Getters ---
  get name(): string {
    return this._name;
  }
  get syncMode(): SyncMode {
    return this._syncMode;
  }
  get lastSyncAt(): Date | null {
    return this._lastSyncAt;
  }
  get errorCount(): number {
    return this._errorCount;
  }
  get capacity(): number {
    return this._capacity;
  }

  // --- Behavior ---
  isConnected(): boolean {
    return this._connected;
  }

  connect(): void {
    this._connected = true;
  }

  disconnect(): void {
    this._connected = false;
  }

  setSyncMode(mode: SyncMode): Result<void> {
    if (!SYNC_MODE_LIST.includes(mode)) {
      return Err(new ValidationError(`Invalid sync mode: ${mode}`));
    }
    this._syncMode = mode;
    return Ok(undefined);
  }

  recordSyncSuccess(at: Date = new Date()): void {
    this._lastSyncAt = at;
    this._errorCount = 0;
  }

  recordSyncError(): void {
    this._errorCount += 1;
  }

  isAtCapacity(currentLiveListings: number): boolean {
    return currentLiveListings >= this._capacity;
  }
}
