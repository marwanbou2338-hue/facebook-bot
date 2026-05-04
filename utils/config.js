/**
 * أداة إدارة ملف الإعدادات
 * تتولى قراءة وكتابة config.json بشكل متزامن
 */

const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "../config.json");

/**
 * قراءة الإعدادات من الملف
 * @returns {object} الإعدادات الحالية
 */
function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("[Config] خطأ في قراءة الإعدادات:", err.message);
    return {};
  }
}

/**
 * حفظ الإعدادات إلى الملف
 * @param {object} config - الإعدادات الجديدة
 */
function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
  } catch (err) {
    console.error("[Config] خطأ في حفظ الإعدادات:", err.message);
  }
}

/**
 * تحديث حقل معين في الإعدادات
 * @param {string} key - المفتاح (يدعم التداخل مثل "engine.message")
 * @param {*} value - القيمة الجديدة
 */
function updateConfig(key, value) {
  const config = loadConfig();
  const keys = key.split(".");
  let obj = config;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!obj[keys[i]]) obj[keys[i]] = {};
    obj = obj[keys[i]];
  }
  obj[keys[keys.length - 1]] = value;
  saveConfig(config);
}

module.exports = { loadConfig, saveConfig, updateConfig };
