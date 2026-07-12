// Thin HTTP adapter for analytics/dashboard reads. Metrics are derived aggregates
// from the application service. Prior-period comparison and revenue time-series have
// no historical analytics store wired at this layer (see AnalyticsApplicationService
// header), so `previous` is null and the revenue series is empty until Group 6 wires
// an analytics-event source; the shapes are kept stable so the frontend renders.

import type { Request, Response } from 'express';
import type { AnalyticsApplicationService } from '../../../application/services/AnalyticsApplicationService';
import { ok } from '../formatters/ResponseFormatter';

export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsApplicationService) {}

  overview = async (req: Request, res: Response): Promise<void> => {
    const metrics = await this.analytics.getDashboardMetrics(req.user!.workspaceId!);
    ok(res, {
      ...metrics,
      // Prior-period baseline for delta tiles. Null until a historical analytics
      // source is wired (Group 6); the frontend treats null deltas as "no change".
      previous: null,
    });
  };

  revenue = async (req: Request, res: Response): Promise<void> => {
    void req;
    // Canonical shape: { series: RevenuePoint[], currency: string | null }.
    // A RevenuePoint is { date: string (ISO), revenue: number, previous: number | null }.
    // No time-series analytics store is wired at this layer yet, so `series` is an
    // empty array and `currency` is null (both keys always present) — the chart
    // renders empty rather than erroring. (canonical contract)
    ok(res, { series: [] as Array<{ date: string; revenue: number; previous: number | null }>, currency: null });
  };

  listings = async (req: Request, res: Response): Promise<void> => {
    const performance = await this.analytics.getListingPerformance(
      req.user!.workspaceId!,
    );
    ok(res, performance);
  };
}
