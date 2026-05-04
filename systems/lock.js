/**
 * نظام القفل (Lock)
 * يتجاهل جميع الرسائل من غير الأدمن عند تفعيله
 * يدعم: قفل ذكي (كل المجموعات) وقفل عادي (مجموعة واحدة)
 */

const { loadConfig, updateConfig, saveConfig } = require("../utils/config");

/**
 * تفعيل القفل الذكي (جميع المجموعات)
 */
function enableSmartLock() {
  updateConfig("lock.smartLock", true);
  console.log("[Lock] تم تفعيل القفل الذكي على جميع المجموعات");
}

/**
 * إيقاف القفل الذكي
 */
function disableSmartLock() {
  updateConfig("lock.smartLock", false);
  console.log("[Lock] تم إيقاف القفل الذكي");
}

/**
 * تفعيل القفل العادي على مجموعة محددة
 * @param {string} threadId - معرف المجموعة
 */
function lockGroup(threadId) {
  const config = loadConfig();
  const locked = config.lock.lockedGroups.map(String);
  const tid = String(threadId);

  if (!locked.includes(tid)) {
    config.lock.lockedGroups.push(tid);
    saveConfig(config);
    console.log(`[Lock] تم قفل المجموعة ${tid}`);
  }
}

/**
 * إيقاف القفل العادي على مجموعة محددة
 * @param {string} threadId - معرف المجموعة
 */
function unlockGroup(threadId) {
  const config = loadConfig();
  const tid = String(threadId);
  config.lock.lockedGroups = config.lock.lockedGroups.filter((id) => String(id) !== tid);
  saveConfig(config);
  console.log(`[Lock] تم فك القفل عن المجموعة ${tid}`);
}

/**
 * التحقق إذا كان القفل مفعلاً في مجموعة معينة
 * @param {string} threadId - معرف المجموعة
 * @returns {boolean}
 */
function isLocked(threadId) {
  const config = loadConfig();

  // القفل الذكي يغطي جميع المجموعات
  if (config.lock.smartLock) return true;

  // القفل العادي يغطي المجموعة المحددة فقط
  return config.lock.lockedGroups.map(String).includes(String(threadId));
}

module.exports = { enableSmartLock, disableSmartLock, lockGroup, unlockGroup, isLocked };
