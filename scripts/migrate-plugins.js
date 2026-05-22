import fs from 'fs';
import path from 'path';
import process from 'process';

const pluginsDir = path.join(process.cwd(), 'plugins');

function run() {
  const languages = fs.readdirSync(pluginsDir);
  for (const lang of languages) {
    if (lang === 'multisrc' || lang === 'index.ts') continue;

    const langDir = path.join(pluginsDir, lang);
    if (!fs.statSync(langDir).isDirectory()) continue;

    const files = fs.readdirSync(langDir);
    for (const file of files) {
      if (!file.endsWith('.ts')) continue;

      const fileNameWithoutExt = file.replace(/\.ts$/, '');
      const newFolderName = fileNameWithoutExt.replace(/\s+/g, '');

      const newDirPath = path.join(langDir, newFolderName);
      const oldFilePath = path.join(langDir, file);

      if (!fs.existsSync(newDirPath)) {
        fs.mkdirSync(newDirPath, { recursive: true });
      }

      let newFileName = 'index.ts';
      if (file.endsWith('.broken.ts')) {
        newFileName = 'index.broken.ts';
      }

      const newFilePath = path.join(newDirPath, newFileName);

      let content = fs.readFileSync(oldFilePath, 'utf-8');

      fs.writeFileSync(newFilePath, content);
      fs.unlinkSync(oldFilePath);
      console.log(`Migrated ${file} -> ${newFolderName}/${newFileName}`);
    }
  }
}

run();
