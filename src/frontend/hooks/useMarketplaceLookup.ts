// Resolves a marketplace id to its human-readable name, backed by the
// marketplaces list query. Falls back to the raw id while loading / on miss.
import { useCallback, useMemo } from 'react';
import { useMarketplaces } from '../services/hooks/index.js';
import { MARKETPLACE_NAMES } from '@shared/constants';

export function useMarketplaceLookup() {
  const { data: marketplaces } = useMarketplaces();

  const byId = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of marketplaces ?? []) {
      map.set(m.id, m.name || MARKETPLACE_NAMES[m.key] || m.key);
    }
    return map;
  }, [marketplaces]);

  const resolveMarketplaceName = useCallback(
    (marketplaceId: string) => byId.get(marketplaceId) ?? marketplaceId,
    [byId],
  );

  return { marketplaces, resolveMarketplaceName };
}
