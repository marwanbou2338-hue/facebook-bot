/**
 * نظام المحرك (Engine)
 * يرسل رسائل دورية في المجموعات المحددة
 * يدعم الوضع الذكي: الإرسال فقط عند وجود نشاط
 */

const { loadConfig, updateConfig } = require("../utils/config");

// مخزن مؤقت لحالة النشاط في كل مجموعة
const groupActivity = {};

// مؤشرات الـ intervals النشطة لكل مجموعة
const activeIntervals = {};

/**
 * تسجيل نشاط في مجموعة (يُستدعى عند أي حدث في المجموعة)
 * @param {string} threadId - معرف المجموعة
 */
function recordActivity(threadId) {
  groupActivity[String(threadId)] = true;
}

/**
 * تشغيل المحرك في مجموعة محددة
 * @param {object} api - واجهة Facebook API
 * @param {string} threadId - معرف المجموعة
 */
function startEngineForGroup(api, threadId) {
  const tid = String(threadId);

  if (activeIntervals[tid]) {
    console.log(`[Engine] المحرك يعمل بالفعل في المجموعة ${tid}`);
    return;
  }

  const config = loadConfig();
  const interval = config.engine.interval || 60000;

  activeIntervals[tid] = setInterval(() => {
    const cfg = loadConfig();
    const msg = cfg.engine.message;
    const smartMode = cfg.engine.smartMode;

    // الوضع الذكي: لا إرسال إلا عند وجود نشاط
    if (smartMode && !groupActivity[tid]) {
      console.log(`[Engine] لا يوجد نشاط في ${tid}، تخطي الإرسال.`);
      return;
    }

    api.sendMessage(msg, tid, (err) => {
      if (err) {
        console.error(`[Engine] خطأ في إرسال الرسالة إلى ${tid}:`, err.message || err);
      } else {
        console.log(`[Engine] تم إرسال الرسالة إلى ${tid}`);
        // إعادة ضبط مؤشر النشاط بعد الإرسال في الوضع الذكي
        groupActivity[tid] = false;
      }
    });
  }, interval);

  // حفظ حالة المجموعة في الإعدادات
  updateConfig(`engine.activeGroups.${tid}`, true);
  console.log(`[Engine] تم تشغيل المحرك في المجموعة ${tid} (كل ${interval}ms)`);
}

/**
 * إيقاف المحرك في مجموعة محددة
 * @param {string} threadId - معرف المجموعة
 */
function stopEngineForGroup(threadId) {
  const tid = String(threadId);

  if (!activeIntervals[tid]) {
    return false;
  }

  clearInterval(activeIntervals[tid]);
  delete activeIntervals[tid];
  delete groupActivity[tid];

  updateConfig(`engine.activeGroups.${tid}`, false);
  console.log(`[Engine] تم إيقاف المحرك في المجموعة ${tid}`);
  return true;
}

/**
 * استعادة المحركات النشطة عند إعادة تشغيل البوت
 * @param {object} api - واجهة Facebook API
 */
function restoreActiveEngines(api) {
  const config = loadConfig();
  const activeGroups = config.engine.activeGroups || {};

  for (const [tid, isActive] of Object.entries(activeGroups)) {
    if (isActive) {
      console.log(`[Engine] استعادة المحرك في المجموعة ${tid}`);
      startEngineForGroup(api, tid);
    }
  }
}

/**
 * التحقق إذا كان المحرك يعمل في مجموعة
 * @param {string} threadId
 * @returns {boolean}
 */
function isEngineActive(threadId) {
  return !!activeIntervals[String(threadId)];
}

module.exports = {
  recordActivity,
  startEngineForGroup,
  stopEngineForGroup,
  restoreActiveEngines,
  isEngineActive,
};
