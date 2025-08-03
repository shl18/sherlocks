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
const fs_1 = __importDefault(require("fs"));
const sdk_1 = require("@deepgram/sdk");
const llm_1 = require("./llm");
const deepgramClient = (0, sdk_1.createClient)(process.env.DEEPGRAM_API_KEY);
const wss = new ws_1.default.Server({ port: 3456 });
wss.on("connection", (ws) => {
    console.log("New WebSocket client connected");
    // Create Deepgram connection for this WebSocket session
    const deepgramConnection = deepgramClient.listen.live({
        model: "nova-2",
        smart_format: true,
        language: "en-US",
        punctuate: true,
        interim_results: false,
    });
    deepgramConnection.on("open", () => {
        console.log("Deepgram socket opened for new connection");
    });
    deepgramConnection.on("transcript", (data) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b;
        console.log("🔍 Raw Deepgram data:", JSON.stringify(data, null, 2));
        const transcript = (_b = (_a = data.channel) === null || _a === void 0 ? void 0 : _a.alternatives[0]) === null || _b === void 0 ? void 0 : _b.transcript;
        if (transcript && transcript.trim()) {
            console.log("🎤 Transcript:", transcript);
            try {
                const reply = yield (0, llm_1.askLLM)(transcript);
                console.log("🤖 LLM Reply:", reply);
            }
            catch (error) {
                console.error("LLM error:", error);
            }
        }
        else {
            console.log("🔕 No transcript or empty transcript received");
        }
    }));
    deepgramConnection.on("error", (err) => {
        console.error("Deepgram error:", err);
    });
    ws.on("message", (message) => {
        try {
            const wsMessage = JSON.parse(message.toString());
            if (wsMessage.event === "audio_mixed_raw.data") {
                console.log(`📥 Received audio packet, recording ID: ${wsMessage.data.recording.id}`);
                const audioBuffer = Buffer.from(wsMessage.data.data.buffer, "base64");
                console.log(`🔊 Sending ${audioBuffer.length} bytes to Deepgram`);
                deepgramConnection.send(audioBuffer);
                const recordingId = wsMessage.data.recording.id;
                const filePath = `/tmp/${recordingId}.bin`;
                fs_1.default.appendFileSync(filePath, audioBuffer);
            }
            else {
                console.log(`Unhandled event type: ${wsMessage.event}`);
            }
        }
        catch (error) {
            console.error("Failed to parse or process message:", error);
        }
    });
    ws.on("error", (error) => {
        console.error("WebSocket error:", error);
    });
    ws.on("close", () => {
        console.log("WebSocket connection closed");
        deepgramConnection.requestClose();
    });
});
console.log("WebSocket server started and listening on port 3456");
