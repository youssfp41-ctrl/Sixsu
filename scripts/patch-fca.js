const fs   = require('fs');
const path = require('path');

// ── Library 1: fca-unofficial-fixed ──────────────────────────────────────────
const base1      = path.join(__dirname, '../node_modules/fca-unofficial-fixed');
const indexPath1 = path.join(base1, 'index.js');
const listenPath1= path.join(base1, 'src/listenMqtt.js');
const utilsPath1 = path.join(base1, 'utils.js');

for (const p of [indexPath1, listenPath1, utilsPath1]) {
  if (!fs.existsSync(p)) console.warn('[patch-fca] Not found:', p);
  else console.log('[patch-fca] OK:', path.basename(p));
}

// ── Library 2: @dongdev/fca-unofficial (actually-executed bundle) ─────────────
// This is the real runtime library. The critical av=pageID bug that
// prevents message reception is in this bundled dist file.
const dongdevBase   = path.join(__dirname, '../node_modules/@dongdev/fca-unofficial');
const dongdevBundle = path.join(dongdevBase, 'dist/index.js');
const dongdevCjs    = path.join(dongdevBase, 'dist/cjs.cjs');

const dongdevFiles = [dongdevBundle, dongdevCjs].filter(p => fs.existsSync(p));
if (dongdevFiles.length === 0) {
  console.warn('[patch-fca] @dongdev/fca-unofficial not found at expected paths — skipping.');
} else {
  console.log('[patch-fca] @dongdev found:', dongdevFiles.map(p => path.basename(p)).join(', '));
}

// ── Apply av fix to all found files ──────────────────────────────────────────
// Bug: av: ctx.globalOptions.pageID  — pageID is undefined for non-Page bots.
// This causes the MQTT syncToken GraphQL request to fail → no messages arrive.
// Fix: av: ctx.globalOptions.pageID || ctx.userID
const BUG = 'av: ctx.globalOptions.pageID,';
const FIX = 'av: ctx.globalOptions.pageID || ctx.userID,';

const allTargets = [listenPath1, ...dongdevFiles];
for (const filePath of allTargets) {
  if (!fs.existsSync(filePath)) continue;
  let content = fs.readFileSync(filePath, 'utf8');

  const bugCount   = content.split(BUG).length - 1;
  const fixedCount = content.split(FIX).length - 1;

  if (bugCount === 0 && fixedCount === 0) {
    console.log('[patch-fca]', path.basename(filePath), '— av pattern not found (different lib version?)');
    continue;
  }
  if (bugCount === 0) {
    console.log('[patch-fca]', path.basename(filePath), '— av fix already applied (' + fixedCount + ' occurrences).');
    continue;
  }

  const patched = content.split(BUG).join(FIX);
  fs.writeFileSync(filePath, patched);
  console.log('[patch-fca]', path.basename(filePath), '— av fix applied (' + bugCount + ' fixed, ' + fixedCount + ' already fixed).');
}

console.log('[patch-fca] Done.');
