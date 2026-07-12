// Job handler: trigger a Hermes AI decision run for a workspace, then optionally
// emit a domain event. The decision engine itself lives in the domain/application
// layers; here it is an injected port (HermesEngine) so this handler stays free
// of concrete application-service imports. DI wiring happens in Group 6.

import type { IEventPublisher } from '../../../domain/ports/IEventPublisher';

export interface HermesRunJobData {
  workspaceId: string;
  trigger: 'scheduled' | 'manual' | 'event';
}

export interface HermesRunResult {
  workspaceId: string;
  eventsGenerated: number;
}

// Port for the Hermes decision engine. The concrete engine is injected.
export interface HermesEngine {
  run(input: HermesRunJobData): Promise<HermesRunResult>;
}

export class HermesRunHandler {
  constructor(
    private readonly engine: HermesEngine,
    private readonly events?: IEventPublisher,
  ) {}

  async handle(data: HermesRunJobData): Promise<HermesRunResult> {
    const result = await this.engine.run(data);

    if (this.events) {
      await this.events.publish({
        type: 'hermes.run.completed',
        aggregateType: 'workspace',
        aggregateId: data.workspaceId,
        payload: { eventsGenerated: result.eventsGenerated, trigger: data.trigger },
        occurredAt: new Date(),
      });
    }

    return result;
  }
}
