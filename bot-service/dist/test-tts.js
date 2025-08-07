"use strict";
/**
 * Test script for Text-to-Speech functionality
 * This script tests the TTS integration with the dummy LLM
 */
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
const llm_1 = require("./llm");
const fs_1 = __importDefault(require("fs"));
function testTTSFunctionality() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log("🧪 Testing TTS functionality...\n");
        // Test cases
        const testTranscripts = [
            "hello",
            "Hello there",
            "HELLO WORLD",
            "hi how are you",
            "hey there",
            "how are you doing",
            "good morning", // This should not trigger a response
        ];
        for (const transcript of testTranscripts) {
            console.log(`\n📝 Testing transcript: "${transcript}"`);
            try {
                // Test the LLM
                const llmResponse = yield (0, llm_1.askLLM)(transcript);
                if (llmResponse) {
                    console.log(`✅ LLM Response: "${llmResponse}"`);
                    // Test TTS conversion
                    console.log("🔊 Converting to speech...");
                    const audioBuffer = yield (0, llm_1.textToSpeech)(llmResponse);
                    if (audioBuffer) {
                        // Save the audio file
                        const fileName = `/tmp/test_tts_${transcript
                            .replace(/\s+/g, "_")
                            .toLowerCase()}_${Date.now()}.wav`;
                        fs_1.default.writeFileSync(fileName, audioBuffer);
                        console.log(`🎵 Audio saved: ${fileName} (${audioBuffer.length} bytes)`);
                    }
                    else {
                        console.log("❌ TTS conversion failed");
                    }
                }
                else {
                    console.log("🤐 No LLM response (expected for non-trigger words)");
                }
            }
            catch (error) {
                console.error("❌ Error:", error);
            }
        }
        console.log("\n🎉 TTS testing completed!");
        console.log("💡 Check /tmp/ directory for generated audio files");
        console.log("🎧 You can play the audio files using any media player");
    });
}
// Run the test
testTTSFunctionality().catch(console.error);
