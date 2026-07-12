// Use case: run the Hermes decision engine for a workspace. Loads the workspace
// context and delegates to HermesDecisionEngine.run, which analyzes products,
// creates events, applies auto-approved changes, persists the events and emits a
// run-completed domain event.

import { Result, Ok, Err } from '../../domain/shared/Result';
import { NotFoundError } from '../../domain/shared/DomainError';
import { HermesDecisionEngine } from '../../domain/services/HermesDecisionEngine';
import type { HermesEvent } from '../../domain/entities/HermesEvent';
import type { IWorkspaceRepository } from '../../domain/repositories/interfaces/IWorkspaceRepository';
import type { RunHermesDTO } from '../dto/HermesDTO';

export class RunHermesUseCase {
  constructor(
    private readonly engine: HermesDecisionEngine,
    private readonly workspaceRepo: IWorkspaceRepository,
  ) {}

  async execute(input: RunHermesDTO): Promise<Result<HermesEvent[]>> {
    const workspace = await this.workspaceRepo.findById(input.workspaceId);
    if (!workspace) {
      return Err(new NotFoundError(`Workspace not found: ${input.workspaceId}`));
    }

    const events = await this.engine.run(workspace);
    return Ok(events);
  }
}
