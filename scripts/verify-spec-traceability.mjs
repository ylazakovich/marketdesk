import { existsSync, readFileSync } from 'node:fs';

const requiredFiles = [
  'docs/design/MarketDesk PRD.dc.html',
  'docs/design/MarketDesk.dc.html',
  'ARCHITECTURE.md',
  'ARCHITECTURE_AMENDMENTS.md',
  'docs/spec/PRODUCT.md',
  'docs/spec/TRACEABILITY.md',
];

const missingFiles = requiredFiles.filter((path) => !existsSync(path));
if (missingFiles.length > 0) {
  throw new Error(`Missing product contract files: ${missingFiles.join(', ')}`);
}

const product = readFileSync('docs/spec/PRODUCT.md', 'utf8');
const traceability = readFileSync('docs/spec/TRACEABILITY.md', 'utf8');

for (const requiredReference of [
  'MarketDesk PRD.dc.html',
  'MarketDesk.dc.html',
  'ARCHITECTURE.md',
  'ARCHITECTURE_AMENDMENTS.md',
  'TRACEABILITY.md',
]) {
  if (!product.includes(requiredReference)) {
    throw new Error(`PRODUCT.md is missing source reference: ${requiredReference}`);
  }
}

for (let section = 1; section <= 18; section += 1) {
  if (!traceability.includes(`| §${section} |`)) {
    throw new Error(`TRACEABILITY.md is missing PRD section §${section}`);
  }
}

for (const status of ['Implemented', 'Partial', 'Not implemented', 'Docs only']) {
  if (!traceability.includes(`**${status}**`)) {
    throw new Error(`TRACEABILITY.md is missing status definition: ${status}`);
  }
}

console.log('Product contract and PRD traceability are complete.');
