/**
 * أوامر إدارة الصلاحيات
 * رفع / خفض صلاحيات المستخدمين (للسوبر أدمن فقط)
 */

const { promoteUser, demoteUser, isSuperAdmin } = require("../utils/permissions");

module.exports = {
  name: "رفع",
  aliases: ["خفض"],
  description: "منح أو إزالة صلاحيات أدمن البوت",

  /**
   * @param {object} api - واجهة Facebook API
   * @param {object} event - حدث الرسالة
   * @param {string[]} args - وسيطات الأمر
   * @param {string} command - الأمر المُستخدم
   */
  execute(api, event, args, command) {
    // التحقق من صلاحيات السوبر أدمن
    if (!isSuperAdmin(event.senderID)) {
      return api.sendMessage("⛔ هذا الأمر للسوبر أدمن فقط.", event.threadID);
    }

    // الحصول على معرف المستخدم المستهدف
    // يمكن تمريره كـ argument أو من خلال الرد على رسالة
    let targetId = args[0];

    if (!targetId && event.messageReply) {
      targetId = event.messageReply.senderID;
    }

    if (!targetId) {
      return api.sendMessage(
        "⚠️ يرجى تحديد معرف المستخدم أو الرد على رسالته.\nمثال: رفع 123456789",
        event.threadID
      );
    }

    const result = command === "رفع" ? promoteUser(targetId) : demoteUser(targetId);
    api.sendMessage(result.message, event.threadID);
  },
};
