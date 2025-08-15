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
const express_1 = __importDefault(require("express"));
const llm_1 = require("./llm");
const recall_1 = require("./recall");
const app = (0, express_1.default)();
const PORT = 3456;
// Middleware to parse JSON payloads
app.use(express_1.default.json());
// Health check endpoint
app.get("/health", (req, res) => {
    res.json({ status: "OK", message: "Webhook server is running" });
});
// Webhook endpoint to receive transcripts from Recall AI
app.post("/transcript", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        console.log("📥 Received webhook from Recall AI");
        console.log("🔍 Raw payload:", JSON.stringify(req.body, null, 2));
        const transcriptData = req.body;
        console.log(`📝 Transcript: "${transcriptData.text}"`);
        console.log(`🔍 Speaker: ${((_a = transcriptData.speaker) === null || _a === void 0 ? void 0 : _a.name) || ((_b = transcriptData.speaker) === null || _b === void 0 ? void 0 : _b.id) || "Unknown"}`);
        console.log(`🔍 Is final: ${transcriptData.is_final}`);
        console.log(`🔍 Confidence: ${transcriptData.confidence}`);
        console.log(`🔍 Bot ID: ${transcriptData.bot_id}`);
        console.log(`🔍 Recording ID: ${transcriptData.recording_id}`);
        // Only process final transcripts to avoid duplicate responses
        if (transcriptData.is_final && ((_c = transcriptData.text) === null || _c === void 0 ? void 0 : _c.trim())) {
            try {
                const reply = yield (0, llm_1.askLLM)(transcriptData.text);
                if (reply) {
                    console.log("🤖 LLM Reply:", reply);
                    // Convert LLM response to speech
                    console.log("🔊 Converting LLM response to speech...");
                    const audioBuffer = yield (0, llm_1.textToSpeech)(reply);
                    if (audioBuffer) {
                        console.log("🎵 Audio buffer size:", audioBuffer.length, "bytes");
                        // Send TTS audio to the bot to speak in the call
                        const success = yield (0, recall_1.sendAudioToBot)(audioBuffer);
                        if (success) {
                            console.log("🗣️ Bot will now speak the response in the call!");
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
                    console.log("🤖 LLM: No response generated");
                }
            }
            catch (error) {
                console.error("❌ LLM processing error:", error);
            }
        }
        else {
            console.log("⏭️ Skipping interim transcript or empty text");
        }
        // Respond with 200 OK to acknowledge receipt
        res.status(200).json({ message: "Transcript received successfully" });
    }
    catch (error) {
        console.error("❌ Failed to process webhook:", error);
        res.status(500).json({ error: "Failed to process transcript" });
    }
}));
// Start the webhook server
app.listen(PORT, () => {
    console.log(`✅ Webhook server started on port ${PORT}`);
    console.log(`📡 Ready to receive transcript webhooks from Recall AI`);
    console.log(`🔗 Webhook URL: http://localhost:${PORT}/transcript`);
    console.log(`💡 Use ngrok to expose this URL publicly: ngrok http ${PORT}`);
});
