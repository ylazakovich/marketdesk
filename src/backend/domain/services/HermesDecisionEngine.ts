// HermesDecisionEngine — the autonomous analyzer. Implements ARCHITECTURE.md §10
// with the IAIProvider abstraction from ARCHITECTURE_AMENDMENTS FIX #1.
//
// Autonomy tiers (determineAutonomy):
//   suggest_only : everything -> pending_review
//   full_auto    : auto_apply, EXCEPT critical competitor_price_detected -> review
//   balanced     : safe types (create_listing/update_description/relist) auto_apply,
//                  everything else -> pending_review
//
// Additionally, HermesEvent.requiresHumanReview() forces review for critical price
// drops (> 20%), so those never auto-apply regardless of tier.

import { Result, Ok, Err } from '../shared/Result';
import { ValidationError, InvalidStateError } from '../shared/DomainError';
import { HermesEvent } from '../entities/HermesEvent';
import { Product } from '../entities/Product';
import { Money } from '../valueObjects/Money';
import type {
  AutonomyLevel,
  AutonomyDecision,
  HermesEventType,
  HermesSeverity,
  ProposedChange,
} from '../../../shared/types';
import { BALANCED_SAFE_EVENT_TYPES } from '../../../shared/constants';
import type { Workspace } from '../entities/Workspace';
import type { IProductRepository } from '../repositories/interfaces/IProductRepository';
import type { IListingRepository } from '../repositories/interfaces/IListingRepository';
import type { IEventRepository } from '../repositories/interfaces/IEventRepository';
import type { IEventPublisher, DomainEvent } from '../ports/IEventPublisher';
import type { IAIProvider } from '../ports/IAIProvider';

interface Suggestion {
  type: HermesEventType;
  severity: HermesSeverity;
  title: string;
  detail: string;
  change: ProposedChange;
}

export type IdFactory = () => string;

export class HermesDecisionEngine {
  constructor(
    private readonly productRepo: IProductRepository,
    private readonly listingRepo: IListingRepository,
    private readonly eventRepo: IEventRepository,
    private readonly eventPublisher: IEventPublisher,
    private readonly aiProvider: IAIProvider,
    private readonly idFactory: IdFactory,
  ) {}

  async run(workspace: Workspace): Promise<HermesEvent[]> {
    const events: HermesEvent[] = [];
    const products = await this.productRepo.findByWorkspace(workspace.id);

    for (const product of products) {
      const suggestions = await this.checkConditions(product);

      for (const suggestion of suggestions) {
        const created = HermesEvent.create({
          id: this.idFactory(),
          workspaceId: workspace.id,
          productId: product.id,
          type: suggestion.type,
          severity: suggestion.severity,
          title: suggestion.title,
          detail: suggestion.detail,
          proposedChange: suggestion.change,
        });
        if (created.isErr()) continue;
        const event = created.value;

        let decision = this.determineAutonomy(
          workspace.autonomyLevel,
          suggestion.type,
          suggestion.severity,
        );

        if (
          decision === 'auto_apply' &&
          !event.requiresHumanReview() &&
          this.passesGuardrails(product, event, workspace)
        ) {
          const applied = await this.applyChange(product, event.proposedChange);
          if (applied.isOk()) {
            event.markApplied();
          } else {
            decision = 'pending_review';
          }
        } else if (decision === 'auto_apply') {
          // Guardrail: a critical change, a >20% drop, or a workspace guardrail
          // violation cannot auto-apply — force human review.
          decision = 'pending_review';
        }

        event.setAutonomyDecision(decision);
        events.push(event);
      }
    }

    await this.eventRepo.saveAll(events);
    await this.eventPublisher.publish(this.runCompletedEvent(workspace.id, events.length));

    return events;
  }

  determineAutonomy(
    autonomyLevel: AutonomyLevel,
    eventType: HermesEventType,
    severity: HermesSeverity,
  ): AutonomyDecision {
    if (autonomyLevel === 'suggest_only') {
      return 'pending_review';
    }

    if (autonomyLevel === 'full_auto') {
      if (severity === 'critical' && eventType === 'competitor_price_detected') {
        return 'pending_review';
      }
      return 'auto_apply';
    }

    if (autonomyLevel === 'balanced') {
      return BALANCED_SAFE_EVENT_TYPES.includes(eventType)
        ? 'auto_apply'
        : 'pending_review';
    }

    return 'pending_review';
  }

  // Enforce the workspace's configurable Hermes guardrails (ARCHITECTURE_AMENDMENTS
  // FIX #5). Returns false when the proposed auto-apply would violate a guardrail,
  // in which case the caller downgrades the event to pending_review. Guardrails:
  //   - autoAdjustPricing / autoCreateListings / autoRelist / smartTitleAndSEO:
  //     per-action master switches for auto-application
  //   - maxAutoPriceChangePct: max |price change| % allowed without review
  //   - minMarginFloor: minimum (price - cost)/price margin % to auto-apply a price
  // Informational events (e.g. suggested_more_photos) are not guardrail-gated.
  passesGuardrails(
    product: Product,
    event: HermesEvent,
    workspace: Workspace,
  ): boolean {
    const g = workspace.guardrails;
    const change = event.proposedChange;

    if (change && change.kind === 'price') {
      if (!g.autoAdjustPricing) return false;
      const { from, to } = change;
      if (from > 0) {
        const pctChange = Math.abs(to - from) / from;
        if (pctChange > g.maxAutoPriceChangePct / 100) return false;
      }
      if (to > 0) {
        const margin = (to - product.costPrice.amount) / to;
        if (margin < g.minMarginFloor / 100) return false;
      }
      return true;
    }

    switch (event.type) {
      case 'create_listing':
        return g.autoCreateListings;
      case 'relist':
      case 'needs_relisting':
        return g.autoRelist;
      case 'suggested_better_title':
      case 'update_description':
        return g.smartTitleAndSEO;
      default:
        return true;
    }
  }

  async checkConditions(product: Product): Promise<Suggestion[]> {
    const suggestions: Suggestion[] = [];
    const listings = await this.listingRepo.findByProduct(product.id);

    // Check 1: expired listings -> needs relisting
    const expired = listings.filter((l) => l.isExpired());
    if (expired.length > 0) {
      suggestions.push({
        type: 'needs_relisting',
        severity: 'warning',
        title: 'Listing expired',
        detail: `${expired.length} listing(s) have expired`,
        change: {
          kind: 'relist',
          action: 'relist',
          listingIds: expired.map((l) => l.id),
        },
      });
    }

    // Check 2 + 3: AI-driven price and title suggestions (via abstracted provider)
    if (listings.length > 0) {
      const primary = listings[0];
      const recentViews = listings.reduce((sum, l) => sum + (l.views ?? 0), 0);

      const priceResult = await this.aiProvider.suggestPrice({
        listing: primary,
        recentViews,
        conversionRate: 0,
      });

      const currentPrice = product.sellingPrice.amount;
      if (
        priceResult.confidence === 'high' &&
        currentPrice > 0 &&
        Math.abs(priceResult.suggestedPrice - currentPrice) >= 0.05 * currentPrice
      ) {
        const isLower = priceResult.suggestedPrice < currentPrice;
        suggestions.push({
          type: isLower ? 'suggested_lower_price' : 'suggested_higher_price',
          severity: isLower ? 'warning' : 'info',
          title: `AI suggests price ${priceResult.suggestedPrice}`,
          detail: priceResult.reasoning,
          change: {
            kind: 'price',
            field: 'price',
            from: currentPrice,
            to: priceResult.suggestedPrice,
          },
        });
      }

      const titleResult = await this.aiProvider.generateTitle(product, null);
      if (titleResult !== product.name && titleResult.length <= 120) {
        suggestions.push({
          type: 'suggested_better_title',
          severity: 'info',
          title: 'Improve product title for search',
          detail: titleResult,
          change: {
            kind: 'title',
            field: 'title',
            from: product.name,
            to: titleResult,
          },
        });
      }
    }

    // Check 4: missing photos
    if (product.imageCount < 3) {
      suggestions.push({
        type: 'suggested_more_photos',
        severity: 'info',
        title: 'Add more photos for better conversion',
        detail: 'Products with 3+ photos sell 40% faster',
        change: null,
      });
    }

    return suggestions;
  }

  async applyChange(
    product: Product,
    change: ProposedChange,
  ): Promise<Result<void>> {
    if (change === null) return Ok(undefined);

    switch (change.kind) {
      case 'price': {
        const money = Money.of(change.to, product.sellingPrice.currency);
        if (money.isErr()) return money;
        // AI-driven auto-apply may go below cost; > 20% drops are already gated
        // to human review by requiresHumanReview().
        const updated = product.updateSellingPrice(money.value, true);
        if (updated.isErr()) return updated;
        await this.productRepo.save(product);
        return Ok(undefined);
      }
      case 'title': {
        const renamed = product.rename(change.to);
        if (renamed.isErr()) return renamed;
        await this.productRepo.save(product);
        return Ok(undefined);
      }
      case 'description': {
        const updated = product.updateDescription(change.to);
        if (updated.isErr()) return updated;
        await this.productRepo.save(product);
        return Ok(undefined);
      }
      case 'relist':
      case 'create_listing':
        // Listing-level changes require the publish/relist job flow (a job queue),
        // which the decision engine does not have. Rather than mark the event
        // `applied` while doing nothing (C6), signal that it cannot be auto-applied
        // here so run() downgrades it to pending_review for a human to action.
        return Err(
          new InvalidStateError(
            `${change.kind} cannot be auto-applied by the decision engine; routed to review`,
          ),
        );
      default:
        return Err(new ValidationError('Unknown proposed change'));
    }
  }

  private runCompletedEvent(workspaceId: string, count: number): DomainEvent {
    return {
      type: 'hermes.run_completed',
      aggregateType: 'Workspace',
      aggregateId: workspaceId,
      payload: { workspaceId, eventCount: count },
      occurredAt: new Date(),
    };
  }
}
