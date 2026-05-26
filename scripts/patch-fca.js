const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '../node_modules/fca-unofficial/index.js');
const listenPath = path.join(__dirname, '../node_modules/fca-unofficial/src/listenMqtt.js');

// ---- Patch index.js: add Facebook 2025+ MqttWebConfig regex ----
let idx = fs.readFileSync(indexPath, 'utf8');
const OLD_MQTT_BLOCK = `      } else {
        log.warn("login", "Cannot get MQTT region & sequence ID.");
        noMqttData = html;
      }`;
const NEW_MQTT_BLOCK = `      } else {
        // Facebook 2025+: quoted JSON keys in MqttWebConfig
        let quotedFBMQTTMatch = html.match(/\\["MqttWebConfig",\\[\\],\\{"fbid":"(.+?)","appID":219994525426954,"endpoint":"(.+?)"/);
        if (quotedFBMQTTMatch) {
          mqttEndpoint = quotedFBMQTTMatch[2].replace(/\\\\\//g, "/");
          region = new URL(mqttEndpoint).searchParams.get("region").toUpperCase();
          log.info("login", \`Got this account's message region: \${region}\`);
        } else {
          log.warn("login", "Cannot get MQTT region & sequence ID.");
          noMqttData = html;
        }
      }`;
if (idx.includes(OLD_MQTT_BLOCK)) {
  idx = idx.replace(OLD_MQTT_BLOCK, NEW_MQTT_BLOCK);
  fs.writeFileSync(indexPath, idx);
  console.log('[patch-fca] index.js: MqttWebConfig regex patched OK');
} else if (idx.includes('quotedFBMQTTMatch')) {
  console.log('[patch-fca] index.js: already patched');
} else {
  console.warn('[patch-fca] index.js: patch target not found — skipping');
}

// ---- Patch listenMqtt.js: fix av field + resilient catch handler ----
let lmq = fs.readFileSync(listenPath, 'utf8');

// Fix 1: av field
if (lmq.includes('"av": ctx.globalOptions.pageID,')) {
  lmq = lmq.replace('"av": ctx.globalOptions.pageID,', '"av": ctx.globalOptions.pageID || ctx.userID,');
  console.log('[patch-fca] listenMqtt.js: av fix OK');
} else if (lmq.includes('ctx.globalOptions.pageID || ctx.userID')) {
  console.log('[patch-fca] listenMqtt.js: av already patched');
}

// Fix 2: catch handler
const OLD_CATCH = `      .catch((err) => {
        log.error("getSeqId", err);
        if (utils.getType(err) == "Object" && err.error === "Not logged in") {
          ctx.loggedIn = false;
        }
        return globalCallback(err);
      });`;
const NEW_CATCH = `      .catch((err) => {
        log.warn("getSeqId", "Failed to get seqId, connecting without it:", JSON.stringify(err));
        listenMqtt(defaultFuncs, api, ctx, globalCallback);
      });`;
if (lmq.includes(OLD_CATCH)) {
  lmq = lmq.replace(OLD_CATCH, NEW_CATCH);
  console.log('[patch-fca] listenMqtt.js: catch handler patched OK');
} else if (lmq.includes('Failed to get seqId')) {
  console.log('[patch-fca] listenMqtt.js: catch already patched');
} else {
  console.warn('[patch-fca] listenMqtt.js: catch target not found — skipping');
}
fs.writeFileSync(listenPath, lmq);
console.log('[patch-fca] Done.');
