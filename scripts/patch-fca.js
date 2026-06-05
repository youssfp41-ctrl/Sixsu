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

// ── Fix 2: buildAPI null-check + error propagation in fca-unofficial-fixed ────
// Bug A: `if (userCookie.length === 0 && ...)` crashes with TypeError
//         "Cannot read properties of undefined (reading 'length')" when the
//         c_user/i_user cookies are absent (expired or invalid appState).
// Bug B: `return log.error('login', "...")` silently returns undefined instead
//         of propagating the error to the caller — MiraiTransport never sees a
//         meaningful error message and retries pointlessly.
// Bug C: checkpoint detection also uses return-log-error, same issue.
//
// Fix:  Replace with proper null-guard + throw so the error propagates through
//       the promise chain to MiraiTransport's callback. MiraiTransport then
//       detects "appstate die" / "cookie not found" and stops retrying with a
//       clear "please refresh FB_APPSTATE" message in the logs.
if (fs.existsSync(indexPath1)) {
  let content = fs.readFileSync(indexPath1, 'utf8');
  let changed = false;

  // Fix A: swap buggy length check to proper null-guard
  const NULL_BUG = 'if (userCookie.length === 0 && tiktikCookie.length === 0) {';
  const NULL_FIX = 'if (!userCookie && !tiktikCookie) {';
  if (content.includes(NULL_BUG)) {
    content = content.split(NULL_BUG).join(NULL_FIX);
    changed = true;
    console.log('[patch-fca] index.js — buildAPI null-check fix applied.');
  } else if (content.includes(NULL_FIX)) {
    console.log('[patch-fca] index.js — buildAPI null-check already fixed.');
  } else {
    console.log('[patch-fca] index.js — buildAPI null-check pattern not found (different version).');
  }

  // Fix B: replace silent return-log-error with throw for "cookie not found"
  const RET_NOTFOUND_BUG = 'return log.error(\'login\', "Không tìm thấy cookie cho người dùng, vui lòng kiểm tra lại thông tin đăng nhập")';
  const RET_NOTFOUND_FIX = 'throw new Error("FB_APPSTATE expired: c_user/i_user cookie not found — please refresh FB_APPSTATE.")';
  const notFoundCount = content.split(RET_NOTFOUND_BUG).length - 1;
  if (notFoundCount > 0) {
    content = content.split(RET_NOTFOUND_BUG).join(RET_NOTFOUND_FIX);
    changed = true;
    console.log('[patch-fca] index.js — buildAPI cookie-not-found throw fix applied (' + notFoundCount + ' occurrence(s)).');
  }

  // Fix C: replace silent return-log-error with throw for checkpoint page
  const RET_CHECKPOINT_BUG = 'return log.error(\'login\', "Appstate die, vui lòng thay cái mới!", \'error\');';
  const RET_CHECKPOINT_FIX = 'throw new Error("Appstate die: Facebook returned a checkpoint/blocked page — please refresh FB_APPSTATE.");';
  if (content.includes(RET_CHECKPOINT_BUG)) {
    content = content.split(RET_CHECKPOINT_BUG).join(RET_CHECKPOINT_FIX);
    changed = true;
    console.log('[patch-fca] index.js — buildAPI checkpoint throw fix applied.');
  }

  if (changed) fs.writeFileSync(indexPath1, content);
}

console.log('[patch-fca] Done.');
