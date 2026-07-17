import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const publicDir = path.join(root, 'public');
const source = path.join(publicDir, 'marketdesk-mark.svg');
const svg = await readFile(source);

await mkdir(publicDir, { recursive: true });
await Promise.all([
  sharp(svg).resize(32, 32).png({ compressionLevel: 9 }).toFile(path.join(publicDir, 'favicon-32x32.png')),
  sharp(svg).resize(180, 180).png({ compressionLevel: 9 }).toFile(path.join(publicDir, 'apple-touch-icon.png')),
]);

console.log('Generated MarketDesk brand PNG assets from marketdesk-mark.svg.');
