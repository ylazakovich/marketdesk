import { Product } from '../../../domain/entities/Product';
import { Money } from '../../../domain/valueObjects/Money';
import type {
  ProductCategoryProvenance,
  ProductCategorySource,
  ProductCondition,
  ProductStatus,
} from '../../../../shared/types';
import type { ProductImageRow, ProductRow, ProductTagRow } from './rows';
import { toDate, toNumber, unwrapPersisted } from './support';

function parseSource(value: unknown): ProductCategorySource | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const strings = ['marketplaceId', 'listingId', 'providerCategoryId', 'name', 'taxonomyVerifiedAt', 'syncedAt'];
  if (source.marketplaceKey !== 'olx' || strings.some((key) => typeof source[key] !== 'string' || !(source[key] as string).trim())) return null;
  if (!Array.isArray(source.path) || source.path.length === 0 || source.path.some((part) => typeof part !== 'string' || !part.trim())) return null;
  if (Number.isNaN(Date.parse(source.taxonomyVerifiedAt as string)) || Number.isNaN(Date.parse(source.syncedAt as string))) return null;
  return source as unknown as ProductCategorySource;
}

function parseSources(value: unknown): ProductCategorySource[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const parsed = value.map(parseSource);
  return parsed.every((source): source is ProductCategorySource => source !== null) ? parsed : null;
}

function parseCategoryProvenance(value: unknown): ProductCategoryProvenance | null {
  if (!value || typeof value !== 'object') return null;
  const provenance = value as Record<string, unknown>;
  if (provenance.status === 'synced') {
    const sources = parseSources(provenance.sources);
    return sources ? { status: 'synced', sources } : null;
  }
  if (provenance.status === 'conflict') {
    const candidates = parseSources(provenance.candidates);
    const currentSources = provenance.currentSources === null
      ? null
      : parseSources(provenance.currentSources);
    if (!candidates || (provenance.currentSources !== null && !currentSources)
      || typeof provenance.detectedAt !== 'string' || Number.isNaN(Date.parse(provenance.detectedAt))) return null;
    return { status: 'conflict', currentSources, candidates, detectedAt: provenance.detectedAt };
  }
  return null;
}

export const ProductMapper = {
  // Reconstitute a Product aggregate from its own row plus its child rows.
  toDomain(row: ProductRow, tagRows: ProductTagRow[], imageRows: ProductImageRow[]): Product {
    const costPrice =
      row.cost_price === null
        ? null
        : unwrapPersisted(Money.of(toNumber(row.cost_price), row.currency));
    const sellingPrice = unwrapPersisted(Money.of(toNumber(row.selling_price), row.currency));
    const tags = tagRows.map((t) => t.tag);
    const images = [...imageRows].sort((a, b) => a.position - b.position).map((i) => i.url);

    return Product.reconstitute({
      id: row.id,
      workspaceId: row.workspace_id,
      sku: row.sku,
      name: row.name,
      description: row.description,
      costPrice,
      sellingPrice,
      condition: row.condition as ProductCondition,
      category: row.category,
      categoryProvenance: parseCategoryProvenance(row.category_provenance),
      status: row.status as ProductStatus,
      tags,
      images,
      createdAt: toDate(row.created_at),
      updatedAt: toDate(row.updated_at),
    });
  },
};
