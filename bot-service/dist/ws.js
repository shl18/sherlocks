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
const ws_1 = __importDefault(require("ws"));
const llm_1 = require("./llm");
const recall_1 = require("./recall");
/**
 * Process text input with LLM and send audio response
 * @param text - The text to process (from transcript or chat)
 * @param source - The source of the text ("transcript" or "chat")
 */
// Global lock to prevent concurrent processing
let isCurrentlyProcessing = false;
let currentProcessingId = null;
let lastAudioSentTime = 0;
const AUDIO_COOLDOWN_MS = 10000; // 10 seconds minimum time between audio outputs to prevent overlap
// Global audio lock to prevent any audio overlap
let isAudioPlaying = false;
let currentAudioId = null;
// ===== Chunked TTS Playback (Cancelable) =====
let currentTtsGenerationId = null;
function newTtsGenerationId() {
    const id = `gen_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    currentTtsGenerationId = id;
    return id;
}
function cancelCurrentTtsGeneration() {
    currentTtsGenerationId = null;
}
function hasGenerationBeenCancelled(generationId) {
    return currentTtsGenerationId !== generationId;
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function splitIntoChunks(text) {
    const maxLen = 140; // keep chunks short for fast latency
    // First split by sentence boundaries
    const sentences = text
        .split(/([.!?]+\s+)/)
        .reduce((acc, part, idx, arr) => {
        if (part.trim().length === 0)
            return acc;
        // Merge text with its following punctuation token
        if (idx < arr.length - 1 && /[.!?]+\s+/.test(arr[idx + 1] || "")) {
            acc.push((part + (arr[idx + 1] || "")).trim());
            arr[idx + 1] = ""; // consume the punctuation token
        }
        else {
            acc.push(part.trim());
        }
        return acc;
    }, []);
    const chunks = [];
    for (const sentence of sentences) {
        if (sentence.length <= maxLen) {
            chunks.push(sentence);
            continue;
        }
        // Further split long sentences by words without breaking mid-word
        const words = sentence.split(/\s+/);
        let buf = "";
        for (const word of words) {
            if ((buf + (buf ? " " : "") + word).length > maxLen) {
                if (buf)
                    chunks.push(buf);
                buf = word;
            }
            else {
                buf = buf ? `${buf} ${word}` : word;
            }
        }
        if (buf)
            chunks.push(buf);
    }
    return chunks;
}
function estimateDurationMs(text) {
    // ~12.5 chars/sec from llm.ts
    const CHARACTERS_PER_SECOND = 12.5;
    const base = Math.ceil((text.length / CHARACTERS_PER_SECOND) * 1000);
    return Math.max(600, base); // minimum ~0.6s to avoid ultra short clips
}
function speakInChunks(reply, generationId, source) {
    return __awaiter(this, void 0, void 0, function* () {
        const chunks = splitIntoChunks(reply);
        for (const chunk of chunks) {
            if (hasGenerationBeenCancelled(generationId)) {
                console.log("🛑 Chunked TTS cancelled before generating next chunk");
                break;
            }
            // Generate TTS for this chunk
            const audioBuffer = yield (0, llm_1.textToSpeech)(chunk);
            if (!audioBuffer) {
                console.log("❌ Failed to convert chunk to speech, skipping chunk");
                continue;
            }
            if (hasGenerationBeenCancelled(generationId)) {
                console.log("🛑 Chunked TTS cancelled after generation, before send");
                break;
            }
            // Ensure we are not overlapping: if something else is speaking, try to stop and wait briefly
            if (isAudioPlaying || (0, llm_1.isBotSpeaking)()) {
                console.log("🔇 Attempting to stop audio before sending next chunk...");
                yield (0, recall_1.stopBotAudio)();
                yield sleep(250);
            }
            // Send the audio chunk
            const speechId = `speech_${Date.now()}_${Math.random()
                .toString(36)
                .substr(2, 9)}`;
            const success = yield (0, recall_1.sendAudioToBot)(audioBuffer);
            if (!success) {
                console.log("❌ Failed to send audio chunk to bot");
                // If send fails, cancel the rest to avoid piling up
                break;
            }
            // Mark speaking and estimate duration for pacing
            (0, llm_1.startBotSpeaking)(speechId, chunk);
            isAudioPlaying = true;
            currentAudioId = speechId;
            const estimatedMs = estimateDurationMs(chunk) + 200; // small buffer
            // Wait in small slices so we can react to cancellation quickly
            let remaining = estimatedMs;
            while (remaining > 0) {
                if (hasGenerationBeenCancelled(generationId)) {
                    console.log("🛑 Chunked TTS cancelled mid-wait; attempting to stop audio");
                    yield (0, recall_1.stopBotAudio)();
                    break;
                }
                const slice = Math.min(150, remaining);
                yield sleep(slice);
                remaining -= slice;
            }
            // Release audio lock for next chunk
            if (currentAudioId === speechId) {
                isAudioPlaying = false;
                currentAudioId = null;
            }
            if (hasGenerationBeenCancelled(generationId)) {
                console.log("🛑 Chunked TTS cancelled after chunk send");
                break;
            }
        }
    });
}
function processTextWithLLM(text, source) {
    return __awaiter(this, void 0, void 0, function* () {
        // Prevent multiple concurrent processing
        if (isCurrentlyProcessing) {
            console.log(`⏭️ Skipping ${source} processing - already processing another request`);
            return;
        }
        const processingId = `proc_${Date.now()}_${Math.random()
            .toString(36)
            .substr(2, 9)}`;
        try {
            isCurrentlyProcessing = true;
            currentProcessingId = processingId;
            console.log(`🧠 Processing ${source} text with LLM: "${text}"`);
            // Mark bot as processing
            (0, llm_1.setBotProcessing)(true);
            // Check for interruption - if user speaks while bot is talking
            const wasInterrupted = (0, llm_1.handleInterruption)(text);
            if (wasInterrupted) {
                console.log("🚫 Previous bot speech interrupted by user input");
                // Stop any current audio output and cancel ongoing chunk generation
                console.log("🔇 Attempting to stop current bot audio...");
                yield (0, recall_1.stopBotAudio)();
                cancelCurrentTtsGeneration();
                // Reset states
                (0, llm_1.forceResetBotState)();
                currentProcessingId = processingId;
            }
            const reply = yield (0, llm_1.askLLM)(text, wasInterrupted);
            if (reply) {
                console.log(`🤖 LLM Reply for ${source}:`, reply);
                // Start chunked, cancelable playback asynchronously
                const generationId = newTtsGenerationId();
                // Fire and forget so we don't block receiving further transcripts
                void speakInChunks(reply, generationId, source);
            }
            else {
                console.log(`🤖 LLM: No response generated for ${source}`);
            }
        }
        catch (error) {
            console.error(`❌ LLM processing error for ${source}:`, error);
        }
        finally {
            // Clear processing state quickly so we can accept new inputs/interruption
            (0, llm_1.setBotProcessing)(false);
            if (currentProcessingId === processingId) {
                isCurrentlyProcessing = false;
                currentProcessingId = null;
            }
        }
    });
}
const wss = new ws_1.default.Server({ port: 3456 });
wss.on("connection", (ws) => {
    console.log("✅ New WebSocket client connected from Recall AI");
    console.log("📝 Ready to receive transcript events via WebSocket");
    ws.on("message", (message) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        try {
            const wsMessage = JSON.parse(message.toString());
            console.log("📥 Received WebSocket message:", JSON.stringify(wsMessage, null, 2));
            if (wsMessage.event === "transcript.data") {
                // Type assertion to ensure proper typing
                const transcriptEvent = wsMessage;
                // Extract data from the nested structure
                const wordsData = transcriptEvent.data.data.words;
                const participant = transcriptEvent.data.data.participant;
                const botId = transcriptEvent.data.bot.id;
                const recordingId = transcriptEvent.data.recording.id;
                // Combine all words into a transcript text
                const transcriptText = wordsData.map((word) => word.text).join(" ");
                console.log(`📝 Transcript: "${transcriptText}"`);
                console.log(`🔍 Speaker: ${participant.name} (ID: ${participant.id})`);
                console.log(`🔍 Is host: ${participant.is_host}`);
                console.log(`🔍 Word count: ${wordsData.length}`);
                console.log(`🔍 Bot ID: ${botId}`);
                console.log(`🔍 Recording ID: ${recordingId}`);
                // Process the transcript if we have text
                if (transcriptText === null || transcriptText === void 0 ? void 0 : transcriptText.trim()) {
                    yield processTextWithLLM(transcriptText, "transcript");
                }
                else {
                    console.log("⏭️ Skipping empty transcript");
                }
            }
            else if (wsMessage.event === "participant_events.chat_message") {
                // Type assertion to ensure proper typing
                const chatEvent = wsMessage;
                // Extract chat message data
                const participant = chatEvent.data.data.participant;
                const chatData = chatEvent.data.data.data;
                const timestamp = chatEvent.data.data.timestamp;
                const botId = chatEvent.data.bot.id;
                const recordingId = chatEvent.data.recording.id;
                console.log(`💬 Chat Message: "${chatData.text}"`);
                console.log(`🔍 Speaker: ${participant.name}`);
                console.log(`🔍 Is host: ${participant.is_host}`);
                console.log(`🔍 To: ${chatData.to}`);
                console.log(`🔍 Timestamp: ${timestamp.absolute}`);
                console.log(`🔍 Bot ID: ${botId}`);
                console.log(`🔍 Recording ID: ${recordingId}`);
                // Process the chat message if we have text
                if ((_a = chatData.text) === null || _a === void 0 ? void 0 : _a.trim()) {
                    yield processTextWithLLM(chatData.text, "chat");
                }
                else {
                    console.log("⏭️ Skipping empty chat message");
                }
            }
            else {
                console.log(`❓ Unhandled event type: ${wsMessage.event}`);
            }
        }
        catch (error) {
            console.error("❌ Failed to parse or process message:", error);
            console.error("📥 Raw message:", message.toString());
        }
    }));
    ws.on("error", (error) => {
        console.error("❌ WebSocket error:", error);
    });
    ws.on("close", () => {
        console.log("🔌 WebSocket connection closed");
    });
});
console.log("✅ WebSocket server started and listening on port 3456");
console.log("📡 Ready to receive transcript events from Recall AI via WebSocket");
console.log("💡 Make sure your ngrok WebSocket URL is: wss://6fad6a2e0355.ngrok-free.app");
