"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
exports.startBotScreenShare = startBotScreenShare;
exports.sendAudioToBot = sendAudioToBot;
exports.stopBotAudio = stopBotAudio;
exports.getCurrentBotId = getCurrentBotId;
const axios_1 = __importDefault(require("axios"));
const dotenv_1 = __importDefault(require("dotenv"));
const constants_1 = require("./constants");
const console_1 = require("console");
dotenv_1.default.config();
const RECALL_API_KEY = process.env.RECALL_API_KEY;
const RECALL_API_URL = "https://us-west-2.recall.ai/api/v1/bot/";
let currentBotId = null;
function startRecallBot(meetingUrl) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        try {
            const response = yield axios_1.default.post(RECALL_API_URL, (0, constants_1.BOT_CONFIG)(meetingUrl), {
                headers: {
                    accept: "application/json",
                    "content-type": "application/json",
                    Authorization: `Token ${RECALL_API_KEY}`,
                },
            });
            const { id, meeting_url } = response.data;
            currentBotId = id;
            console.log("Bot joined!");
            console.log("bot_id:", id);
            console.log("meeting:", meeting_url);
            console.log(" Full Recall API response:", response.data);
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
//bot screenshare
function startBotScreenShare(urlToShare) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        if (!currentBotId) {
            console.error(" No bot ID available for screenshare");
            return console_1.error;
        }
        try {
            const url = `${RECALL_API_URL}${currentBotId}/output_media/`;
            const payload = {
                url: urlToShare,
                kind: "jpeg",
                b64_data: "Base64_data",
            };
            const response = yield axios_1.default.post(url, payload, {
                headers: {
                    accept: "application/json",
                    "content-type": "application/json",
                    Authorization: `Token ${RECALL_API_KEY}`,
                },
            });
            console.log("✅ Bot screenshare started successfully!");
            console.log("🔍 Response status:", response.status);
            console.log("🔍 Response headers:", response.headers);
            console.log("🔍 Bot screenshare response:", response.data);
        }
        catch (error) {
            console.error("❌ Failed to start bot screenshare:");
            console.error("❌ Error status:", (_a = error.response) === null || _a === void 0 ? void 0 : _a.status);
            console.error("❌ Error headers:", (_b = error.response) === null || _b === void 0 ? void 0 : _b.headers);
            console.error("❌ Error data:", (_c = error.response) === null || _c === void 0 ? void 0 : _c.data);
            console.error("❌ Error message:", error.message);
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
 * Stop current audio output by sending a very short silence
 * This effectively cancels any ongoing audio playback
 */
function stopBotAudio() {
    return __awaiter(this, void 0, void 0, function* () {
        if (!currentBotId) {
            console.error("❌ No bot ID available for audio stop");
            return false;
        }
        try {
            console.log("🔇 Stopping bot audio output...");
            // Import the textToSpeech function to generate silence
            const { textToSpeech } = yield Promise.resolve().then(() => __importStar(require("./llm")));
            // Generate a very short silence by using a single character
            const silenceBuffer = yield textToSpeech(".");
            if (!silenceBuffer) {
                console.error("❌ Failed to generate silence audio");
                return false;
            }
            const base64Silence = silenceBuffer.toString("base64");
            const url = `${RECALL_API_URL}${currentBotId}/output_audio/`;
            const payload = {
                kind: "mp3",
                b64_data: base64Silence,
            };
            const response = yield axios_1.default.post(url, payload, {
                headers: {
                    accept: "application/json",
                    "content-type": "application/json",
                    Authorization: `Token ${RECALL_API_KEY}`,
                },
                timeout: 5000, // 5 second timeout for stop command
            });
            console.log("✅ Bot audio stopped successfully!");
            return true;
        }
        catch (error) {
            console.error("❌ Failed to stop bot audio:");
            console.error("❌ Error:", error.message);
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
