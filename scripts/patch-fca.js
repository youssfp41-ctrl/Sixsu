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
const dongdevBase   = path.join(__dirname, '../node_modules/@dongdev/fca-unofficial');
const dongdevBundle = path.join(dongdevBase, 'dist/index.js');
const dongdevCjs    = path.join(dongdevBase, 'dist/cjs.cjs');

const dongdevFiles = [dongdevBundle, dongdevCjs].filter(p => fs.existsSync(p));
if (dongdevFiles.length === 0) {
  console.warn('[patch-fca] @dongdev/fca-unofficial not found at expected paths — skipping.');
} else {
  console.log('[patch-fca] @dongdev found:', dongdevFiles.map(p => path.basename(p)).join(', '));
}

// ── Fix 1: av=pageID bug in MQTT syncToken requests ──────────────────────────
// Bug:  av: ctx.globalOptions.pageID  — pageID is undefined for non-Page bots.
// This causes the MQTT syncToken GraphQL request to fail -> no messages arrive.
// Fix:  av: ctx.globalOptions.pageID || ctx.userID
const AV_BUG = 'av: ctx.globalOptions.pageID,';
const AV_FIX = 'av: ctx.globalOptions.pageID || ctx.userID,';

const allTargets = [listenPath1, ...dongdevFiles];
for (const filePath of allTargets) {
  if (!fs.existsSync(filePath)) continue;
  let content = fs.readFileSync(filePath, 'utf8');

  const bugCount   = content.split(AV_BUG).length - 1;
  const fixedCount = content.split(AV_FIX).length - 1;

  if (bugCount === 0 && fixedCount === 0) {
    console.log('[patch-fca]', path.basename(filePath), '— av pattern not found (different lib version?)');
    continue;
  }
  if (bugCount === 0) {
    console.log('[patch-fca]', path.basename(filePath), '— av fix already applied (' + fixedCount + ' occurrences).');
    continue;
  }

  const patched = content.split(AV_BUG).join(AV_FIX);
  fs.writeFileSync(filePath, patched);
  console.log('[patch-fca]', path.basename(filePath), '— av fix applied (' + bugCount + ' fixed, ' + fixedCount + ' already fixed).');
}

// ── Fix 2: buildAPI null-check bug in fca-unofficial-fixed/index.js ──────────
// Bug:  `if (userCookie.length === 0 && tiktikCookie.length === 0) {`
//       crashes with TypeError "Cannot read properties of undefined (reading
//       'length')" when the c_user cookie is absent because the appState is
//       expired or invalid. The code reads .length before checking for undefined.
// Fix:  swap to proper null-guard so we fail cleanly instead of crashing with
//       a cryptic TypeError. The subsequent else-if becomes dead code but is
//       harmless (it was already the correct check).
if (fs.existsSync(indexPath1)) {
  let content = fs.readFileSync(indexPath1, 'utf8');

  const BUILDAPI_BUG = 'if (userCookie.length === 0 && tiktikCookie.length === 0) {';
  const BUILDAPI_FIX = 'if (!userCookie && !tiktikCookie) {';

  if (content.includes(BUILDAPI_BUG)) {
    const patched = content.split(BUILDAPI_BUG).join(BUILDAPI_FIX);
    fs.writeFileSync(indexPath1, patched);
    console.log('[patch-fca] index.js — buildAPI null-check fix applied (prevents TypeError when appState expired).');
  } else if (content.includes(BUILDAPI_FIX)) {
    console.log('[patch-fca] index.js — buildAPI null-check already fixed.');
  } else {
    console.log('[patch-fca] index.js — buildAPI null-check pattern not found (different version?).');
  }
}

console.log('[patch-fca] Done.');
