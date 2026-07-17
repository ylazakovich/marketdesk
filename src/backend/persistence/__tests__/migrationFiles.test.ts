import fs from 'fs';
import os from 'os';
import path from 'path';
import { orderedMigrationFiles } from '../migrationFiles';

describe('orderedMigrationFiles', () => {
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'marketdesk-migrations-'));
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('returns only SQL files in lexical order', () => {
    fs.writeFileSync(path.join(directory, '010_second.sql'), 'SELECT 2;');
    fs.writeFileSync(path.join(directory, '002_first.sql'), 'SELECT 1;');
    fs.writeFileSync(path.join(directory, 'README.md'), 'not executable');

    expect(orderedMigrationFiles(directory)).toEqual(['002_first.sql', '010_second.sql']);
  });

  it('fails closed when the required migration bundle has no SQL files', () => {
    fs.writeFileSync(path.join(directory, 'README.md'), 'empty bundle');

    expect(() => orderedMigrationFiles(directory)).toThrow(/No SQL migration files/);
  });
});
