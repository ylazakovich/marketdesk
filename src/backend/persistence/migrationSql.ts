export interface ConcurrentIndexIdentity {
  name: string;
  schema?: string;
}

function withoutSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\r\n]*/g, '');
}

export function concurrentIndexIdentity(sql: string): ConcurrentIndexIdentity | undefined {
  const executableSql = withoutSqlComments(sql);
  if (!/\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/i.test(executableSql)) {
    return undefined;
  }

  const match = executableSql.match(
    /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(?<schema>[A-Za-z_][A-Za-z0-9_]*)\.)?(?<name>[A-Za-z_][A-Za-z0-9_]*)\b(?=\s+ON\b)/i,
  );
  if (!match?.groups?.name) {
    throw new Error('Cannot identify unquoted concurrent index name');
  }
  return {
    name: match.groups.name,
    ...(match.groups.schema ? { schema: match.groups.schema } : {}),
  };
}

export function quotedIndexIdentity(identity: ConcurrentIndexIdentity): string {
  const quote = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;
  return identity.schema
    ? `${quote(identity.schema)}.${quote(identity.name)}`
    : quote(identity.name);
}
