/**
 * نظام إدارة الصلاحيات
 * يتحكم في رتب المستخدمين: SuperAdmin، أدمن البوت، مستخدم عادي
 */

const { loadConfig, saveConfig } = require("./config");

/**
 * التحقق إذا كان المستخدم هو SuperAdmin (المطور)
 * @param {string} userId - معرف المستخدم
 * @returns {boolean}
 */
function isSuperAdmin(userId) {
  const config = loadConfig();
  return String(userId) === String(config.superAdminId);
}

/**
 * التحقق إذا كان المستخدم أدمن بوت أو أعلى
 * @param {string} userId - معرف المستخدم
 * @returns {boolean}
 */
function isBotAdmin(userId) {
  if (isSuperAdmin(userId)) return true;
  const config = loadConfig();
  return config.botAdmins.map(String).includes(String(userId));
}

/**
 * منح صلاحيات أدمن البوت لمستخدم
 * @param {string} userId - معرف المستخدم المراد رفعه
 * @returns {{ success: boolean, message: string }}
 */
function promoteUser(userId) {
  if (isSuperAdmin(userId)) {
    return { success: false, message: "❌ لا يمكن تعديل رتبة السوبر أدمن." };
  }

  const config = loadConfig();
  const admins = config.botAdmins.map(String);

  if (admins.includes(String(userId))) {
    return { success: false, message: "⚠️ هذا المستخدم يمتلك صلاحيات أدمن مسبقاً." };
  }

  config.botAdmins.push(String(userId));
  saveConfig(config);
  return { success: true, message: `✅ تمت ترقية المستخدم إلى أدمن البوت.` };
}

/**
 * إزالة صلاحيات أدمن البوت من مستخدم
 * @param {string} userId - معرف المستخدم المراد تخفيضه
 * @returns {{ success: boolean, message: string }}
 */
function demoteUser(userId) {
  if (isSuperAdmin(userId)) {
    return { success: false, message: "❌ لا يمكن تعديل رتبة السوبر أدمن." };
  }

  const config = loadConfig();
  const before = config.botAdmins.length;
  config.botAdmins = config.botAdmins.filter((id) => String(id) !== String(userId));

  if (config.botAdmins.length === before) {
    return { success: false, message: "⚠️ هذا المستخدم ليس أدمن بوت." };
  }

  saveConfig(config);
  return { success: true, message: `✅ تم تخفيض صلاحيات المستخدم.` };
}

module.exports = { isSuperAdmin, isBotAdmin, promoteUser, demoteUser };
