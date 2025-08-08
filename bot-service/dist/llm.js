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
exports.askLLM = askLLM;
exports.textToSpeech = textToSpeech;
const sdk_1 = require("@deepgram/sdk");
const fluent_ffmpeg_1 = __importDefault(require("fluent-ffmpeg"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
// Only used for Text-to-Speech, transcription is handled by Recall AI
const deepgramClient = (0, sdk_1.createClient)(process.env.DEEPGRAM_API_KEY);
const conversationContext = {
    recentIntents: [],
    lastResponseTime: 0,
};
const MAX_INTENT_HISTORY = 5;
const MIN_RESPONSE_INTERVAL = 2000;
const SAME_INTENT_COOLDOWN = 6000;
function detectIntent(normalizedTranscript) {
    if (normalizedTranscript.includes("hello") ||
        normalizedTranscript.includes("hi") ||
        normalizedTranscript.includes("hey") ||
        normalizedTranscript.includes("how are you doing") ||
        normalizedTranscript.includes("whats up")) {
        return "greeting";
    }
    if (normalizedTranscript.includes("who are you") ||
        normalizedTranscript.includes("what u do") ||
        normalizedTranscript.includes("what is this")) {
        return "identity";
    }
    return null;
}
//Check if we should respond based on conversation context
function shouldRespond(intent) {
    const now = Date.now();
    // Check if enough time has passed since last response (minimum interval)
    if (now - conversationContext.lastResponseTime < MIN_RESPONSE_INTERVAL) {
        console.log("🔇 Skipping response - too soon after last response");
        return false;
    }
    // Check if this intent was the most recent one
    const lastIntent = conversationContext.recentIntents[conversationContext.recentIntents.length - 1];
    if (lastIntent === intent) {
        // Same intent - check if enough time has passed for repeat
        const timeSinceLastResponse = now - conversationContext.lastResponseTime;
        if (timeSinceLastResponse < SAME_INTENT_COOLDOWN) {
            console.log(`🔇 Skipping response - same intent "${intent}" within ${SAME_INTENT_COOLDOWN / 1000}s cooldown`);
            return false;
        }
        else {
            console.log(`✅ Allowing repeat response - same intent "${intent}" after ${timeSinceLastResponse / 1000}s`);
        }
    }
    return true;
}
/**
 * Update conversation context with new intent
 */
function updateConversationContext(intent) {
    conversationContext.recentIntents.push(intent);
    // Keep only the most recent intents
    if (conversationContext.recentIntents.length > MAX_INTENT_HISTORY) {
        conversationContext.recentIntents = conversationContext.recentIntents.slice(-MAX_INTENT_HISTORY);
    }
    conversationContext.lastResponseTime = Date.now();
    console.log("Updated conversation context. Recent intents:", conversationContext.recentIntents);
}
function askLLM(transcript) {
    return __awaiter(this, void 0, void 0, function* () {
        const normalizedTranscript = transcript.toLowerCase().trim();
        console.log("🎧 Processing transcript:", transcript);
        const intent = detectIntent(normalizedTranscript);
        if (!intent) {
            console.log("No intent detected for this transcript");
            return null;
        }
        console.log("Detected intent:", intent);
        if (!shouldRespond(intent)) {
            return null;
        }
        let reply = null;
        switch (intent) {
            case "greeting":
                reply = "hey i am sherlocks";
                break;
            case "identity":
                reply = "i am a bot that can help you with your questions";
                break;
            default:
                console.log("No response defined for intent:", intent);
                return null;
        }
        if (reply) {
            updateConversationContext(intent);
            console.log("LLM Response:", reply);
            return reply;
        }
        return null;
    });
}
/**
 * Convert text to speech using Deepgram TTS API and convert to MP3
 * @param text - The text to convert to speech
 * @returns MP3 audio buffer containing the generated speech
 */
function textToSpeech(text) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            console.log("🔊 Converting text to speech:", text);
            // Make TTS request to Deepgram (generate WAV)
            const response = yield deepgramClient.speak.request({ text }, {
                model: "aura-2-thalia-en",
                encoding: "linear16",
                container: "wav",
                sample_rate: 16000,
            });
            const stream = yield response.getStream();
            if (stream) {
                const wavBuffer = yield getAudioBuffer(stream);
                const mp3Buffer = yield convertWavToMp3(wavBuffer);
                if (mp3Buffer) {
                    return mp3Buffer;
                }
                else {
                    console.error("Failed to convert WAV to MP3");
                    return null;
                }
            }
            else {
                console.error(" Failed to get audio stream from Deepgram TTS");
                return null;
            }
        }
        catch (error) {
            console.error("Text-to-speech error:", error);
            return null;
        }
    });
}
/**
 * Helper function to convert stream to audio buffer
 */
function getAudioBuffer(response) {
    return __awaiter(this, void 0, void 0, function* () {
        const reader = response.getReader();
        const chunks = [];
        while (true) {
            const { done, value } = yield reader.read();
            if (done)
                break;
            chunks.push(value);
        }
        const dataArray = chunks.reduce((acc, chunk) => Uint8Array.from([...acc, ...chunk]), new Uint8Array(0));
        return Buffer.from(dataArray.buffer);
    });
}
/**
 * Convert WAV buffer to MP3 buffer using streaming ffmpeg (much faster - no temp files!)
 * @param wavBuffer - The WAV audio buffer to convert
 * @returns MP3 audio buffer
 */
function convertWavToMp3(wavBuffer) {
    return __awaiter(this, void 0, void 0, function* () {
        return new Promise((resolve) => {
            try {
                console.log("🎵 Starting streaming WAV→MP3 conversion...");
                const startTime = Date.now();
                const mp3Chunks = [];
                const { Readable, PassThrough } = require("stream");
                const inputStream = new Readable();
                inputStream.push(wavBuffer);
                inputStream.push(null);
                const outputStream = new PassThrough();
                const command = (0, fluent_ffmpeg_1.default)(inputStream)
                    .inputFormat("wav")
                    .audioCodec("libmp3lame")
                    .audioBitrate(64)
                    .audioFrequency(16000)
                    .format("mp3")
                    .on("start", (commandLine) => {
                    console.log("🔄 FFmpeg streaming command:", commandLine.substring(0, 100) + "...");
                })
                    .on("end", () => {
                    const duration = Date.now() - startTime;
                    console.log(`✅ Streaming conversion complete in ${duration}ms`);
                    const finalMp3Buffer = Buffer.concat(mp3Chunks);
                    console.log(`🎵 MP3 buffer size: ${finalMp3Buffer.length} bytes`);
                    resolve(finalMp3Buffer);
                })
                    .on("error", (error) => {
                    console.error("❌ Streaming FFmpeg error:", error);
                    resolve(null);
                });
                outputStream.on("data", (chunk) => {
                    mp3Chunks.push(chunk);
                });
                outputStream.on("error", (error) => {
                    console.error("❌ Output stream error:", error);
                    resolve(null);
                });
                command.pipe(outputStream, { end: true });
            }
            catch (error) {
                console.error("❌ Streaming conversion setup error:", error);
                resolve(null);
            }
        });
    });
}
