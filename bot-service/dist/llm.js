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
Object.defineProperty(exports, "__esModule", { value: true });
exports.askLLM = askLLM;
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
        if (normalizedTranscript.includes("hello")) {
            const reply = "hi I am sherlocks how can I help you";
            console.log("🤖 LLM Response:", reply);
            return reply;
        }
        // For now, we'll only respond to "hello"
        // You can add more trigger words and responses here
        console.log("🤐 No response triggered for this transcript");
        return null;
    });
}
