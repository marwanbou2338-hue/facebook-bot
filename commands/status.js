/**
 * أمر: سيرفر / ابتيم
 * يعرض حالة البوت ومدة تشغيله
 */

const startTime = Date.now();

/**
 * تحويل الوقت بالمللي ثانية إلى صيغة مقروءة
 * @param {number} ms
 * @returns {string}
 */
function formatUptime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];
  if (days > 0) parts.push(`${days} يوم`);
  if (hours > 0) parts.push(`${hours} ساعة`);
  if (minutes > 0) parts.push(`${minutes} دقيقة`);
  parts.push(`${seconds} ثانية`);

  return parts.join(" و ");
}

module.exports = {
  name: "سيرفر",
  aliases: ["ابتيم"],
  description: "عرض حالة البوت ووقت التشغيل",

  /**
   * @param {object} api - واجهة Facebook API
   * @param {object} event - حدث الرسالة
   */
  execute(api, event) {
    const uptime = formatUptime(Date.now() - startTime);
    const memoryMB = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);

    const statusMsg = `
╔══════════════════════════╗
║    📊 حالة البوت         ║
╠══════════════════════════╣
║ ✅ الحالة: يعمل بشكل طبيعي
║ ⏱️ وقت التشغيل: ${uptime}
║ 🧠 استخدام الذاكرة: ${memoryMB} MB
║ 📅 تاريخ الإطلاق: ${new Date(startTime).toLocaleString("ar")}
╚══════════════════════════╝
`.trim();

    api.sendMessage(statusMsg, event.threadID);
  },
};
