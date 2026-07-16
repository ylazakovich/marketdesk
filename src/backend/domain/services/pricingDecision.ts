import type { Product } from '../entities/Product';

export type PricingSnapshot = {
  costPrice: number | null;
  sellingPrice: number;
};

export type PricingDecision = {
  belowCost: boolean;
  confirmed: boolean;
  before?: PricingSnapshot;
  after: PricingSnapshot;
};

export function buildPricingDecision(
  product: Product,
  confirmed: boolean,
  before?: PricingSnapshot
): PricingDecision {
  return {
    belowCost: Boolean(product.costPrice?.isGreaterThan(product.sellingPrice)),
    confirmed,
    ...(before ? { before } : {}),
    after: {
      costPrice: product.costPrice?.amount ?? null,
      sellingPrice: product.sellingPrice.amount,
    },
  };
}
