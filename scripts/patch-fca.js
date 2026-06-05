const fs   = require('fs');
const path = require('path');

const base = path.join(__dirname, '../node_modules/fca-unofficial-fixed');
const indexPath  = path.join(base, 'index.js');
const listenPath = path.join(base, 'src/listenMqtt.js');
const utilsPath  = path.join(base, 'utils.js');

for (const p of [indexPath, listenPath, utilsPath]) {
  if (!fs.existsSync(p)) console.warn('[patch-fca] Not found:', p);
  else console.log('[patch-fca] OK:', path.basename(p));
}

// ── Fix 1: av: ctx.globalOptions.pageID → av: ctx.globalOptions.pageID || ctx.userID
// This is the critical bug: for non-Page bots, pageID is undefined which causes
// the MQTT syncToken GraphQL request to fail, preventing message reception.
let listen = fs.readFileSync(listenPath, 'utf8');

const already = listen.includes('ctx.globalOptions.pageID || ctx.userID');
if (already) {
  console.log('[patch-fca] listenMqtt.js: av fix already applied.');
} else {
  const before = listen;
  // Replace ALL occurrences of av: ctx.globalOptions.pageID
  listen = listen.split('av: ctx.globalOptions.pageID').join('av: ctx.globalOptions.pageID || ctx.userID');
  if (listen !== before) {
    fs.writeFileSync(listenPath, listen);
    const count = (before.match(/av: ctx\.globalOptions\.pageID/g) || []).length;
    console.log('[patch-fca] listenMqtt.js: av fix applied (' + count + ' occurrences).');
  } else {
    console.log('[patch-fca] listenMqtt.js: av pattern not found — check library version!');
    // Log first 200 chars of the sync form area for debugging
    const idx = listen.indexOf('syncToken');
    if (idx !== -1) console.log('[patch-fca] DEBUG syncToken context:', listen.slice(Math.max(0,idx-50), idx+200));
  }
}

console.log('[patch-fca] Done.');
