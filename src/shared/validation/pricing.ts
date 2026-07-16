export const BELOW_COST_CONFIRMATION_MESSAGE = 'must be true when sellingPrice is below costPrice';

type PricingRefinementContext = {
  addIssue(issue: { code: 'custom'; path: string[]; message: string }): void;
};

type PricingCandidate = {
  costPrice?: number | null;
  sellingPrice?: number;
  allowBelowCost?: boolean;
};

export function requireBelowCostConfirmation(
  candidate: PricingCandidate,
  ctx: PricingRefinementContext
): void {
  if (
    typeof candidate.costPrice === 'number' &&
    typeof candidate.sellingPrice === 'number' &&
    candidate.sellingPrice < candidate.costPrice &&
    candidate.allowBelowCost !== true
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['allowBelowCost'],
      message: BELOW_COST_CONFIRMATION_MESSAGE,
    });
  }
}
