"use strict";

// ─── Step 1: Apply patches to ws3-fca before anything else ───────────────────
// This ensures fixes survive npm install on Railway
require("./patches/apply");

// ─── Step 2: Load bot modules ─────────────────────────────────────────────────
const config     = require("./config.json");
const stateMod   = require("./src/state");
const handler    = require("./src/handler");
const { performLogin, saveAppStatePeriodically } = require("./src/login");

// Support environment variable overrides for Railway deployment
if (process.env.PREFIX)       config.prefix = process.env.PREFIX;
if (process.env.SUPER_ADMINS) config.superAdmins = process.env.SUPER_ADMINS.split(",").map(s => s.trim());
if (process.env.PROXY)        config.proxy = process.env.PROXY;

stateMod.init(config);

// ─── State ────────────────────────────────────────────────────────────────────
let saveInterval       = null;
let restarting         = false;
let reconnectAttempts  = 0;
const MAX_RECONNECTS   = 10;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function safeErr(e) {
    if (!e) return "unknown";
    if (typeof e === "string") return e;
    if (e.error) return JSON.stringify(e);
    if (e.stack) return e.stack;
    try { return JSON.stringify(e); } catch (_) { return String(e); }
}

function tryListenSpeed(api, onEvent) {
    try {
        const factory = require("./node_modules/ws3-fca/src/deltas/apis/mqtt/listenSpeed");
        const ctx = api.ctx;
        const dFuncs = api.defaultFuncs;
        if (!ctx || !dFuncs) {
            console.error("[LISTEN] listenSpeed: ctx/defaultFuncs unavailable");
            return null;
        }
        const fn = factory(dFuncs, api, ctx);
        console.log("[LISTEN] Starting Lightspeed (gateway.facebook.com) fallback...");
        return fn(onEvent);
    } catch (e) {
        console.error("[LISTEN] listenSpeed init failed:", e.message);
        return null;
    }
}

// ─── Main bot loop ────────────────────────────────────────────────────────────
async function startBot() {
    if (restarting) return;
    restarting = true;

    if (reconnectAttempts >= MAX_RECONNECTS) {
        console.error(`[BOT] Reached max reconnect attempts (${MAX_RECONNECTS}). Stopping.`);
        console.error("[BOT] ────────────────────────────────────────────────────");
        console.error("[BOT] If running on Replit: Facebook blocks Replit IPs.");
        console.error("[BOT] ✅ Solution: Deploy to Railway — already configured.");
        console.error("[BOT]    Or set PROXY environment variable.");
        console.error("[BOT] ────────────────────────────────────────────────────");
        process.exit(1);
    }

    try {
        console.log(`[BOOT] Connecting to Facebook... (attempt #${reconnectAttempts + 1})`);
        const api = await performLogin(config);
        restarting  = false;
        reconnectAttempts = 0;

        // Options
        const opts = {
            listenEvents:    !!config.listenEvents,
            selfListen:      !!config.selfListen,
            autoMarkRead:    !!config.autoMarkRead,
            autoMarkDelivery:!!config.autoMarkDelivery,
            online:          !!config.online,
            forceLogin:      false,
            autoReconnect:   false,  // We manage reconnects ourselves
            updatePresence:  false,
            userAgent:       config.userAgent || undefined,
        };
        if (config.proxy) {
            opts.proxy = config.proxy;
            console.log("[BOOT] Proxy active:", config.proxy.replace(/\/\/.*@/, "//***@"));
        }
        api.setOptions(opts);
        stateMod.setApi(api);

        // Periodic appstate save
        if (saveInterval) clearInterval(saveInterval);
        saveInterval = saveAppStatePeriodically(api, config);

        const uid = typeof api.getCurrentUserID === "function" ? api.getCurrentUserID() : "?";
        console.log(`[READY] ✓ Logged in as ${uid} | prefix="${config.prefix}"`);

        // ── Event listener ──────────────────────────────────────────────────
        let lightspeedStarted = false;

        const onEvent = (err, event) => {
            if (err) {
                const msg = safeErr(err);
                console.error("[LISTEN] error:", msg);

                const isBlocked =
                    msg.includes("Connection refused") ||
                    msg.includes("Server unavailable") ||
                    msg.includes("code: 3") ||
                    msg.includes("stop_listen");

                // Try Lightspeed once when MQTT is blocked
                if (isBlocked && !lightspeedStarted) {
                    lightspeedStarted = true;
                    const ls = tryListenSpeed(api, onEvent);
                    if (ls) { console.log("[LISTEN] Lightspeed started."); return; }
                }

                // Both failed — reconnect
                if (config.reconnectOnError) scheduleReconnect();
                return;
            }

            try {
                handler.handle(api, event);
            } catch (e) {
                console.error("[HANDLER]", e && e.stack ? e.stack : e);
            }
        };

        if (typeof api.listenMqtt === "function") {
            console.log("[LISTEN] Starting MQTT listener...");
            api.listenMqtt(onEvent);
        } else if (typeof api.listen === "function") {
            api.listen(onEvent);
        } else {
            console.error("[LISTEN] No listener method found. Trying Lightspeed...");
            const ls = tryListenSpeed(api, onEvent);
            if (!ls) scheduleReconnect();
        }

    } catch (err) {
        restarting = false;
        console.error("[BOOT] Login failed:", safeErr(err));
        if (config.reconnectOnError) scheduleReconnect();
    }
}

function scheduleReconnect() {
    reconnectAttempts++;
    const base  = config.reconnectDelayMs || 10000;
    const delay = Math.min(base * Math.pow(2, reconnectAttempts - 1), 5 * 60 * 1000);
    const label = delay >= 60000 ? `${Math.round(delay / 60000)}m` : `${Math.round(delay / 1000)}s`;
    console.log(`[RECONNECT] attempt #${reconnectAttempts}/${MAX_RECONNECTS} in ${label}`);
    restarting = false;
    setTimeout(() => startBot(), delay);
}

// ─── Global error handlers ────────────────────────────────────────────────────
process.on("uncaughtException",   e => console.error("[UNCAUGHT]", e && e.stack ? e.stack : e));
process.on("unhandledRejection",  e => console.error("[REJECTION]", e && e.stack ? e.stack : e));

// ─── Start ────────────────────────────────────────────────────────────────────
startBot();
