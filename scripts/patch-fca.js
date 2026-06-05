const fs = require('fs');
const path = require('path');

const base = path.join(__dirname, '../node_modules/fca-unofficial-fixed');
const indexPath  = path.join(base, 'index.js');
const listenPath = path.join(base, 'src/listenMqtt.js');
const utilsPath  = path.join(base, 'utils.js');

for (const p of [indexPath, listenPath, utilsPath]) {
  if (!fs.existsSync(p)) console.warn('[patch-fca] Not found:', p);
  else console.log('[patch-fca] OK:', path.basename(p));
}

let listen = fs.readFileSync(listenPath, 'utf8');
const avFixed = listen.includes('av||userID') || listen.includes('av || userID');
if (!avFixed) {
  const before = listen;
  listen = listen
    .replace(/\bgetSeqId\(\s*av\s*,/g, 'getSeqId(av||userID,')
    .replace(/\bsetSeqId\(\s*av\s*,/g, 'setSeqId(av||userID,')
    .replace(/,\s*av\s*,\s*null\s*,\s*region/g, ', av||userID, null, region');
  if (listen !== before) { fs.writeFileSync(listenPath, listen); console.log('[patch-fca] listenMqtt.js: av||userID patched'); }
  else console.log('[patch-fca] listenMqtt.js: no av target found');
} else { console.log('[patch-fca] listenMqtt.js: av||userID already present'); }
console.log('[patch-fca] Done.');
