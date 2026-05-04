/**
 * أوامر نظام القفل
 * تشغيل/إيقاف القفل العادي والذكي
 */

const {
  enableSmartLock,
  disableSmartLock,
  lockGroup,
  unlockGroup,
  isLocked,
} = require("../systems/lock");
const { loadConfig } = require("../utils/config");

module.exports = {
  name: "قفل",
  description: "التحكم في نظام القفل",

  /**
   * @param {object} api - واجهة Facebook API
   * @param {object} event - حدث الرسالة
   * @param {string[]} args - وسيطات الأمر
   */
  execute(api, event, args) {
    const subCmd = args[0];
    const threadID = event.threadID;

    switch (subCmd) {
      // ─── تشغيل القفل العادي (المجموعة الحالية فقط) ───────────────
      case "تشغيل": {
        lockGroup(threadID);
        api.sendMessage(
          "🔒 تم تفعيل القفل في هذه المجموعة.\nسيتم تجاهل جميع الرسائل من غير الأدمن.",
          threadID
        );
        break;
      }

      // ─── إيقاف القفل ─────────────────────────────────────────────
      case "إيقاف": {
        unlockGroup(threadID);
        api.sendMessage("🔓 تم إيقاف القفل في هذه المجموعة.", threadID);
        break;
      }

      // ─── القفل الذكي (جميع المجموعات) ───────────────────────────
      case "ذكي": {
        const state = args[1];
        if (state === "تشغيل") {
          enableSmartLock();
          api.sendMessage(
            "🔒 تم تفعيل القفل الذكي على جميع المجموعات.\nسيتم تجاهل جميع الرسائل من غير الأدمن في كل مكان.",
            threadID
          );
        } else if (state === "إيقاف") {
          disableSmartLock();
          api.sendMessage("🔓 تم إيقاف القفل الذكي.", threadID);
        } else {
          api.sendMessage("⚠️ استخدم: قفل ذكي تشغيل / قفل ذكي إيقاف", threadID);
        }
        break;
      }

      // ─── عرض الحالة ──────────────────────────────────────────────
      default: {
        const config = loadConfig();
        const locked = isLocked(threadID);
        api.sendMessage(
          `📊 حالة القفل:\n` +
          `• هذه المجموعة: ${locked ? "🔒 مقفلة" : "🔓 مفتوحة"}\n` +
          `• القفل الذكي: ${config.lock.smartLock ? "🔒 مفعّل على جميع المجموعات" : "❌ معطّل"}\n` +
          `• المجموعات المقفلة: ${config.lock.lockedGroups.length}`,
          threadID
        );
      }
    }
  },
};
