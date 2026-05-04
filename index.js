"use strict";

const path = require("path");
const fs = require("fs");

const config = require("./config.json");
const stateMod = require("./src/state");
const handler = require("./src/handler");
const { performLogin, saveAppStatePeriodically } = require("./src/login");

stateMod.init(config);

let saveInterval = null;
let restarting = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

function safeStringifyError(err) {
  if (!err) return "unknown";
  if (typeof err === "string") return err;
  if (err.error) return JSON.stringify(err);
  if (err.stack) return err.stack;
  try { return JSON.stringify(err); } catch (_) { return String(err); }
}

function tryListenSpeed(api, onEvent) {
  try {
    const listenSpeedFactory = require("./node_modules/ws3-fca/src/deltas/apis/mqtt/listenSpeed");
    const ctx = api.ctx;
    const defaultFuncs = api.defaultFuncs;
    if (!ctx || !defaultFuncs) {
      console.error("[LISTEN] listenSpeed: ctx/defaultFuncs not available");
      return null;
    }
    const listenSpeedFn = listenSpeedFactory(defaultFuncs, api, ctx);
    console.log("[LISTEN] Using listenSpeed (Lightspeed) as fallback...");
    return listenSpeedFn(onEvent);
  } catch (e) {
    console.error("[LISTEN] listenSpeed failed:", e.message);
    return null;
  }
}

async function startBot() {
  if (restarting) return;
  restarting = true;

  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.error(`[BOT] Reached max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}). Exiting.`);
    console.error("[BOT] ⚠️  Facebook is blocking connections from this server's IP.");
    console.error("[BOT] ✅  Solution: Deploy to Railway using the railway.toml already in this repo.");
    console.error("[BOT]    OR set a proxy in config.json under 'proxy': 'http://user:pass@host:port'");
    process.exit(1);
  }

  try {
    console.log(`[BOOT] Logging in to Facebook... (attempt #${reconnectAttempts + 1})`);
    const api = await performLogin(config);
    restarting = false;
    reconnectAttempts = 0;

    // Apply proxy if configured
    const setOptsPayload = {
      listenEvents: !!config.listenEvents,
      selfListen: !!config.selfListen,
      autoMarkRead: !!config.autoMarkRead,
      autoMarkDelivery: !!config.autoMarkDelivery,
      online: !!config.online,
      forceLogin: false,
      autoReconnect: false,
      updatePresence: false,
      userAgent: config.userAgent || undefined,
    };
    if (config.proxy) {
      setOptsPayload.proxy = config.proxy;
      console.log("[BOOT] Using proxy:", config.proxy.replace(/\/\/.*@/, "//***@"));
    }
    api.setOptions(setOptsPayload);

    stateMod.setApi(api);

    if (saveInterval) clearInterval(saveInterval);
    saveInterval = saveAppStatePeriodically(api, config);

    const userId =
      typeof api.getCurrentUserID === "function" ? api.getCurrentUserID() : "unknown";
    console.log(`[READY] Logged in as ${userId}. Listening for events...`);

    let lightspeedStarted = false;

    const onEvent = (err, event) => {
      if (err) {
        const msg = safeStringifyError(err);
        console.error("[LISTEN] error:", msg);

        const isBlocked =
          msg.includes("Connection refused") ||
          msg.includes("Server unavailable") ||
          msg.includes("code: 3") ||
          msg.includes("stop_listen");

        // Try Lightspeed once when MQTT is blocked
        if (isBlocked && !lightspeedStarted) {
          lightspeedStarted = true;
          console.log("[LISTEN] MQTT refused — trying Lightspeed fallback...");
          const ls = tryListenSpeed(api, onEvent);
          if (ls) {
            console.log("[LISTEN] Lightspeed listener started.");
            return;
          }
        }

        // Both failed — reconnect with backoff
        if (config.reconnectOnError) scheduleReconnect();
        return;
      }
      try {
        handler.handle(api, event);
      } catch (e) {
        console.error("[HANDLER] error:", e && e.stack ? e.stack : e);
      }
    };

    if (typeof api.listenMqtt === "function") {
      console.log("[LISTEN] Starting MQTT listener...");
      api.listenMqtt(onEvent);
    } else if (typeof api.listen === "function") {
      api.listen(onEvent);
    } else {
      console.error("[LISTEN] No listener method found. Trying Lightspeed directly...");
      const ls = tryListenSpeed(api, onEvent);
      if (!ls) scheduleReconnect();
    }

  } catch (err) {
    restarting = false;
    console.error("[BOOT] Login failed:", safeStringifyError(err));
    if (config.reconnectOnError) scheduleReconnect();
  }
}

function scheduleReconnect() {
  reconnectAttempts++;
  const base = config.reconnectDelayMs || 10000;
  const delay = Math.min(base * Math.pow(2, reconnectAttempts - 1), 5 * 60 * 1000);
  const delayStr = delay >= 60000 ? `${Math.round(delay / 60000)}m` : `${Math.round(delay / 1000)}s`;
  console.log(`[RECONNECT] attempt #${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${delayStr}...`);
  restarting = false;
  setTimeout(() => startBot(), delay);
}

process.on("uncaughtException", (e) => {
  console.error("[UNCAUGHT]", e && e.stack ? e.stack : e);
});

process.on("unhandledRejection", (e) => {
  console.error("[REJECTION]", e && e.stack ? e.stack : e);
});

startBot();
