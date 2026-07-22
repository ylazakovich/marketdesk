import type { Request, Response } from 'express';
import type { AnalyticsApplicationService, AnalyticsRange } from '../../../application/services/AnalyticsApplicationService';
import { ValidationError } from '../../../domain/shared/DomainError';
import { ok } from '../formatters/ResponseFormatter';

const DAY_MS = 24 * 60 * 60 * 1000;

function first(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function parseAnalyticsRange(query: Request['query'], now: Date = new Date()): AnalyticsRange {
  const fromValue = first(query.from);
  const toValue = first(query.to);
  const intervalValue = first(query.interval);
  const marketplaceId = first(query.marketplaceId);
  const to = toValue
    ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(toValue) ? `${toValue}T00:00:00.000Z` : toValue)
    : now;
  if (toValue && /^\d{4}-\d{2}-\d{2}$/.test(toValue)) to.setUTCDate(to.getUTCDate() + 1);
  const from = fromValue
    ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(fromValue) ? `${fromValue}T00:00:00.000Z` : fromValue)
    : new Date(to.getTime() - 30 * DAY_MS);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
    throw new ValidationError('Analytics date range is invalid');
  }
  if (to.getTime() - from.getTime() > 366 * DAY_MS) {
    throw new ValidationError('Analytics date range cannot exceed 366 days');
  }
  if (intervalValue && !['day', 'week', 'month'].includes(intervalValue)) {
    throw new ValidationError('Analytics interval must be day, week, or month');
  }
  return {
    from, to, marketplaceId,
    interval: intervalValue as AnalyticsRange['interval'],
  };
}

export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsApplicationService) {}

  overview = async (req: Request, res: Response): Promise<void> => {
    ok(res, await this.analytics.getDashboardMetrics(req.user!.workspaceId!, parseAnalyticsRange(req.query)));
  };

  revenue = async (req: Request, res: Response): Promise<void> => {
    ok(res, await this.analytics.getRevenue(req.user!.workspaceId!, parseAnalyticsRange(req.query)));
  };

  listings = async (req: Request, res: Response): Promise<void> => {
    ok(res, await this.analytics.getListingPerformance(req.user!.workspaceId!, parseAnalyticsRange(req.query)));
  };
}
