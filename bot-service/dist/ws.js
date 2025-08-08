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
function processTextWithLLM(text, source) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            console.log(`🧠 Processing ${source} text with LLM: "${text}"`);
            const reply = yield (0, llm_1.askLLM)(text);
            if (reply) {
                console.log(`🤖 LLM Reply for ${source}:`, reply);
                // Convert LLM response to speech
                console.log("🔊 Converting LLM response to speech...");
                const audioBuffer = yield (0, llm_1.textToSpeech)(reply);
                if (audioBuffer) {
                    console.log("🎵 Audio buffer size:", audioBuffer.length, "bytes");
                    // Send TTS audio to the bot to speak in the call
                    const success = yield (0, recall_1.sendAudioToBot)(audioBuffer);
                    if (success) {
                        console.log(`🗣️ Bot will now speak the response for ${source} in the call!`);
                    }
                    else {
                        console.log("❌ Failed to send audio to bot");
                    }
                }
                else {
                    console.log("❌ Failed to convert LLM response to speech");
                }
            }
            else {
                console.log(`🤖 LLM: No response generated for ${source}`);
            }
        }
        catch (error) {
            console.error(`❌ LLM processing error for ${source}:`, error);
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
