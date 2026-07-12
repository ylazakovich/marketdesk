// Application read port for price history. The write path is expressed as
// IPriceHistoryRecorder; this is its read counterpart, needed by the presentation
// layer (GET /listings/:id/price-history). Group 6 wires a concrete reader backed by
// the `price_history` table (see PriceHistoryRepository).

import type { PriceHistory } from '../../../shared/types';

export interface IPriceHistoryReader {
  findByListing(listingId: string): Promise<PriceHistory[]>;
}
