"use strict";

const NICK_URL =
  "https://www.facebook.com/messaging/save_thread_nickname/?source=thread_settings&dpr=1";

const CALL_DELAY_MS = 1200;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseResponseBody(res) {
  if (!res) return null;
  const statusCode = res.statusCode || res.status;
  if (statusCode && statusCode !== 200) {
    return { _httpError: statusCode };
  }
  let body = res.body != null ? res.body : res.data;
  if (body == null) return null;
  if (Buffer.isBuffer(body)) body = body.toString("utf8");
  if (typeof body === "object") return body;
  if (typeof body !== "string") return null;
  if (body.trimStart().startsWith("<!")) {
    return { _htmlResponse: true };
  }
  const stripped = body.replace(/^for ?\(;;\);/, "").trim();
  if (!stripped) return {};
  try {
    return JSON.parse(stripped);
  } catch (e) {
    return { _raw: stripped };
  }
}

function setNicknameOfficial(api, nickname, threadID, participantID) {
  return new Promise((resolve, reject) => {
    const fn =
      typeof api.changeNickname === "function"
        ? api.changeNickname
        : typeof api.setNickname === "function"
        ? api.setNickname
        : null;

    if (!fn) {
      return reject(new Error("api.changeNickname غير متوفرة"));
    }

    const timer = setTimeout(() => reject(new Error("changeNickname timeout")), 12000);
    try {
      fn.call(api, nickname, threadID, participantID, (err) => {
        clearTimeout(timer);
        if (err) return reject(err instanceof Error ? err : new Error(JSON.stringify(err)));
        resolve("official");
      });
    } catch (e) {
      clearTimeout(timer);
      reject(e);
    }
  });
}

function setNicknameMqtt(api, nickname, threadID, participantID) {
  return new Promise((resolve, reject) => {
    const fn =
      typeof api.nickname === "function"
        ? api.nickname
        : typeof api.changeNickname === "function"
        ? api.changeNickname
        : null;

    if (!fn) {
      return reject(new Error("api.nickname غير متوفرة"));
    }

    const timer = setTimeout(() => reject(new Error("MQTT timeout")), 12000);
    try {
      fn.call(api, nickname, threadID, participantID, (err) => {
        clearTimeout(timer);
        if (err) return reject(err instanceof Error ? err : new Error(JSON.stringify(err)));
        resolve("mqtt");
      });
    } catch (e) {
      clearTimeout(timer);
      reject(e);
    }
  });
}

function setNicknameHttp(api, nickname, threadID, participantID) {
  return new Promise((resolve, reject) => {
    const ctx = api.ctx;
    const defaultFuncs = api.defaultFuncs;
    if (!ctx || !defaultFuncs || typeof defaultFuncs.post !== "function") {
      return reject(new Error("ws3-fca defaultFuncs/ctx غير متاح"));
    }
    const form = {
      nickname: nickname == null ? "" : String(nickname),
      participant_id: String(participantID),
      thread_or_other_fbid: String(threadID),
      source: "thread_settings",
    };
    defaultFuncs
      .post(NICK_URL, ctx.jar, form)
      .then((res) => {
        const statusCode = res && (res.statusCode || res.status);
        const data = parseResponseBody(res);
        console.log(
          `[NICK-HTTP] uid=${participantID} status=${statusCode} data=${JSON.stringify(data).slice(0, 150)}`
        );
        if (data && data._httpError) {
          return reject(new Error(`HTTP ${data._httpError}`));
        }
        if (data && data._htmlResponse) {
          return reject(new Error("FB أعاد صفحة HTML — احتمال انتهاء الجلسة"));
        }
        if (data && data._raw) {
          return reject(new Error(`FB رد غير متوقع: ${data._raw.slice(0, 80)}`));
        }
        if (data && data.error && data.error !== 0) {
          return reject(
            new Error(data.errorSummary || data.errorDescription || `FB error ${data.error}`)
          );
        }
        resolve("http");
      })
      .catch((err) => {
        console.error(`[NICK-HTTP] uid=${participantID} خطأ: ${err && err.message}`);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
  });
}

async function changeNicknameSafe(api, nickname, threadID, participantID) {
  const errors = [];

  try {
    const method = await setNicknameOfficial(api, nickname, threadID, participantID);
    console.log(`[NICK] uid=${participantID} ✓ (${method})`);
    return method;
  } catch (e1) {
    errors.push(`official: ${e1.message}`);
    console.warn(`[NICK] official فشل (${e1.message})، تجربة HTTP...`);
  }

  try {
    await setNicknameHttp(api, nickname, threadID, participantID);
    console.log(`[NICK] uid=${participantID} ✓ (http)`);
    return "http";
  } catch (e2) {
    errors.push(`http: ${e2.message}`);
    console.warn(`[NICK] HTTP فشل (${e2.message})، تجربة MQTT...`);
  }

  try {
    await setNicknameMqtt(api, nickname, threadID, participantID);
    console.log(`[NICK] uid=${participantID} ✓ (mqtt)`);
    return "mqtt";
  } catch (e3) {
    errors.push(`mqtt: ${e3.message}`);
    console.error(`[NICK] كل الطرق فشلت uid=${participantID}: ${errors.join(" | ")}`);
    throw new Error(errors.join(" | "));
  }
}

async function changeNicknamesBulk(api, nickname, threadID, userIDs) {
  let ok = 0;
  let fail = 0;
  const total = userIDs.length;

  for (let i = 0; i < total; i++) {
    const uid = userIDs[i];
    try {
      await changeNicknameSafe(api, nickname, threadID, uid);
      ok++;
    } catch (e) {
      fail++;
      console.error(`[BULK-NICK] uid=${uid} فشل: ${e.message}`);
    }

    if (i < total - 1) {
      await sleep(CALL_DELAY_MS);
    }
  }
  return { ok, fail };
}

module.exports = { changeNicknameSafe, setNicknameHttp, changeNicknamesBulk, sleep };
