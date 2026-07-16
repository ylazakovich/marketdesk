import { existsSync, readFileSync } from 'node:fs';

const requiredFiles = [
  'docs/design/MarketDesk PRD.dc.html',
  'docs/design/MarketDesk.dc.html',
  'ARCHITECTURE.md',
  'ARCHITECTURE_AMENDMENTS.md',
  'docs/spec/PRODUCT.md',
  'docs/spec/README.md',
  'docs/spec/TRACEABILITY.md',
  'docs/spec/TASKS.md',
  'docs/spec/SDD_WORKFLOW.md',
  'docs/spec/RUNBOOK.md',
  'docs/spec/OPEN_QUESTIONS.md',
  'docs/spec/TECH_STACK.md',
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

const validStatuses = new Set(['Implemented', 'Partial', 'Not implemented', 'Docs only']);
const rows = traceability
  .split('\n')
  .filter((line) => /^\| §\d+ \|/.test(line))
  .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));

if (rows.length !== 18) {
  throw new Error(`TRACEABILITY.md must contain exactly 18 PRD rows; found ${rows.length}`);
}

rows.forEach((cells, index) => {
  const expectedSection = `§${index + 1}`;
  if (cells.length !== 6) {
    throw new Error(`${expectedSection} must have 6 traceability fields; found ${cells.length}`);
  }

  const [section, contract, status, implementation, verification, tracking] = cells;
  if (section !== expectedSection) {
    throw new Error(`Expected ${expectedSection}, found ${section}`);
  }
  if (!contract) throw new Error(`${section} is missing its contract`);
  if (!validStatuses.has(status)) throw new Error(`${section} has invalid status: ${status}`);
  if (!implementation || !implementation.includes('`')) {
    throw new Error(`${section} needs parseable implementation/document evidence`);
  }
  if (!verification || verification.length < 12) {
    throw new Error(`${section} needs concrete test or verification evidence`);
  }
  if (!tracking || !/#\d+/.test(tracking)) {
    throw new Error(`${section} needs an issue/PR tracking reference`);
  }
});

for (const status of validStatuses) {
  if (!traceability.includes(`**${status}**`)) {
    throw new Error(`TRACEABILITY.md is missing status definition: ${status}`);
  }
}

console.log('Product contract and all 18 PRD traceability rows are complete.');
