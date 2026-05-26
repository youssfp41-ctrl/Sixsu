const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '../node_modules/fca-unofficial/index.js');
const listenPath = path.join(__dirname, '../node_modules/fca-unofficial/src/listenMqtt.js');

// ---- Patch index.js: Facebook 2025+ MqttWebConfig regex ----
let idx = fs.readFileSync(indexPath, 'utf8');
if (!idx.includes('quotedFBMQTTMatch')) {
  const OLD = `      } else {
        log.warn("login", "Cannot get MQTT region & sequence ID.");
        noMqttData = html;
      }`;
  const NEW = `      } else {
        // Facebook 2025+: quoted JSON keys
        let quotedFBMQTTMatch = html.match(/["MqttWebConfig",\\[\\],{"fbid":"(.+?)","appID":219994525426954,"endpoint":"(.+?)"/);
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
    console.log('[patch-fca] index.js: MqttWebConfig regex patched OK');
  } else {
    console.warn('[patch-fca] index.js: patch target not found');
  }
} else {
  console.log('[patch-fca] index.js: already patched');
}

// ---- Patch listenMqtt.js: fix av and catch handler ----
let lmq = fs.readFileSync(listenPath, 'utf8');

// Fix ALL occurrences of av field (deltaMessageReply + getSeqId form at line ~764)
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
        log.warn("getSeqId", "getSeqId failed, connecting without seqId:", err && err.error || String(err));
        listenMqtt(defaultFuncs, api, ctx, globalCallback);
      });`;
if (lmq.includes(OLD_CATCH)) {
  lmq = lmq.replace(OLD_CATCH, NEW_CATCH);
  console.log('[patch-fca] listenMqtt.js: catch handler patched OK');
} else if (lmq.includes('connecting without seqId')) {
  console.log('[patch-fca] listenMqtt.js: catch already patched');
} else {
  console.warn('[patch-fca] listenMqtt.js: catch target not found');
}

fs.writeFileSync(listenPath, lmq);
const avFixed = (lmq.match(/ctx\.globalOptions\.pageID \|\| ctx\.userID/g) || []).length;
console.log('[patch-fca] Done. av||userID present in', avFixed, 'location(s)');
