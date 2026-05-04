"use strict";
const utils = require('../../../utils');
const mqtt = require('mqtt');
const websocket = require('websocket-stream');
const HttpsProxyAgent = require('https-proxy-agent');
const EventEmitter = require('events');
const { parseDelta } = require('./deltas/value');

let form = {};
let getSeqID;
const topics = [
    "/legacy_web", "/webrtc", "/rtc_multi", "/onevc", "/br_sr", "/sr_res",
    "/t_ms", "/thread_typing", "/orca_typing_notifications", "/notify_disconnect",
    "/orca_presence", "/inbox", "/mercury", "/messaging_events",
    "/orca_message_notifications", "/pp", "/webrtc_response"
];

function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function getRandomReconnectTime() {
    const min = 26 * 60 * 1000;
    const max = 60 * 60 * 1000;
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function calculate(previousTimestamp, currentTimestamp){
    return Math.floor(previousTimestamp + (currentTimestamp - previousTimestamp) + 300);
}

function markAsRead(ctx, api, threadID) {
    if (ctx.globalOptions.autoMarkRead && threadID) {
        api.markAsRead(threadID, (err) => {
            if (err) utils.error("autoMarkRead", err);
        });
    }
}

async function listenMqtt(defaultFuncs, api, ctx, globalCallback) {
    const chatOn = ctx.globalOptions.online;
    const region = ctx.region;
    const foreground = false;
    const sessionID = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER) + 1;

    // Always generate a fresh clientID for each connection attempt to avoid bans
    if (!ctx.clientID) ctx.clientID = generateUUID();
    const cid = ctx.clientID;

    const username = {
        u: ctx.userID,
        s: sessionID,
        chat_on: chatOn,
        fg: foreground,
        d: cid,
        ct: 'websocket',
        aid: ctx.mqttAppID,
        mqtt_sid: '',
        cp: 3,
        ecp: 10,
        st: [],
        pm: [],
        dc: '',
        no_auto_fg: true,
        gas: null,
        pack: [],
        a: ctx.globalOptions.userAgent
    };
    const cookies = ctx.jar.getCookiesSync('https://www.facebook.com').join('; ');
    let host;
    const domain = "wss://edge-chat.messenger.com/chat";
    if (region) {
        host = `${domain}?region=${region.toLowerCase()}&sid=${sessionID}&cid=${cid}`;
    } else {
        host = `${domain}?sid=${sessionID}&cid=${cid}`;
    }

    utils.log("Connecting to MQTT with new IDs...", host);

    const options = {
        clientId: 'mqttwsclient',
        protocolId: 'MQIsdp',
        protocolVersion: 3,
        username: JSON.stringify(username),
        clean: true,
        wsOptions: {
            headers: {
                'Cookie': cookies,
                'Origin': 'https://www.messenger.com',
                'User-Agent': username.a,
                'Referer': 'https://www.messenger.com/',
                'Host': new URL(host).hostname
            },
            origin: 'https://www.messenger.com',
            protocolVersion: 13,
            binaryType: 'arraybuffer'
        },
        keepalive: 10,
        reschedulePings: true,
        connectTimeout: 30000,
        reconnectPeriod: 0  // Disable MQTT-level auto-reconnect — we handle it ourselves
    };

    if (ctx.globalOptions.proxy) options.wsOptions.agent = new HttpsProxyAgent(ctx.globalOptions.proxy);

    const mqttClient = new mqtt.Client(_ => websocket(host, options.wsOptions), options);
    mqttClient.publishSync = mqttClient.publish.bind(mqttClient);
    mqttClient.publish = (topic, message, opts = {}, callback = () => {}) => new Promise((resolve, reject) => {
            mqttClient.publishSync(topic, message, opts, (err, data) => {
            if (err) {
                callback(err);
                reject(err);
            }
            callback(null, data);
            resolve(data);
        });
    });
    ctx.mqttClient = mqttClient;

    let errorHandled = false;
    mqttClient.on('error', (err) => {
        if (errorHandled) return;
        errorHandled = true;
        utils.error("listenMqtt", err);
        try { mqttClient.end(true); } catch (_) {}
        if (ctx.globalOptions.autoReconnect) {
            // Regenerate clientID before retrying
            ctx.clientID = generateUUID();
            setTimeout(() => getSeqID(), 5000);
        } else {
            globalCallback({ type: "stop_listen", error: "Connection refused" });
        }
    });

    mqttClient.on('close', () => {
        if (errorHandled) return;
    });

    mqttClient.on('connect', async () => {
        topics.forEach(topic => mqttClient.subscribe(topic));
        const queue = { sync_api_version: 10, max_deltas_able_to_process: 1000, delta_batch_size: 500, encoding: "JSON", entity_fbid: ctx.userID };
        let topic;
        if (ctx.syncToken) {
            topic = "/messenger_sync_get_diffs";
            queue.last_seq_id = ctx.lastSeqId;
            queue.sync_token = ctx.syncToken;
        } else {
            topic = "/messenger_sync_create_queue";
            queue.initial_titan_sequence_id = ctx.lastSeqId;
            queue.device_params = null;
        }
        utils.log(`Successfully connected to MQTT.`);
        try {
            const { name: botName = "Facebook User", uid = ctx.userID } = await api.getBotInitialData();
            utils.log(`Hello, ${botName} (${uid})`);
        } catch (e) {
            utils.error("getBotInitialData failed:", e && e.message);
        }
        mqttClient.publish(topic, JSON.stringify(queue), { qos: 1, retain: false });
    });

    let presenceInterval;
    if (ctx.globalOptions.updatePresence) {
        presenceInterval = setInterval(() => {
            if (mqttClient.connected) {
                const presencePayload = utils.generatePresence(ctx.userID);
                mqttClient.publish('/orca_presence', JSON.stringify({ "p": presencePayload }), (err) => {
                    if (err) {
                        utils.error("Failed to send presence update:", err);
                    }
                });
            }
        }, 50000);
    }

    mqttClient.on('message', async (topic, message, _packet) => {
        try {
            const jsonMessage = JSON.parse(message.toString());
            if (topic === "/t_ms") {
                if (jsonMessage.lastIssuedSeqId){
                    ctx.lastSeqId = parseInt(jsonMessage.lastIssuedSeqId);
                }
                if (jsonMessage.deltas) {
                    for (const delta of jsonMessage.deltas) {
                        parseDelta(defaultFuncs, api, ctx, globalCallback, { delta });
                    }
                }
            } else if (topic === "/thread_typing" || topic === "/orca_typing_notifications") {
                const typ = {
                    type: "typ",
                    isTyping: !!jsonMessage.state,
                    from: jsonMessage.sender_fbid.toString(),
                    threadID: utils.formatID((jsonMessage.thread || jsonMessage.sender_fbid).toString())
                };
                globalCallback(null, typ);
            }
        } catch (ex) {
            utils.error("listenMqtt: onMessage", ex);
        }
    });
}

module.exports = (defaultFuncs, api, ctx) => {
    let globalCallback = () => {};
    let reconnectInterval;
    getSeqID = async () => {
        const DOC_IDS = [
            "6234794069933226",
            "3336396659757871",
            "10153919900276966",
            "2376385779063525",
        ];
        let seqId = null;
        for (const docId of DOC_IDS) {
            try {
                form = {
                    "queries": JSON.stringify({
                        "o0": {
                            "doc_id": docId,
                            "query_params": {
                                "limit": 1,
                                "before": null,
                                "tags": ["INBOX"],
                                "includeDeliveryReceipts": false,
                                "includeSeqID": true
                            }
                        }
                    })
                };
                const resData = await defaultFuncs.post("https://www.facebook.com/api/graphqlbatch/", ctx.jar, form).then(utils.parseAndCheckLogin(ctx, defaultFuncs));
                if (utils.getType(resData) != "Array" || (resData.error && resData.error !== 1357001)) continue;
                const sid = resData[0] && resData[0].o0 && resData[0].o0.data && resData[0].o0.data.viewer && resData[0].o0.data.viewer.message_threads && resData[0].o0.data.viewer.message_threads.sync_sequence_id;
                if (sid) { seqId = sid; break; }
            } catch (e) {
                utils.error("[getSeqID] doc_id " + docId + " failed:", e && e.message);
            }
        }
        if (seqId) {
            ctx.lastSeqId = seqId;
            utils.log("[getSeqID] Got seqId:", seqId);
        } else {
            utils.error("[getSeqID] All doc_ids failed. Using timestamp fallback — bot will only receive new messages.");
            ctx.lastSeqId = String(Date.now());
        }
        listenMqtt(defaultFuncs, api, ctx, globalCallback);
    };

    return async (callback) => {
        class MessageEmitter extends EventEmitter {
            stop() {
                globalCallback = () => {};
                if (reconnectInterval) {
                    clearTimeout(reconnectInterval);
                    reconnectInterval = null;
                }
                if (ctx.mqttClient) {
                    try { ctx.mqttClient.end(true); } catch (_) {}
                    ctx.mqttClient = undefined;
                }
                this.emit('stop');
            }
        }

        const msgEmitter = new MessageEmitter();

        globalCallback = (error, message) => {
            if (error) return msgEmitter.emit("error", error);
            if (message && (message.type === "message" || message.type === "message_reply")) {
                markAsRead(ctx, api, message.threadID);
            }
            msgEmitter.emit("message", message);
        };

        if (typeof callback === 'function') globalCallback = callback;

        if (!ctx.firstListen || !ctx.lastSeqId) await getSeqID();
        else listenMqtt(defaultFuncs, api, ctx, globalCallback);

        if (ctx.firstListen) {
            try {
                await api.markAsReadAll();
            } catch (err) {
                utils.error("Failed to mark all messages as read on startup:", err);
            }
        }

        ctx.firstListen = false;

        async function scheduleReconnect() {
            const time = getRandomReconnectTime();
            utils.log(`Scheduled reconnect in ${Math.floor(time / 60000)} minutes...`);
            reconnectInterval = setTimeout(() => {
                utils.log(`Reconnecting MQTT with new clientID...`);
                if (ctx.mqttClient) {
                    try { ctx.mqttClient.end(true); } catch (_) {}
                }
                ctx.clientID = generateUUID();
                listenMqtt(defaultFuncs, api, ctx, globalCallback);
                scheduleReconnect();
            }, time);
        }

        scheduleReconnect();

        return msgEmitter;
    };
};
