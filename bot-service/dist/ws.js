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
const wss = new ws_1.default.Server({ port: 3456 });
wss.on("connection", (ws) => {
    console.log("✅ New WebSocket client connected from Recall AI");
    console.log("📝 Ready to receive transcript events via WebSocket");
    ws.on("message", (message) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c;
        try {
            const wsMessage = JSON.parse(message.toString());
            console.log("📥 Received WebSocket message:", JSON.stringify(wsMessage, null, 2));
            if (wsMessage.event === "transcript.data") {
                const transcriptData = wsMessage.data;
                console.log(`📝 Transcript: "${transcriptData.text}"`);
                console.log(`🔍 Speaker: ${((_a = transcriptData.speaker) === null || _a === void 0 ? void 0 : _a.name) ||
                    ((_b = transcriptData.speaker) === null || _b === void 0 ? void 0 : _b.id) ||
                    "Unknown"}`);
                console.log(`🔍 Is final: ${transcriptData.is_final}`);
                console.log(`🔍 Confidence: ${transcriptData.confidence || "N/A"}`);
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
