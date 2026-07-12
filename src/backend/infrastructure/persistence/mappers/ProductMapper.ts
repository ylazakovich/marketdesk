import { Product } from '../../../domain/entities/Product';
import { Money } from '../../../domain/valueObjects/Money';
import type { ProductCondition, ProductStatus } from '../../../../shared/types';
import type { ProductImageRow, ProductRow, ProductTagRow } from './rows';
import { toDate, toNumber, unwrapPersisted } from './support';

export const ProductMapper = {
  // Reconstitute a Product aggregate from its own row plus its child rows.
  toDomain(
    row: ProductRow,
    tagRows: ProductTagRow[],
    imageRows: ProductImageRow[],
  ): Product {
    const costPrice = unwrapPersisted(Money.of(toNumber(row.cost_price), row.currency));
    const sellingPrice = unwrapPersisted(
      Money.of(toNumber(row.selling_price), row.currency),
    );
    const tags = tagRows.map((t) => t.tag);
    const images = [...imageRows]
      .sort((a, b) => a.position - b.position)
      .map((i) => i.url);

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
      status: row.status as ProductStatus,
      tags,
      images,
      createdAt: toDate(row.created_at),
      updatedAt: toDate(row.updated_at),
    });
  },
};
