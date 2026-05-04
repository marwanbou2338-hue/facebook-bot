"use strict";

/**
 * Applies patches to ws3-fca at startup.
 * This runs before the bot starts so patches survive npm install on Railway.
 */

const fs = require("fs");
const path = require("path");

const BASE = path.join(__dirname, "..", "node_modules", "ws3-fca", "src");

const PATCHES = [
    {
        src: path.join(__dirname, "buildAPI.js"),
        dest: path.join(BASE, "core", "models", "buildAPI.js"),
        name: "buildAPI (multi-regex irisSeqID)",
    },
    {
        src: path.join(__dirname, "listenMqtt.js"),
        dest: path.join(BASE, "deltas", "apis", "mqtt", "listenMqtt.js"),
        name: "listenMqtt (reconnectPeriod=0, fresh clientID, safe error handler)",
    },
    {
        src: path.join(__dirname, "listenSpeed.js"),
        dest: path.join(BASE, "deltas", "apis", "mqtt", "listenSpeed.js"),
        name: "listenSpeed (max retries + give up)",
    },
];

let applied = 0;
let failed = 0;

for (const patch of PATCHES) {
    try {
        if (!fs.existsSync(patch.dest)) {
            console.warn(`[PATCH] Destination not found, skipping: ${patch.dest}`);
            failed++;
            continue;
        }
        fs.copyFileSync(patch.src, patch.dest);
        console.log(`[PATCH] ✓ ${patch.name}`);
        applied++;
    } catch (e) {
        console.error(`[PATCH] ✗ ${patch.name}: ${e.message}`);
        failed++;
    }
}

console.log(`[PATCH] Done — ${applied} applied, ${failed} failed.`);
