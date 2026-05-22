import fastGlob from 'fast-glob';
const globSync = fastGlob.globSync;
import fs from 'fs';

const folders = globSync('plugins/*/*\\[*\\]', { onlyDirectories: true });
for (const folder of folders) {
  fs.rmSync(folder, { recursive: true, force: true });
}
console.log(`Cleaned ${folders.length} multisrc plugins.`);
