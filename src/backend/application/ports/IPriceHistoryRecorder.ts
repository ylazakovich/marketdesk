// Application-level port for appending price-history records. No domain repository
// interface exists for price history (it is an audit projection), so the write path
// is expressed as an application port. Group 6 wires a concrete recorder (or a no-op).

import type { ChangedBy } from '../../../shared/types';

export interface PriceHistoryRecord {
  id: string;
  listingId: string;
  oldPrice?: number;
  newPrice: number;
  changedBy: ChangedBy;
  reason?: string;
  createdAt: Date;
}

export interface IPriceHistoryRecorder {
  record(entry: PriceHistoryRecord): Promise<void>;
}
