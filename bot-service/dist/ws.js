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
const ws_1 = __importDefault(require("ws"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const llm_1 = require("./llm");
const recall_1 = require("./recall");
const constants_1 = require("./constants");
const recall_2 = require("./recall");
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
        // Smaller max chunk size is handled by splitIntoChunks
        const chunks = splitIntoChunks(reply);
        // Prefetch pipeline: keep one chunk ahead
        let nextBufferPromise = null;
        for (let i = 0; i < chunks.length; i += 1) {
            if (hasGenerationBeenCancelled(generationId)) {
                console.log("🛑 Chunked TTS cancelled before generating next chunk");
                break;
            }
            const chunk = chunks[i];
            // Kick off prefetch for current chunk if not already
            if (!nextBufferPromise) {
                nextBufferPromise = (0, llm_1.textToSpeech)(chunk);
            }
            // Wait for current chunk buffer
            const audioBuffer = yield nextBufferPromise;
            if (hasGenerationBeenCancelled(generationId)) {
                console.log("🛑 Chunked TTS cancelled after generation, before send");
                break;
            }
            if (!audioBuffer) {
                console.log("❌ Failed to convert chunk to speech, skipping chunk");
                // Prepare next prefetch if any
                const nextChunk = chunks[i + 1];
                nextBufferPromise = nextChunk ? (0, llm_1.textToSpeech)(nextChunk) : null;
                continue;
            }
            // Prefetch the next chunk now (overlap generation with current playback)
            const nextChunk = chunks[i + 1];
            nextBufferPromise = nextChunk ? (0, llm_1.textToSpeech)(nextChunk) : null;
            // Do not stop audio between chunks; only stop on cancellation/interruption
            // Send the audio chunk
            const speechId = `speech_${Date.now()}_${Math.random()
                .toString(36)
                .substr(2, 9)}`;
            const success = yield (0, recall_1.sendAudioToBot)(audioBuffer);
            if (!success) {
                console.log("❌ Failed to send audio chunk to bot");
                break; // stop to avoid piling up
            }
            // Mark speaking and estimate duration for pacing (minimal buffer)
            (0, llm_1.startBotSpeaking)(speechId, chunk);
            isAudioPlaying = true;
            currentAudioId = speechId;
            const estimatedMs = Math.max(450, estimateDurationMs(chunk) + 50); // smaller buffer
            // Wait in small slices so we can react to cancellation quickly
            let remaining = estimatedMs;
            while (remaining > 0) {
                if (hasGenerationBeenCancelled(generationId)) {
                    console.log("🛑 Chunked TTS cancelled mid-wait; attempting to stop audio");
                    yield (0, recall_1.stopBotAudio)();
                    break;
                }
                const slice = Math.min(80, remaining); // tighter slices for faster reaction
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
// ===== Video Script Playback =====
// Serialize screenshare switches to avoid overlapping DELETE/POST calls
let screenshareSwitchChain = Promise.resolve();
let isScreenshareAllowed = false; // Only switch screens when explicitly enabled by user
let isVideoScriptPlaying = false; // Block OCR-driven interruptions during script playback
function queueScreenshareSwitch(url) {
    screenshareSwitchChain = screenshareSwitchChain.then(() => __awaiter(this, void 0, void 0, function* () {
        try {
            if (!isScreenshareAllowed) {
                console.log("⏸️ Screenshare switch skipped (not allowed). Say 'start screenshare' to enable.");
                return;
            }
            yield (0, recall_2.switchScreenshare)(url);
            // Wait until Recall confirms the webpage is set, or time out gracefully
            const ok = yield (0, recall_1.waitForScreenshareUrl)(url, 8000, 400);
            if (!ok) {
                console.warn("⚠️ Screenshare URL did not confirm in time; proceeding anyway");
                // Fallback delay to give Meet a chance to render
                yield sleep(1200);
            }
        }
        catch (e) {
            console.error("❌ queueScreenshareSwitch error:", e);
        }
    }));
    return screenshareSwitchChain;
}
function playVideoScript(script) {
    return __awaiter(this, void 0, void 0, function* () {
        isVideoScriptPlaying = true;
        try {
            // Ensure screenshare switches are allowed during a video script
            if (!isScreenshareAllowed) {
                console.log("🟢 Enabling screenshare for video script playback");
                isScreenshareAllowed = true;
            }
            // If enabled, start a single-stream screenshare with embedded script instructions
            if (constants_1.USE_EMBEDDED_SCRIPT) {
                try {
                    const url = (0, constants_1.buildScreenshareUrlWithScript)(script);
                    yield queueScreenshareSwitch(url);
                }
                catch (e) {
                    console.error("❌ Failed to start embedded-script screenshare:", e);
                }
            }
            // Speak each segment; if not embedded, switch backgrounds per segment
            for (const segment of script.segments) {
                // If a new user input started processing, abort remaining segments
                if (isCurrentlyProcessing && !isVideoScriptPlaying) {
                    console.log("🛑 Aborting video script playback due to new input");
                    break;
                }
                if (!(segment === null || segment === void 0 ? void 0 : segment.narration))
                    continue;
                if (!constants_1.USE_EMBEDDED_SCRIPT && segment.background_url) {
                    try {
                        // Accept full URLs or shorthand tags like /github, /jerkin, /datadog
                        const resolved = (0, constants_1.resolveBackgroundUrl)(segment.background_url);
                        yield queueScreenshareSwitch(resolved);
                    }
                    catch (e) {
                        console.error("❌ Failed to switch background:", e);
                    }
                }
                const generationId = newTtsGenerationId();
                yield speakInChunks(segment.narration, generationId, "chat");
                // If cancelled mid-segment, stop the rest of the script
                if (hasGenerationBeenCancelled(generationId) ||
                    (isCurrentlyProcessing && !isVideoScriptPlaying)) {
                    console.log("🛑 Video script playback cancelled/interrupted");
                    break;
                }
            }
        }
        finally {
            isVideoScriptPlaying = false;
        }
    });
}
// ===== Screen OCR Session State =====
let isScreenOcrActive = constants_1.SCREEN_OCR.enabledByDefault;
let lastScreenOcrTs = 0;
let screenOcrSessionEndsAt = 0;
function matchesAny(text, phrases) {
    const t = (text || "").toLowerCase();
    return phrases.some((p) => t.includes(p));
}
function maybeStartScreenOcrSession(triggerText) {
    if (matchesAny(triggerText, constants_1.SCREEN_OCR_PHRASES.start)) {
        isScreenOcrActive = true;
        lastScreenOcrTs = 0;
        screenOcrSessionEndsAt = Date.now() + constants_1.SCREEN_OCR.sessionTimeoutMs;
        console.log("🔎 Screen OCR session started for", constants_1.SCREEN_OCR.sessionTimeoutMs, "ms");
        return "I'm now analyzing your screen. I'll look for errors, logs, and any issues I can help debug. Share your screen if you haven't already.";
    }
    if (matchesAny(triggerText, constants_1.SCREEN_OCR_PHRASES.stop)) {
        isScreenOcrActive = false;
        screenOcrSessionEndsAt = 0;
        console.log("🛑 Screen OCR session stopped by user");
        return "Screen analysis stopped. Let me know if you need anything else!";
    }
    return null;
}
function maybeToggleScreensharePermission(triggerText) {
    if (matchesAny(triggerText, constants_1.SCREENSHARE_PHRASES.start)) {
        isScreenshareAllowed = true;
        console.log("🟢 Screenshare permission ENABLED by user");
        return "Okay, I'll share visuals when needed. Say 'stop screenshare' anytime to disable it.";
    }
    if (matchesAny(triggerText, constants_1.SCREENSHARE_PHRASES.stop)) {
        isScreenshareAllowed = false;
        console.log("🔴 Screenshare permission DISABLED by user");
        // Best-effort stop on backend to immediately halt visuals
        void (0, recall_1.stopScreenshare)();
        return "Got it. I won't share the screen until you ask me to again.";
    }
    return null;
}
function processTextWithLLM(text, source) {
    return __awaiter(this, void 0, void 0, function* () {
        // Allow preemption: do NOT return early. If something is already
        // processing or speaking, we will interrupt it below.
        const wasPreempting = isCurrentlyProcessing;
        if (wasPreempting && !isVideoScriptPlaying) {
            console.log(`⚡ Preempting ongoing processing with new ${source} input`);
        }
        const processingId = `proc_${Date.now()}_${Math.random()
            .toString(36)
            .substr(2, 9)}`;
        try {
            isCurrentlyProcessing = true;
            currentProcessingId = processingId;
            console.log(`🧠 Processing ${source} text with LLM: "${text}"`);
            // Check for interruption - if user speaks while bot is talking
            const wasInterrupted = isVideoScriptPlaying ? false : (0, llm_1.handleInterruption)(text);
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
            // Now mark this turn as processing after clearing any old state
            (0, llm_1.setBotProcessing)(true);
            let reply = null;
            // 1) Greeting takes priority for a warm welcome
            if ((0, llm_1.isGreeting)(text)) {
                reply = (0, llm_1.generateGreetingResponse)(text);
            }
            else if ((0, llm_1.shouldGenerateVideoScript)(text)) {
                // 2) Full pipeline: root cause → structured video script → playback
                const pipeline = yield (0, llm_1.runIncidentVideoScriptPipeline)(text);
                if (pipeline === null || pipeline === void 0 ? void 0 : pipeline.script) {
                    // Short acknowledgement before starting the guided screenshare
                    const ack = "Sharing a quick incident walkthrough and screenshare now.";
                    const generationId = newTtsGenerationId();
                    yield speakInChunks(ack, generationId, source);
                    // Start playback asynchronously after the ack
                    void playVideoScript(pipeline.script);
                    // Consider this handled; avoid duplicative reply
                    reply = null;
                }
                else {
                    // Fallback: unstructured video script text
                    reply = yield (0, llm_1.generateIncidentVideoScript)(text);
                }
            }
            else {
                // 3) Default short incident triage reply
                reply = yield (0, llm_1.askLLM)(text, wasInterrupted);
                // Deterministic fallbacks when LLM yields nothing, especially after interruption
                if (!reply) {
                    const intent = (0, llm_1.getIntentForText)(text);
                    if (intent === "identity") {
                        reply = (0, llm_1.generateIdentityResponse)();
                    }
                    else if (intent === "short") {
                        reply = (0, llm_1.generateShortAckResponse)();
                    }
                }
            }
            // If another newer request superseded this one while awaiting LLM, drop it
            if (currentProcessingId !== processingId) {
                console.log("🧵 Discarding stale LLM result due to newer input");
                reply = null;
            }
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
        var _a, _b;
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
                    // Try toggling OCR session and screenshare permission from transcript commands
                    const ocrResponse = maybeStartScreenOcrSession(transcriptText);
                    const shareResponse = maybeToggleScreensharePermission(transcriptText);
                    if (ocrResponse && !isVideoScriptPlaying) {
                        yield processTextWithLLM(ocrResponse, "transcript");
                    }
                    if (shareResponse && !isVideoScriptPlaying) {
                        yield processTextWithLLM(shareResponse, "transcript");
                    }
                    if (!ocrResponse && !shareResponse) {
                        yield processTextWithLLM(transcriptText, "transcript");
                    }
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
                    // Try toggling OCR session and screenshare permission from chat commands
                    const ocrResponse = maybeStartScreenOcrSession(chatData.text);
                    const shareResponse = maybeToggleScreensharePermission(chatData.text);
                    if (ocrResponse && !isVideoScriptPlaying) {
                        yield processTextWithLLM(ocrResponse, "chat");
                    }
                    if (shareResponse && !isVideoScriptPlaying) {
                        yield processTextWithLLM(shareResponse, "chat");
                    }
                    if (!ocrResponse && !shareResponse) {
                        yield processTextWithLLM(chatData.text, "chat");
                    }
                }
                else {
                    console.log("⏭️ Skipping empty chat message");
                }
            }
            else if (wsMessage.event === "video_separate_png.data") {
                const videoEvent = wsMessage;
                const buffer = videoEvent.data.data.buffer;
                const timestamp = videoEvent.data.data.timestamp;
                const type = videoEvent.data.data.type;
                const participant = videoEvent.data.data.participant;
                const botId = videoEvent.data.bot.id;
                const recordingId = videoEvent.data.recording.id;
                // Persist the received image to the "upload" folder
                try {
                    const uploadDir = path.resolve(__dirname, "..", "upload");
                    // Ensure directory exists
                    try {
                        fs.mkdirSync(uploadDir, { recursive: true });
                    }
                    catch (mkdirErr) {
                        console.error("❌ Failed to ensure upload directory:", mkdirErr);
                    }
                    // Some sources may prepend a data URL header; strip if present
                    const base64Data = buffer.startsWith("data:")
                        ? buffer.split(",")[1] || ""
                        : buffer;
                    const imageBuffer = Buffer.from(base64Data, "base64");
                    // Sanitize parts used in filename
                    const safeAbs = String(timestamp.absolute || "")
                        .replace(/[^\w.-]/g, "_")
                        .slice(0, 64);
                    const safeType = String(type || "unknown").replace(/[^\w.-]/g, "_");
                    const safeParticipant = String((_b = participant.id) !== null && _b !== void 0 ? _b : "unknown").toString();
                    const filenameBase = safeAbs || `ts_${Date.now()}`;
                    const filename = `${filenameBase}_${safeType}_${safeParticipant}.png`;
                    const filePath = path.join(uploadDir, filename);
                    yield fs.promises.writeFile(filePath, imageBuffer);
                }
                catch (saveErr) {
                    console.error("❌ Failed to save received image frame:", saveErr);
                }
                try {
                    const now = Date.now();
                    const active = isScreenOcrActive &&
                        (screenOcrSessionEndsAt === 0 || now < screenOcrSessionEndsAt);
                    // Only process screenshare frames, not webcam
                    if (active &&
                        type === "screenshare" &&
                        now - lastScreenOcrTs >= constants_1.SCREEN_OCR.throttleMs) {
                        lastScreenOcrTs = now;
                        const base64Data = buffer.startsWith("data:")
                            ? buffer.split(",")[1] || ""
                            : buffer;
                        console.log("🖼️ Processing screenshare frame for OCR...");
                        const summary = yield (0, llm_1.summarizeFromImageBase64)(base64Data);
                        if (summary === null || summary === void 0 ? void 0 : summary.trim()) {
                            console.log("🖼️ OCR Summary:", summary);
                            // Feed into LLM routing for narration and possible video script
                            yield processTextWithLLM(summary, "transcript");
                        }
                        else {
                            console.log("🖼️ No meaningful content detected in screenshare");
                        }
                    }
                    // Auto-stop session after timeout
                    if (screenOcrSessionEndsAt && now >= screenOcrSessionEndsAt) {
                        isScreenOcrActive = false;
                        screenOcrSessionEndsAt = 0;
                        console.log("⌛ Screen OCR session auto-stopped after timeout");
                    }
                }
                catch (ocrErr) {
                    console.error("❌ Screen OCR processing error:", ocrErr);
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
console.log("💡 Make sure your ngrok WebSocket URL is: wss://13798a9d8d7c.ngrok-free.app");
