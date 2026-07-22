import type { Request, Response } from 'express';
import type { AnalyticsApplicationService, AnalyticsRange } from '../../../application/services/AnalyticsApplicationService';
import { ValidationError } from '../../../domain/shared/DomainError';
import { ok } from '../formatters/ResponseFormatter';

const DAY_MS = 24 * 60 * 60 * 1000;

function first(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new ValidationError(`Analytics ${field} must be a single string`);
  return value.trim() || undefined;
}

function parseDate(value: string): Date {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const parsed = new Date(dateOnly ? `${value}T00:00:00.000Z` : value);
  if (Number.isNaN(parsed.getTime())
    || (dateOnly && parsed.toISOString().slice(0, 10) !== value)) {
    throw new ValidationError('Analytics date range is invalid');
  }
  return parsed;
}

export function parseAnalyticsRange(query: Request['query'], now: Date = new Date()): AnalyticsRange {
  const fromValue = first(query.from, 'from');
  const toValue = first(query.to, 'to');
  const intervalValue = first(query.interval, 'interval');
  const marketplaceId = first(query.marketplaceId, 'marketplaceId');
  const to = toValue ? parseDate(toValue) : now;
  if (toValue && /^\d{4}-\d{2}-\d{2}$/.test(toValue)) to.setUTCDate(to.getUTCDate() + 1);
  const from = fromValue ? parseDate(fromValue) : new Date(to.getTime() - 30 * DAY_MS);
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
