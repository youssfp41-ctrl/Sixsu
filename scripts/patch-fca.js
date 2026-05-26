const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '../node_modules/fca-unofficial/index.js');
const listenPath = path.join(__dirname, '../node_modules/fca-unofficial/src/listenMqtt.js');
const utilsPath = path.join(__dirname, '../node_modules/fca-unofficial/utils.js');

// ---- Patch 1: index.js — Facebook 2025+ MqttWebConfig regex ----
let idx = fs.readFileSync(indexPath, 'utf8');
if (!idx.includes('quotedFBMQTTMatch')) {
  const OLD = `      } else {
        log.warn("login", "Cannot get MQTT region & sequence ID.");
        noMqttData = html;
      }`;
  const NEW = `      } else {
        // Facebook 2025+: quoted JSON keys in MqttWebConfig
        var quotedFBMQTTMatch = html.match(/\\["MqttWebConfig",\\[\\],\\{"fbid":"(.+?)","appID":219994525426954,"endpoint":"(.+?)"/);
        if (quotedFBMQTTMatch) {
          mqttEndpoint = quotedFBMQTTMatch[2].replace(/\\\\\/g, "/");
          region = new URL(mqttEndpoint).searchParams.get("region").toUpperCase();
          log.info("login", \`Got this account's message region: \${region}\`);
        } else {
          log.warn("login", "Cannot get MQTT region & sequence ID.");
          noMqttData = html;
        }
      }`;
  if (idx.includes(OLD)) {
    idx = idx.replace(OLD, NEW);
    fs.writeFileSync(indexPath, idx);
    console.log('[patch-fca] index.js: MqttWebConfig 2025+ regex patched OK');
  } else {
    console.warn('[patch-fca] index.js: target not found, skipping');
  }
} else {
  console.log('[patch-fca] index.js: already patched');
}

// ---- Patch 2: utils.js — Modern fb_dtsg extraction (DTSGInitData format) ----
let utils = fs.readFileSync(utilsPath, 'utf8');
const OLD_DTSG = "  var fb_dtsg = getFrom(html, 'name=\"fb_dtsg\" value=\"', '\"');";
const NEW_DTSG = `  var fb_dtsg = getFrom(html, 'name="fb_dtsg" value="', '"');
  // Facebook 2025+: fb_dtsg is in DTSGInitData, not a form field
  if (!fb_dtsg) {
    var dtsgMatch = html.match(/"DTSGInitData",\\[\\],\\{"token":"([^"]+)"/);
    if (dtsgMatch) {
      fb_dtsg = dtsgMatch[1];
      log.info("makeDefaults", "Extracted fb_dtsg via DTSGInitData pattern");
    }
  }`;
if (utils.includes(OLD_DTSG)) {
  utils = utils.replace(OLD_DTSG, NEW_DTSG);
  fs.writeFileSync(utilsPath, utils);
  console.log('[patch-fca] utils.js: DTSGInitData fb_dtsg extraction patched OK');
} else {
  // Try alternative match
  const ALT = "var fb_dtsg = getFrom(html, 'name=\"fb_dtsg\" value=\"', '\"');";
  if (utils.includes(ALT)) {
    utils = utils.replace(ALT, NEW_DTSG.replace('  ', ''));
    fs.writeFileSync(utilsPath, utils);
    console.log('[patch-fca] utils.js: DTSGInitData fb_dtsg patched (alt match) OK');
  } else if (utils.includes('DTSGInitData')) {
    console.log('[patch-fca] utils.js: already patched');
  } else {
    // Direct regex replacement
    const re = /var fb_dtsg = getFrom\(html, 'name="fb_dtsg" value="', '"'\);/;
    if (re.test(utils)) {
      utils = utils.replace(re, `var fb_dtsg = getFrom(html, 'name="fb_dtsg" value="', '"');
  if (!fb_dtsg) { var dtsgM = html.match(/"DTSGInitData",\\[\\],\\{"token":"([^"]+)"/); if (dtsgM) { fb_dtsg = dtsgM[1]; } }`);
      fs.writeFileSync(utilsPath, utils);
      console.log('[patch-fca] utils.js: DTSGInitData fb_dtsg patched via regex OK');
    } else {
      console.warn('[patch-fca] utils.js: COULD NOT PATCH fb_dtsg extraction');
    }
  }
}

// ---- Patch 3: listenMqtt.js — fix av field + resilient catch handler ----
let lmq = fs.readFileSync(listenPath, 'utf8');

// Fix ALL occurrences of av field
const avOld = '"av": ctx.globalOptions.pageID,';
const avNew = '"av": ctx.globalOptions.pageID || ctx.userID,';
const avCount = (lmq.split(avOld).length - 1);
if (avCount > 0) {
  lmq = lmq.split(avOld).join(avNew);
  console.log('[patch-fca] listenMqtt.js: fixed av in', avCount, 'location(s)');
} else {
  console.log('[patch-fca] listenMqtt.js: av already patched');
}

// Fix resilient catch handler for getSeqId
const OLD_CATCH = `      .catch((err) => {
        log.error("getSeqId", err);
        if (utils.getType(err) == "Object" && err.error === "Not logged in") {
          ctx.loggedIn = false;
        }
        return globalCallback(err);
      });`;
const NEW_CATCH = `      .catch((err) => {
        log.warn("getSeqId", "getSeqId failed, proceeding without seqId:", err && err.error || String(err));
        listenMqtt(defaultFuncs, api, ctx, globalCallback);
      });`;
if (lmq.includes(OLD_CATCH)) {
  lmq = lmq.replace(OLD_CATCH, NEW_CATCH);
  console.log('[patch-fca] listenMqtt.js: catch handler patched OK');
} else if (lmq.includes('proceeding without seqId')) {
  console.log('[patch-fca] listenMqtt.js: catch already patched');
} else {
  console.warn('[patch-fca] listenMqtt.js: catch target not found');
}

fs.writeFileSync(listenPath, lmq);
const avFixed = (lmq.match(/ctx\.globalOptions\.pageID \|\| ctx\.userID/g) || []).length;
console.log('[patch-fca] listenMqtt.js: Done. av||userID in', avFixed, 'location(s)');
console.log('[patch-fca] All patches complete.');
