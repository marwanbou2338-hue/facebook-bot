/**
 * أوامر نظام المحرك
 * تشغيل/إيقاف المحرك وضبط إعداداته
 */

const {
  startEngineForGroup,
  stopEngineForGroup,
  isEngineActive,
} = require("../systems/engine");
const { updateConfig, loadConfig } = require("../utils/config");

module.exports = {
  name: "محرك",
  description: "التحكم في نظام المحرك",

  /**
   * @param {object} api - واجهة Facebook API
   * @param {object} event - حدث الرسالة
   * @param {string[]} args - وسيطات الأمر
   */
  execute(api, event, args) {
    const subCmd = args[0];
    const threadID = event.threadID;

    switch (subCmd) {
      // ─── تشغيل المحرك ────────────────────────────────────────────
      case "تشغيل": {
        if (isEngineActive(threadID)) {
          return api.sendMessage("⚠️ المحرك يعمل بالفعل في هذه المجموعة.", threadID);
        }
        startEngineForGroup(api, threadID);
        api.sendMessage("✅ تم تشغيل المحرك في هذه المجموعة.", threadID);
        break;
      }

      // ─── إيقاف المحرك ────────────────────────────────────────────
      case "إيقاف": {
        const stopped = stopEngineForGroup(threadID);
        api.sendMessage(
          stopped ? "✅ تم إيقاف المحرك." : "⚠️ المحرك لا يعمل في هذه المجموعة.",
          threadID
        );
        break;
      }

      // ─── تغيير رسالة المحرك ──────────────────────────────────────
      case "رسالة": {
        const newMsg = args.slice(1).join(" ");
        if (!newMsg) {
          return api.sendMessage(
            "⚠️ يرجى كتابة نص الرسالة بعد الأمر.\nمثال: محرك رسالة مرحباً بالجميع",
            threadID
          );
        }
        updateConfig("engine.message", newMsg);
        api.sendMessage(`✅ تم تحديث رسالة المحرك إلى:\n"${newMsg}"`, threadID);
        break;
      }

      // ─── تغيير وقت المحرك ────────────────────────────────────────
      case "وقت": {
        const seconds = parseInt(args[1], 10);
        if (isNaN(seconds) || seconds < 5) {
          return api.sendMessage(
            "⚠️ يرجى كتابة عدد الثواني (لا يقل عن 5).\nمثال: محرك وقت 60",
            threadID
          );
        }
        const ms = seconds * 1000;
        updateConfig("engine.interval", ms);
        api.sendMessage(`✅ تم تحديث وقت المحرك إلى ${seconds} ثانية.`, threadID);
        break;
      }

      // ─── الوضع الذكي ─────────────────────────────────────────────
      case "ذكي": {
        const state = args[1];
        if (state === "تشغيل") {
          updateConfig("engine.smartMode", true);
          api.sendMessage("✅ تم تفعيل الوضع الذكي للمحرك (يُرسل فقط عند وجود نشاط).", threadID);
        } else if (state === "إيقاف") {
          updateConfig("engine.smartMode", false);
          api.sendMessage("✅ تم إيقاف الوضع الذكي للمحرك.", threadID);
        } else {
          api.sendMessage("⚠️ استخدم: محرك ذكي تشغيل / محرك ذكي إيقاف", threadID);
        }
        break;
      }

      // ─── عرض الحالة ──────────────────────────────────────────────
      default: {
        const config = loadConfig();
        const active = isEngineActive(threadID);
        api.sendMessage(
          `📊 حالة المحرك:\n` +
          `• الحالة: ${active ? "✅ يعمل" : "❌ متوقف"}\n` +
          `• الرسالة: "${config.engine.message}"\n` +
          `• الفاصل الزمني: ${config.engine.interval / 1000} ثانية\n` +
          `• الوضع الذكي: ${config.engine.smartMode ? "مفعّل" : "معطّل"}`,
          threadID
        );
      }
    }
  },
};
