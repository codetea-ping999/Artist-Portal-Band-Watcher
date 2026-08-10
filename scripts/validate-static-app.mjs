import { access, readFile } from 'node:fs/promises';

const requiredFiles = [
  'index.html',
  'src/main.js',
  'src/demo-data.js',
  'src/local-repository.js',
  'src/supabase-repository.js',
  'src/styles.css',
  'supabase/migrations/20260810143000_initial_artist_portal.sql'
];

for (const file of requiredFiles) {
  await access(file);
}

const html = await readFile('index.html', 'utf8');
const main = await readFile('src/main.js', 'utf8');

if (!html.includes('id="app"')) {
  throw new Error('index.html must contain #app');
}

if (!main.includes('Artist Portal')) {
  throw new Error('main.js should include the app title');
}

console.log('Static app validation passed.');
