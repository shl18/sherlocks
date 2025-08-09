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
exports.isBotSpeaking = isBotSpeaking;
exports.startBotSpeaking = startBotSpeaking;
exports.stopBotSpeaking = stopBotSpeaking;
exports.clearSpeechQueue = clearSpeechQueue;
exports.isBotProcessing = isBotProcessing;
exports.setBotProcessing = setBotProcessing;
exports.handleInterruption = handleInterruption;
exports.getRemainingSpeechDuration = getRemainingSpeechDuration;
exports.forceResetBotState = forceResetBotState;
exports.askLLM = askLLM;
exports.textToSpeech = textToSpeech;
const sdk_1 = require("@deepgram/sdk");
const fluent_ffmpeg_1 = __importDefault(require("fluent-ffmpeg"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const deepgramClient = (0, sdk_1.createClient)(process.env.DEEPGRAM_API_KEY);
const conversationContext = {
    recentIntents: [],
    lastResponseTime: 0,
};
const botState = {
    isSpeaking: false,
    currentSpeechId: null,
    speechStartTime: null,
    estimatedSpeechDuration: null,
    speechQueue: [],
    isProcessing: false,
    lastSpeechText: null,
};
const MAX_INTENT_HISTORY = 5;
const MIN_RESPONSE_INTERVAL = 2000;
const SAME_INTENT_COOLDOWN = 6000;
// Average speaking rate: ~150 words per minute (2.5 words per second)
// Average word length: ~5 characters, so roughly 12.5 characters per second
const CHARACTERS_PER_SECOND = 12.5;
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
        normalizedTranscript.includes("what do you do") ||
        normalizedTranscript.includes("what you do") ||
        normalizedTranscript.includes("what are you") ||
        normalizedTranscript.includes("what is this") ||
        normalizedTranscript.includes("tell me about yourself") ||
        normalizedTranscript.includes("introduce yourself")) {
        return "identity";
    }
    if (normalizedTranscript.includes("yes") ||
        normalizedTranscript.includes("ok") ||
        normalizedTranscript.includes("sure") ||
        normalizedTranscript.includes("thanks") ||
        normalizedTranscript.includes("bye")) {
        return "short";
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
/**
 * Estimate speech duration based on text length
 */
function estimateSpeechDuration(text) {
    return Math.ceil((text.length / CHARACTERS_PER_SECOND) * 1000); // in milliseconds
}
/**
 * Check if bot is currently speaking
 */
function isBotSpeaking() {
    if (!botState.isSpeaking)
        return false;
    // Check if estimated speech time has passed
    if (botState.speechStartTime && botState.estimatedSpeechDuration) {
        const elapsed = Date.now() - botState.speechStartTime;
        if (elapsed > botState.estimatedSpeechDuration) {
            // Speech should have finished, update state
            stopBotSpeaking();
            return false;
        }
    }
    return true;
}
/**
 * Mark bot as speaking
 */
function startBotSpeaking(speechId, text) {
    const duration = estimateSpeechDuration(text);
    botState.isSpeaking = true;
    botState.currentSpeechId = speechId;
    botState.speechStartTime = Date.now();
    botState.estimatedSpeechDuration = duration;
    botState.lastSpeechText = text;
    console.log(`🗣️ Bot started speaking (ID: ${speechId}, estimated duration: ${duration}ms)`);
    // Auto-stop after estimated duration + buffer
    setTimeout(() => {
        if (botState.currentSpeechId === speechId) {
            stopBotSpeaking();
        }
    }, duration + 1000); // Add 1 second buffer
}
/**
 * Mark bot as stopped speaking
 */
function stopBotSpeaking() {
    if (botState.isSpeaking) {
        console.log(`🔇 Bot stopped speaking (was ID: ${botState.currentSpeechId})`);
    }
    botState.isSpeaking = false;
    botState.currentSpeechId = null;
    botState.speechStartTime = null;
    botState.estimatedSpeechDuration = null;
    botState.lastSpeechText = null;
}
/**
 * Clear speech queue when interrupted
 */
function clearSpeechQueue() {
    if (botState.speechQueue.length > 0) {
        console.log(`🗑️ Clearing speech queue (${botState.speechQueue.length} items)`);
        botState.speechQueue = [];
    }
}
/**
 * Check if bot is currently processing a request
 */
function isBotProcessing() {
    return botState.isProcessing;
}
/**
 * Set bot processing state
 */
function setBotProcessing(processing) {
    botState.isProcessing = processing;
    if (processing) {
        console.log("🔄 Bot started processing request");
    }
    else {
        console.log("✅ Bot finished processing request");
    }
}
/**
 * Handle interruption when user speaks while bot is talking
 */
function handleInterruption(newTranscript) {
    if (isBotSpeaking() || isBotProcessing()) {
        console.log(`🚫 INTERRUPTION DETECTED! User said: "${newTranscript}"`);
        if (isBotSpeaking()) {
            console.log(`🔇 Stopping bot speech (ID: ${botState.currentSpeechId})`);
            stopBotSpeaking();
        }
        if (isBotProcessing()) {
            console.log("⏹️ Bot was processing - marking as interrupted");
        }
        // Clear any queued speech
        clearSpeechQueue();
        // Reset processing state
        setBotProcessing(false);
        return true;
    }
    return false;
}
/**
 * Get remaining speech duration for the current speech
 */
function getRemainingSpeechDuration() {
    if (!botState.isSpeaking ||
        !botState.speechStartTime ||
        !botState.estimatedSpeechDuration) {
        return 0;
    }
    const elapsed = Date.now() - botState.speechStartTime;
    const remaining = Math.max(0, botState.estimatedSpeechDuration - elapsed);
    return remaining;
}
/**
 * Force reset all bot states (for external interruption handling)
 */
function forceResetBotState() {
    console.log("🔄 Force resetting all bot states");
    stopBotSpeaking();
    clearSpeechQueue();
    setBotProcessing(false);
}
function askLLM(transcript_1) {
    return __awaiter(this, arguments, void 0, function* (transcript, wasInterrupted = false) {
        const normalizedTranscript = transcript.toLowerCase().trim();
        console.log("🎧 Processing transcript:", transcript);
        if (wasInterrupted) {
            console.log("🚫 Processing interrupted transcript - bypassing cooldowns");
        }
        const intent = detectIntent(normalizedTranscript);
        if (!intent) {
            console.log("No intent detected for this transcript");
            return null;
        }
        console.log("Detected intent:", intent);
        // Skip cooldown checks if this was an interruption
        if (!wasInterrupted && !shouldRespond(intent)) {
            return null;
        }
        let reply = null;
        switch (intent) {
            case "greeting":
                // Big reply
                reply =
                    "Hello there! It’s an absolute pleasure to meet you today. My name is Sherlocks — your friendly, ever-curious, and always-ready AI assistant. Think of me as your knowledgeable companion, your brainstorming buddy, and your tireless problem-solver, all wrapped into one.  I hope your day has been nothing short of amazing so far, and if it hasn’t, well… maybe I can help turn it around. Whether you’re here to explore ideas, unravel mysteries, learn something new, get help with a tricky problem, or simply enjoy a good conversation, I’m ready and eager to dive right in with you. \n\n From answering your questions with precision and clarity, to offering a spark of inspiration when you need it most, my goal is simple: to make your life easier, brighter, and a little more interesting every time we interact.";
                break;
            case "identity":
                // Medium reply
                reply =
                    "I'm Sherlocks, an AI bot designed to help you with various questions and tasks. I can assist with information, have conversations, and try to be helpful in whatever way you need.";
                break;
            case "short":
                // Small reply
                reply = "Got it!";
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
