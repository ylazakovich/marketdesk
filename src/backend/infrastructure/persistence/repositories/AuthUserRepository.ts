// Concrete IAuthUserStore backed by the `users` table (migration 001).
// Powers /auth/login and /auth/me. Passwords are already hashed by the caller
// (AuthController uses bcryptjs); this store only persists/reads the hash. The
// row<->record mapping is exposed as a pure static so it can be unit-tested
// without a database, matching the other repositories in this package.

import type { PoolClient, Pool } from 'pg';
import { query } from '../../../config/database';
import type {
  IAuthUserStore,
  AuthUserRecord,
  CreateAuthUserInput,
} from '../../../presentation/http/ports/IAuthUserStore';
import { toDate } from '../mappers/support';

export interface AuthUserRow {
  id: string;
  email: string;
  password_hash: string;
  workspace_id: string | null;
  created_at: Date | string;
}

const USER_SELECT = `
  SELECT id, email, password_hash, workspace_id, created_at
  FROM users
`;

export const AuthUserMapper = {
  toRecord(row: AuthUserRow): AuthUserRecord {
    return {
      id: row.id,
      email: row.email,
      passwordHash: row.password_hash,
      workspaceId: row.workspace_id ?? null,
      createdAt: toDate(row.created_at),
    };
  },
};

export class AuthUserRepository implements IAuthUserStore {
  // An optional client allows enlisting in an outer unit-of-work; otherwise the
  // shared pool is used (consistent with the other repositories).
  private readonly queryClient?: PoolClient | Pool;

  constructor(pool?: Pool, client?: PoolClient) {
    this.queryClient = client || pool;
  }

  async findByEmail(email: string): Promise<AuthUserRecord | null> {
    const { rows } = await query<AuthUserRow>(
      `${USER_SELECT} WHERE LOWER(email) = LOWER($1)`,
      [email],
      this.queryClient,
    );
    const row = rows[0];
    return row ? AuthUserMapper.toRecord(row) : null;
  }

  async findById(id: string): Promise<AuthUserRecord | null> {
    const { rows } = await query<AuthUserRow>(
      `${USER_SELECT} WHERE id = $1`,
      [id],
      this.queryClient,
    );
    const row = rows[0];
    return row ? AuthUserMapper.toRecord(row) : null;
  }

  async create(input: CreateAuthUserInput): Promise<AuthUserRecord> {
    const { rows } = await query<AuthUserRow>(
      `INSERT INTO users (email, password_hash, workspace_id)
       VALUES ($1, $2, $3)
       RETURNING id, email, password_hash, workspace_id, created_at`,
      [input.email, input.passwordHash, input.workspaceId ?? null],
      this.queryClient,
    );
    return AuthUserMapper.toRecord(rows[0]);
  }
}
