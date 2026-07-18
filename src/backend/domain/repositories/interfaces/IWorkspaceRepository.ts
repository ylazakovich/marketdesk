import type { Workspace } from '../../entities/Workspace';
import type { AutonomyLevel, HermesGuardrails, WorkspaceLanguage } from '../../../../shared/types';

export interface WorkspaceProfilePatch {
  name?: string;
  currency?: string;
  timezone?: string;
  language?: WorkspaceLanguage;
}

export interface WorkspaceHermesPatch {
  autonomyLevel?: AutonomyLevel;
  guardrails?: Partial<HermesGuardrails>;
}

export type WorkspacePartialPatch = WorkspaceProfilePatch & WorkspaceHermesPatch;

export interface IWorkspaceRepository {
  findById(id: string): Promise<Workspace | null>;
  findAll(): Promise<Workspace[]>;
  save(workspace: Workspace): Promise<void>;
  updateProfile(id: string, patch: WorkspaceProfilePatch): Promise<Workspace | null>;
  updateHermes(id: string, patch: WorkspaceHermesPatch): Promise<Workspace | null>;
  updatePartial(id: string, patch: WorkspacePartialPatch): Promise<Workspace | null>;
  delete(id: string): Promise<void>;
}
