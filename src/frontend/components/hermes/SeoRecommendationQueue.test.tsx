import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { HermesEvent } from '@shared/types';
import {
  isSeoRecommendation,
  recommendationFieldLabel,
  SeoRecommendationQueue,
  SeoReviewSummary,
} from './SeoRecommendationQueue';

jest.mock('../../state/hooks.js', () => ({
  useAppDispatch: () => jest.fn(),
  useAppSelector: () => 'PLN',
}));

jest.mock('../../services/hooks/index.js', () => ({
  useApproveHermesEvent: () => [jest.fn(), { isLoading: false }],
  useDismissHermesEvent: () => [jest.fn(), { isLoading: false }],
  useExecuteCategoryRecreationOperation: () => [jest.fn(), { isLoading: false }],
}));

function seoEvent(id: string, kind: 'title' | 'description' = 'title'): HermesEvent {
  return {
    id,
    workspaceId: 'workspace-1',
    productId: 'product-1',
    type: kind === 'title' ? 'suggested_better_title' : 'update_description',
    severity: 'info',
    status: 'pending_review',
    title: kind === 'title' ? `Improve title ${id}` : `Improve description ${id}`,
    proposedChange: kind === 'title'
      ? { kind: 'title', field: 'title', from: 'Old title', to: 'Long improved title with buyer intent' }
      : { kind: 'description', field: 'description', from: 'Old description', to: 'Detailed improved description' },
    createdAt: '2026-07-23T06:00:00.000Z',
  };
}

describe('SEO recommendation presentation', () => {
  it('classifies the shared SEO legend and field without conflating lifecycle', () => {
    const event = seoEvent('1', 'description');
    expect(isSeoRecommendation(event)).toBe(true);
    expect(recommendationFieldLabel(event)).toBe('Description');
  });

  it('bounds a large queue to one expanded review and three compact previews', () => {
    const events = Array.from({ length: 20 }, (_, index) => seoEvent(String(index + 1), index % 2 ? 'description' : 'title'));
    const html = renderToStaticMarkup(
      <SeoRecommendationQueue
        events={events}
        total={20}
        onViewAll={() => undefined}
        onResolved={() => undefined}
        approveLabel="Apply"
      />
    );

    expect(html).toContain('data-testid="seo-recommendation-queue"');
    expect(html).toContain('data-variant="compact-review"');
    expect(html).toContain('SEO, listing search optimization');
    expect(html).toContain('− Before');
    expect(html).toContain('+ After');
    expect(html).toContain('19 more pending · 16 not expanded here');
    expect((html.match(/data-testid="recommendation-preview"/g) ?? [])).toHaveLength(3);
    expect(html).toContain('View all 20');
  });

  it('renders an honest dashboard summary for the next SEO review', () => {
    const html = renderToStaticMarkup(
      <SeoReviewSummary
        event={seoEvent('1')}
        total={20}
        onRetry={() => undefined}
        onReview={() => undefined}
        onViewAll={() => undefined}
      />
    );

    expect(html).toContain('Review queue');
    expect(html).toContain('Improve title 1');
    expect(html).toContain('No change is applied until you approve it.');
    expect(html).toContain('Review next');
  });
});
