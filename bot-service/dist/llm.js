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
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const deepgramClient = (0, sdk_1.createClient)(process.env.DEEPGRAM_API_KEY);
/**
 * Dummy LLM that responds to specific keywords
 * This is a simple implementation that listens for "hello" and responds appropriately
 */
function askLLM(transcript) {
    return __awaiter(this, void 0, void 0, function* () {
        // Convert transcript to lowercase for case-insensitive matching
        const normalizedTranscript = transcript.toLowerCase().trim();
        console.log("🎧 Processing transcript:", transcript);
        // Check if the transcript contains "hello"
        if (normalizedTranscript.includes("hello") ||
            normalizedTranscript.includes("hi") ||
            normalizedTranscript.includes("hey") ||
            normalizedTranscript.includes("how are you") ||
            normalizedTranscript.includes("how are you doing")) {
            const reply = "`hey i am sherlocks`";
            console.log("🤖 LLM Response:", reply);
            return reply;
        }
        // For now, we'll only respond to "hello"
        // You can add more trigger words and responses here
        console.log("🤐 No response triggered for this transcript");
        return null;
    });
}
/**
 * Convert text to speech using Deepgram TTS API
 * @param text - The text to convert to speech
 * @returns Audio buffer containing the generated speech
 */
function textToSpeech(text) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            console.log("🔊 Converting text to speech:", text);
            // Make TTS request to Deepgram
            const response = yield deepgramClient.speak.request({ text }, {
                model: "aura-2-thalia-en", // Use a natural-sounding voice
                encoding: "linear16",
                container: "wav",
                sample_rate: 16000, // Match the audio format expected by Recall AI
            });
            // Get the audio stream from the response
            const stream = yield response.getStream();
            if (stream) {
                // Convert stream to buffer
                const audioBuffer = yield getAudioBuffer(stream);
                console.log("✅ Text-to-speech conversion successful, audio buffer size:", audioBuffer.length);
                return audioBuffer;
            }
            else {
                console.error("❌ Failed to get audio stream from Deepgram TTS");
                return null;
            }
        }
        catch (error) {
            console.error("❌ Text-to-speech error:", error);
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
