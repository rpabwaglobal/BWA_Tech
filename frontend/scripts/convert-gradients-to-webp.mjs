import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(process.cwd());
const GRADIENTS_ROOT = path.join(ROOT, 'public', 'gradients');
const PRIORITIES = ['baixa', 'media', 'alta', 'absoluta'];

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function convertFile(inputPath, outputPath) {
  const [inStat, outExists] = await Promise.all([
    fs.stat(inputPath),
    exists(outputPath),
  ]);

  if (outExists) {
    const outStat = await fs.stat(outputPath);
    // Evita reconversão desnecessária.
    if (outStat.mtimeMs >= inStat.mtimeMs) {
      return { skipped: true };
    }
  }

  await sharp(inputPath)
    .webp({ quality: 82, effort: 5 })
    .toFile(outputPath);

  return { skipped: false };
}

async function run() {
  let converted = 0;
  let skipped = 0;

  for (const priority of PRIORITIES) {
    const dir = path.join(GRADIENTS_ROOT, priority);
    const files = await fs.readdir(dir);
    const pngs = files.filter((f) => f.toLowerCase().endsWith('.png'));

    for (const png of pngs) {
      const inputPath = path.join(dir, png);
      const outputPath = path.join(dir, png.replace(/\.png$/i, '.webp'));
      const result = await convertFile(inputPath, outputPath);
      if (result.skipped) skipped += 1;
      else converted += 1;
    }
  }

  console.log(`[gradients:webp] converted=${converted} skipped=${skipped}`);
}

run().catch((error) => {
  console.error('[gradients:webp] failed:', error);
  process.exit(1);
});
