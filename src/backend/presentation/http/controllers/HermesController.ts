// Thin HTTP adapter for Hermes (autonomous agent) resources. All logic lives in the
// application service / use cases; this only parses filters and translates Results.

import type { Request, Response, NextFunction } from 'express';
import type { HermesApplicationService } from '../../../application/services/HermesApplicationService';
import type { HermesEventStatus, HermesSeverity } from '../../../../shared/types';
import type { ListEventsQueryDTO } from '../../../application/dto/HermesDTO';
import { NotFoundError } from '../../../domain/shared/DomainError';
import { ok, paginated } from '../formatters/ResponseFormatter';

// Parse a comma-separated multi-value query param (e.g. ?status=a,b) into a
// trimmed, non-empty string array; returns undefined when the param is absent.
function csv<T extends string>(value: unknown): T[] | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  const parts = value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts.length > 0 ? (parts as T[]) : undefined;
}


function routeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

export class HermesController {
  constructor(private readonly hermes: HermesApplicationService) {}

  list = async (req: Request, res: Response): Promise<void> => {
    // Filters are comma-separated multi-value params (the frontend sends
    // ?status=pending_review,applied and ?severity=warning,critical).
    const query: ListEventsQueryDTO = {
      workspaceId: req.user!.workspaceId!,
      productId: typeof req.query.productId === 'string' ? req.query.productId : undefined,
      status: csv<HermesEventStatus>(req.query.status),
      severity: csv<HermesSeverity>(req.query.severity),
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
    };
    const page = await this.hermes.listEvents(query);
    paginated(res, page.items, {
      page: page.page,
      limit: page.limit,
      total: page.total,
      totalPages: page.totalPages,
    });
  };

  get = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const eventId = routeParam(req.params.id);
    const event = await this.hermes.getEvent(eventId, req.user!.workspaceId!);
    if (!event) {
      return next(new NotFoundError(`Hermes event not found: ${eventId}`));
    }
    ok(res, event);
  };

  approve = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const eventId = routeParam(req.params.id);
    const result = await this.hermes.approveEvent({
      eventId,
      workspaceId: req.user!.workspaceId!,
      actorId: req.body?.actorId ?? req.user?.userId,
    });
    if (result.isErr()) return next(result.error);
    ok(res, result.value);
  };

  dismiss = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const eventId = routeParam(req.params.id);
    const result = await this.hermes.dismissEvent({
      eventId,
      workspaceId: req.user!.workspaceId!,
      actorId: req.body?.actorId ?? req.user?.userId,
      reason: req.body?.reason,
    });
    if (result.isErr()) return next(result.error);
    ok(res, result.value);
  };

  run = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const result = await this.hermes.runHermes({
      workspaceId: req.user!.workspaceId!,
      trigger: req.body?.trigger ?? 'manual',
    });
    if (result.isErr()) return next(result.error);
    ok(res, result.value, 202);
  };
}
