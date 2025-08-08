"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startRecallBot = startRecallBot;
exports.sendAudioToBot = sendAudioToBot;
exports.getCurrentBotId = getCurrentBotId;
const axios_1 = __importDefault(require("axios"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const RECALL_API_KEY = process.env.RECALL_API_KEY;
const RECALL_API_URL = "https://us-west-2.recall.ai/api/v1/bot/";
let currentBotId = null;
function startRecallBot(meetingUrl) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        try {
            const response = yield axios_1.default.post(RECALL_API_URL, {
                meeting_url: meetingUrl,
                bot_name: "Sherlocks",
                platform: "google_meet",
                recording_config: {
                    transcript: {
                        enabled: true,
                        provider: {
                            deepgram_streaming: {
                                model: "nova-2",
                            },
                        },
                    },
                    realtime_endpoints: [
                        {
                            type: "websocket",
                            url: "wss://a63971060c54.ngrok-free.app",
                            events: ["transcript.data", "participant_events.chat_message"],
                        },
                    ],
                },
                output_media: {
                    enabled: true,
                },
                automatic_audio_output: {
                    in_call_recording: {
                        data: {
                            kind: "mp3",
                            b64_data: "base64_data",
                        },
                    },
                },
                automatic_leave: {
                    waiting_room_timeout: 120,
                    noone_joined_timeout: 300,
                },
            }, {
                headers: {
                    accept: "application/json",
                    "content-type": "application/json",
                    Authorization: `Token ${RECALL_API_KEY}`,
                },
            });
            const { id, meeting_url } = response.data;
            currentBotId = id; // Store bot ID for audio output
            console.log("✅ Bot joined!");
            console.log("bot_id:", id);
            console.log("meeting:", meeting_url);
            console.log("🔍 Full Recall API response:", response.data);
            return {
                botId: id,
                meetingInfo: meeting_url,
            };
        }
        catch (error) {
            console.error(" Failed to start bot:", ((_a = error.response) === null || _a === void 0 ? void 0 : _a.data) || error.message);
            throw error;
        }
    });
}
/**
 * Send audio data to the bot to speak in the call
 * @param audioBuffer - The audio buffer to send (should be base64 encoded)
 */
function sendAudioToBot(audioBuffer) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        if (!currentBotId) {
            console.error("❌ No bot ID available for audio output");
            return false;
        }
        try {
            console.log("🎤 Sending audio to bot for speech output...");
            console.log("🔍 Bot ID:", currentBotId);
            console.log("🔍 Audio buffer size:", audioBuffer.length);
            // Convert buffer to base64
            const base64Audio = audioBuffer.toString("base64");
            console.log("🔍 Base64 audio length:", base64Audio.length);
            // Send audio to the dedicated output_audio endpoint
            const url = `${RECALL_API_URL}${currentBotId}/output_audio/`;
            console.log("🔍 API URL:", url);
            const payload = {
                kind: "mp3",
                b64_data: base64Audio,
            };
            console.log("🔍 Payload structure:", {
                kind: payload.kind,
                b64_data_length: payload.b64_data.length,
            });
            const response = yield axios_1.default.post(url, payload, {
                headers: {
                    accept: "application/json",
                    "content-type": "application/json",
                    Authorization: `Token ${RECALL_API_KEY}`,
                },
                timeout: 10000, // 10 second timeout
            });
            console.log("✅ Audio sent to bot successfully!");
            console.log("🔍 Response status:", response.status);
            console.log("🔍 Response headers:", response.headers);
            console.log("🔍 Bot audio response:", response.data);
            return true;
        }
        catch (error) {
            console.error("❌ Failed to send audio to bot:");
            console.error("❌ Error status:", (_a = error.response) === null || _a === void 0 ? void 0 : _a.status);
            console.error("❌ Error headers:", (_b = error.response) === null || _b === void 0 ? void 0 : _b.headers);
            console.error("❌ Error data:", (_c = error.response) === null || _c === void 0 ? void 0 : _c.data);
            console.error("❌ Error message:", error.message);
            console.error("❌ Full error:", error);
            return false;
        }
    });
}
/**
 * Get the current bot ID
 */
function getCurrentBotId() {
    return currentBotId;
}
