import fs from 'fs';

export function orderedMigrationFiles(migrationsDir: string): string[] {
  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    throw new Error(`No SQL migration files found in required bundle: ${migrationsDir}`);
  }
  return files;
}
