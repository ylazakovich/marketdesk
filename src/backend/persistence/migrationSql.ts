export interface ConcurrentIndexIdentity {
  name: string;
  schema?: string;
}

type SqlToken = { kind: 'word' | 'identifier' | 'dot'; value: string };

function sqlTokens(sql: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  let offset = 0;

  while (offset < sql.length) {
    if (sql.startsWith('--', offset)) {
      const newline = sql.indexOf('\n', offset + 2);
      offset = newline === -1 ? sql.length : newline + 1;
      continue;
    }
    if (sql.startsWith('/*', offset)) {
      let depth = 1;
      offset += 2;
      while (offset < sql.length && depth > 0) {
        if (sql.startsWith('/*', offset)) {
          depth += 1;
          offset += 2;
        } else if (sql.startsWith('*/', offset)) {
          depth -= 1;
          offset += 2;
        } else {
          offset += 1;
        }
      }
      if (depth > 0) throw new Error('Unterminated SQL block comment');
      continue;
    }
    if (sql[offset] === "'") {
      offset += 1;
      while (offset < sql.length) {
        if (sql[offset] === "'" && sql[offset + 1] === "'") {
          offset += 2;
        } else if (sql[offset] === "'") {
          offset += 1;
          break;
        } else {
          offset += 1;
        }
      }
      continue;
    }
    if (sql[offset] === '$') {
      const delimiter = sql.slice(offset).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
      if (delimiter) {
        const close = sql.indexOf(delimiter, offset + delimiter.length);
        if (close === -1) throw new Error('Unterminated SQL dollar-quoted body');
        offset = close + delimiter.length;
        continue;
      }
    }
    if (sql[offset] === '"') {
      let value = '';
      offset += 1;
      let closed = false;
      while (offset < sql.length) {
        if (sql[offset] === '"' && sql[offset + 1] === '"') {
          value += '"';
          offset += 2;
        } else if (sql[offset] === '"') {
          offset += 1;
          closed = true;
          break;
        } else {
          value += sql[offset];
          offset += 1;
        }
      }
      if (!closed) throw new Error('Unterminated quoted SQL identifier');
      tokens.push({ kind: 'identifier', value });
      continue;
    }
    if (/[A-Za-z_]/.test(sql[offset])) {
      const match = sql.slice(offset).match(/^[A-Za-z_][A-Za-z0-9_$]*/);
      if (!match) throw new Error('Failed to tokenize SQL word');
      tokens.push({ kind: 'word', value: match[0] });
      offset += match[0].length;
      continue;
    }
    if (sql[offset] === '.') tokens.push({ kind: 'dot', value: '.' });
    offset += 1;
  }
  return tokens;
}

function isWord(token: SqlToken | undefined, value: string): boolean {
  return token?.kind === 'word' && token.value.toUpperCase() === value;
}

function identifierValue(token: SqlToken | undefined): string | undefined {
  return token && (token.kind === 'word' || token.kind === 'identifier')
    ? token.value
    : undefined;
}

export function concurrentIndexIdentity(sql: string): ConcurrentIndexIdentity | undefined {
  const tokens = sqlTokens(sql);

  for (let start = 0; start < tokens.length; start += 1) {
    let cursor = start;
    if (!isWord(tokens[cursor], 'CREATE')) continue;
    cursor += 1;
    if (isWord(tokens[cursor], 'UNIQUE')) cursor += 1;
    if (!isWord(tokens[cursor], 'INDEX') || !isWord(tokens[cursor + 1], 'CONCURRENTLY')) continue;
    cursor += 2;
    if (isWord(tokens[cursor], 'IF') && isWord(tokens[cursor + 1], 'NOT') && isWord(tokens[cursor + 2], 'EXISTS')) {
      cursor += 3;
    }

    const first = identifierValue(tokens[cursor]);
    if (!first) throw new Error('Cannot identify concurrent index name');
    cursor += 1;
    if (tokens[cursor]?.kind === 'dot') {
      const name = identifierValue(tokens[cursor + 1]);
      if (!name || !isWord(tokens[cursor + 2], 'ON')) {
        throw new Error('Cannot identify schema-qualified concurrent index name');
      }
      return { schema: first, name };
    }
    if (!isWord(tokens[cursor], 'ON')) throw new Error('Cannot identify concurrent index name');
    return { name: first };
  }
  return undefined;
}

export function quotedIndexIdentity(identity: ConcurrentIndexIdentity): string {
  const quote = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;
  return identity.schema
    ? `${quote(identity.schema)}.${quote(identity.name)}`
    : quote(identity.name);
}
