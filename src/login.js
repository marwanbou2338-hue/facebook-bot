"use strict";

const fs = require("fs");
const path = require("path");

function resolveLoginFn() {
    let mod;
    try {
        mod = require("ws3-fca");
    } catch (e) {
        try {
            mod = require("fca-unofficial");
        } catch (e2) {
            console.error("[LOGIN] No Facebook chat library found. Install ws3-fca.");
            throw e2;
        }
    }
    if (typeof mod === "function") return mod;
    if (mod && typeof mod.login === "function") return mod.login;
    if (mod && typeof mod.default === "function") return mod.default;
    if (mod && mod.default && typeof mod.default.login === "function") return mod.default.login;
    throw new Error("Could not locate login() function in fca module export.");
}

const login = resolveLoginFn();

/**
 * Read appstate from:
 * 1. APPSTATE environment variable (JSON string) — best for Railway
 * 2. appstate.json file
 */
function readAppState(appStatePath) {
    // Prefer environment variable (works on Railway with ephemeral filesystem)
    const envAppState = process.env.APPSTATE;
    if (envAppState) {
        try {
            const parsed = JSON.parse(envAppState);
            if (Array.isArray(parsed) && parsed.length > 0) {
                console.log("[LOGIN] Using appstate from APPSTATE environment variable.");
                return parsed;
            }
        } catch (e) {
            console.warn("[LOGIN] APPSTATE env var is set but couldn't parse it:", e.message);
        }
    }

    // Fall back to file
    try {
        const raw = fs.readFileSync(appStatePath, "utf-8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        return null;
    } catch (e) {
        return null;
    }
}

/**
 * Save appstate to file.
 * On Railway, the file path is /tmp/appstate.json to survive
 * across restarts within the same instance.
 */
function resolveWritePath(appStatePath) {
    // If the directory isn't writable (e.g. Railway read-only), use /tmp
    try {
        const dir = path.dirname(appStatePath);
        fs.accessSync(dir, fs.constants.W_OK);
        return appStatePath;
    } catch (e) {
        return "/tmp/appstate.json";
    }
}

function writeAppState(appStatePath, appState) {
    const writePath = resolveWritePath(appStatePath);
    try {
        fs.writeFileSync(writePath, JSON.stringify(appState, null, 2));
        return true;
    } catch (e) {
        console.error("[LOGIN] Failed to save appstate:", e.message);
        return false;
    }
}

function buildLoginOptions(config, appStatePath) {
    const appState = readAppState(appStatePath);
    if (appState) {
        return { type: "appstate", payload: { appState } };
    }

    // Also check FB_EMAIL / FB_PASSWORD env vars (Railway secrets)
    const email = process.env.FB_EMAIL || (config.credentials && config.credentials.email);
    const password = process.env.FB_PASSWORD || (config.credentials && config.credentials.password);
    if (email && password) {
        return { type: "credentials", payload: { email, password } };
    }
    return null;
}

function attemptLogin(opts) {
    return new Promise((resolve, reject) => {
        try {
            login(opts, (err, api) => {
                if (err) return reject(err);
                resolve(api);
            });
        } catch (e) {
            reject(e);
        }
    });
}

async function performLogin(config) {
    const appStatePath = path.resolve(__dirname, "..", config.appStatePath || "./appstate.json");
    const opts = buildLoginOptions(config, appStatePath);

    if (!opts) {
        throw new Error(
            "لا يوجد appstate أو credentials. أضف APPSTATE كمتغير بيئة على Railway، أو ضع بيانات الدخول في config.json."
        );
    }

    if (opts.type === "appstate") {
        try {
            const api = await attemptLogin(opts.payload);
            try {
                const fresh = api.getAppState();
                if (Array.isArray(fresh) && fresh.length > 0) {
                    writeAppState(appStatePath, fresh);
                }
            } catch (e) { /* ignore */ }
            return api;
        } catch (err) {
            console.error("[LOGIN] AppState login failed:", err && err.error ? err.error : err);
            const email = process.env.FB_EMAIL || (config.credentials && config.credentials.email);
            const password = process.env.FB_PASSWORD || (config.credentials && config.credentials.password);
            if (config.autoRefreshAppState && email && password) {
                console.log("[LOGIN] Falling back to credentials to refresh appstate...");
                return await loginWithCredentialsAndRefresh(email, password, appStatePath);
            }
            throw err;
        }
    }

    return await loginWithCredentialsAndRefresh(
        opts.payload.email,
        opts.payload.password,
        appStatePath
    );
}

async function loginWithCredentialsAndRefresh(email, password, appStatePath) {
    const api = await attemptLogin({ email, password });
    try {
        const fresh = api.getAppState();
        if (Array.isArray(fresh) && fresh.length > 0) {
            writeAppState(appStatePath, fresh);
            console.log("[LOGIN] AppState refreshed and saved.");
        }
    } catch (e) {
        console.error("[LOGIN] Could not extract appstate after credential login:", e.message);
    }
    return api;
}

function saveAppStatePeriodically(api, config) {
    const appStatePath = path.resolve(__dirname, "..", config.appStatePath || "./appstate.json");
    const intervalMs = config.appStateSaveIntervalMs || 5 * 60 * 1000;
    return setInterval(() => {
        try {
            const fresh = api.getAppState();
            if (Array.isArray(fresh) && fresh.length > 0) {
                writeAppState(appStatePath, fresh);
            }
        } catch (e) { /* ignore */ }
    }, intervalMs);
}

module.exports = { performLogin, saveAppStatePeriodically };
