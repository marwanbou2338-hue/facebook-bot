/**
 * ╔══════════════════════════════════════════╗
 * ║         بوت ماسنجر المجموعات            ║
 * ║  يعتمد على appstate للمصادقة            ║
 * ╚══════════════════════════════════════════╝
 *
 * الهيكل:
 *   index.js         — نقطة الدخول الرئيسية
 *   config.json      — الإعدادات (superAdminId، المحرك، القفل)
 *   commands/        — معالجات الأوامر
 *   systems/         — المحرك والقفل
 *   utils/           — مساعدات (config، permissions)
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const { login } = require("ws3-fca");

const { loadConfig }                             = require("./utils/config");
const { isBotAdmin, isSuperAdmin }               = require("./utils/permissions");
const { isLocked }                               = require("./systems/lock");
const { recordActivity, restoreActiveEngines }   = require("./systems/engine");

// ─── تحميل الأوامر ─────────────────────────────────────────────────────────

const COMMANDS_DIR = path.join(__dirname, "commands");

/**
 * خريطة تربط اسم الأمر بوحدته
 * @type {Map<string, object>}
 */
const commandMap = new Map();

fs.readdirSync(COMMANDS_DIR)
  .filter((f) => f.endsWith(".js"))
  .forEach((file) => {
    const cmd = require(path.join(COMMANDS_DIR, file));
    commandMap.set(cmd.name, cmd);
    if (Array.isArray(cmd.aliases)) {
      cmd.aliases.forEach((alias) => commandMap.set(alias, cmd));
    }
    console.log(`[Commands] تم تحميل الأمر: ${cmd.name}`);
  });

// ─── تحميل ملف appstate ────────────────────────────────────────────────────

const APPSTATE_PATH = path.join(__dirname, "appstate.json");

if (!fs.existsSync(APPSTATE_PATH)) {
  console.error(
    "\n❌ ملف appstate.json غير موجود!\n" +
    "   ضع ملف appstate.json في مجلد bot/ ثم أعد تشغيل البوت.\n"
  );
  process.exit(1);
}

let appState;
try {
  appState = JSON.parse(fs.readFileSync(APPSTATE_PATH, "utf8"));
} catch (err) {
  console.error("❌ خطأ في قراءة appstate.json:", err.message);
  process.exit(1);
}

// ─── خيارات تسجيل الدخول ───────────────────────────────────────────────────

const LOGIN_OPTIONS = {
  selfListen:       false,
  listenEvents:     true,
  updatePresence:   false,
  autoMarkDelivery: false,
  autoMarkRead:     false,
  forceLogin:       true,
  autoReconnect:    false,  // نحن نتحكم في إعادة الاتصال لضمان irisSeqID جديد
};

// ─── دالة حفظ appstate المحدّث ─────────────────────────────────────────────

/**
 * حفظ ملف appstate لتجديد الكوكيز
 * @param {object} api
 */
function saveAppState(api) {
  try {
    fs.writeFileSync(APPSTATE_PATH, JSON.stringify(api.getAppState(), null, 2));
    console.log("[AppState] تم تحديث appstate.json");
  } catch (e) {
    console.error("[AppState] خطأ في حفظ appstate:", e.message);
  }
}

// ─── دالة الاتصال الرئيسية ─────────────────────────────────────────────────

let reconnectAttempts = 0;

/**
 * بدء الاتصال بـ Facebook Messenger
 * مع آلية إعادة المحاولة عند الفشل
 */
function startBot() {
  reconnectAttempts++;
  const delay = reconnectAttempts === 1 ? 0 : Math.min(5000 * reconnectAttempts, 60000);

  setTimeout(() => {
    console.log(`\n🚀 جاري تشغيل البوت... (محاولة #${reconnectAttempts})`);

    // إعادة تحميل appstate من الملف لضمان أحدث كوكيز
    let currentAppState;
    try {
      currentAppState = JSON.parse(fs.readFileSync(APPSTATE_PATH, "utf8"));
    } catch (e) {
      console.error("❌ خطأ في قراءة appstate.json:", e.message);
      return;
    }

    login({ appState: currentAppState }, LOGIN_OPTIONS, (err, api) => {
      if (err) {
        console.error("❌ فشل تسجيل الدخول:", err.error || err.message || err);
        console.log(`⏳ إعادة المحاولة بعد ${Math.min(15 * reconnectAttempts, 60)} ثانية...`);
        setTimeout(startBot, Math.min(15000 * reconnectAttempts, 60000));
        return;
      }

      reconnectAttempts = 0; // إعادة ضبط عداد المحاولات عند النجاح
      const myID = api.getCurrentUserID();
      console.log(`✅ تم تسجيل الدخول بنجاح! (ID: ${myID})\n`);

      // حفظ دوري لـ appstate كل 30 دقيقة لتجديد الكوكيز
      const appStateSaveTimer = setInterval(() => saveAppState(api), 30 * 60 * 1000);

      // استعادة المحركات النشطة من الجلسة السابقة
      restoreActiveEngines(api);

      // ─── الاستماع للأحداث عبر MQTT ──────────────────────────────
      api.listenMqtt((listenErr, event) => {
        if (listenErr) {
          const errMsg = listenErr.error || listenErr.message || JSON.stringify(listenErr);
          console.error("[Listen] انقطع الاتصال:", errMsg);
          clearInterval(appStateSaveTimer);

          // حفظ appstate قبل إعادة الاتصال
          saveAppState(api);

          console.log("🔄 إعادة الاتصال بعد 10 ثواني...");
          setTimeout(() => {
            reconnectAttempts = 1;
            startBot();
          }, 10000);
          return;
        }

        handleEvent(api, event);
      });
    });
  }, delay);
}

// ─── معالج الأحداث ─────────────────────────────────────────────────────────

/**
 * معالجة الأحداث الواردة من Facebook
 * @param {object} api
 * @param {object} event
 */
function handleEvent(api, event) {
  if (!event || !event.threadID) return;

  // تسجيل النشاط دائماً للوضع الذكي في المحرك
  recordActivity(event.threadID);

  // معالجة الرسائل النصية فقط
  if (event.type !== "message") return;

  const { senderID, threadID, body } = event;
  if (!body || !body.trim()) return;

  // ─── نظام القفل: تجاهل تام لغير الأدمن ─────────────────────────
  if (isLocked(threadID) && !isBotAdmin(senderID)) return;

  // ─── تحليل الأمر ─────────────────────────────────────────────────
  const parts = body.trim().split(/\s+/);
  let command = null;
  let args    = [];

  // محاولة مطابقة الأوامر المركبة أولاً (مثل: "محرك تشغيل")
  if (parts.length >= 2) {
    const twoWordKey = `${parts[0]} ${parts[1]}`;
    if (commandMap.has(twoWordKey)) {
      command = commandMap.get(twoWordKey);
      args    = parts.slice(2);
    }
  }

  // ثم الأوامر الأحادية (مثل: "الاوامر")
  if (!command && commandMap.has(parts[0])) {
    command = commandMap.get(parts[0]);
    args    = parts.slice(1);
  }

  if (!command) return;

  // ─── التحقق من الصلاحيات ─────────────────────────────────────────
  const superAdminOnly = ["رفع", "خفض"];
  if (superAdminOnly.includes(parts[0]) && !isSuperAdmin(senderID)) {
    return api.sendMessage("⛔ هذا الأمر للسوبر أدمن فقط.", threadID);
  }

  const adminOnly = ["محرك", "قفل"];
  if (adminOnly.includes(parts[0]) && !isBotAdmin(senderID)) {
    return api.sendMessage("⛔ هذا الأمر للأدمن فقط.", threadID);
  }

  // ─── تنفيذ الأمر مع معالجة الأخطاء ──────────────────────────────
  try {
    command.execute(api, event, args, parts[0]);
  } catch (execErr) {
    console.error(`[Command] خطأ في تنفيذ "${parts[0]}":`, execErr.message);
    api.sendMessage("⚠️ حدث خطأ أثناء تنفيذ الأمر.", threadID);
  }
}

// ─── معالجة الأخطاء غير المتوقعة (لضمان استمرار البوت) ────────────────────

process.on("uncaughtException", (err) => {
  console.error("[Process] خطأ غير متوقع:", err.message);
});

process.on("unhandledRejection", (reason) => {
  console.error("[Process] Promise غير معالج:", reason);
});

// ─── تشغيل البوت ───────────────────────────────────────────────────────────

startBot();
