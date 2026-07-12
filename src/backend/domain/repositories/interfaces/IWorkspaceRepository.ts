import type { Workspace } from '../../entities/Workspace';

export interface IWorkspaceRepository {
  findById(id: string): Promise<Workspace | null>;
  findAll(): Promise<Workspace[]>;
  save(workspace: Workspace): Promise<void>;
}
