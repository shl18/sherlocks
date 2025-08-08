"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.interruptionHandler = void 0;
class InterruptionHandler {
    constructor() {
        this.botState = {
            isSpeaking: false,
            currentResponse: null,
            responseStartTime: null,
            interruptedAt: null,
            resumeAfterInterruption: false,
        };
        this.interruptedResponses = [];
        this.INTERRUPTION_THRESHOLD_MS = 500; // Minimum time speaking before allowing interruption
        this.RESUME_TIMEOUT_MS = 3000; // Time to wait after user stops speaking before resuming
    }
    /**
     * Mark that the bot has started speaking
     */
    startSpeaking(responseText) {
        console.log("🤖 Bot started speaking:", responseText.substring(0, 50) + "...");
        this.botState = {
            isSpeaking: true,
            currentResponse: responseText,
            responseStartTime: Date.now(),
            interruptedAt: null,
            resumeAfterInterruption: false,
        };
    }
    /**
     * Mark that the bot has finished speaking
     */
    finishSpeaking() {
        console.log("🤖 Bot finished speaking");
        this.botState = {
            isSpeaking: false,
            currentResponse: null,
            responseStartTime: null,
            interruptedAt: null,
            resumeAfterInterruption: false,
        };
    }
    /**
     * Handle potential interruption from user speaking
     * @param isInterim - Whether this is an interim transcript
     * @param transcript - The transcript text
     * @param speakerId - ID of the speaker (to distinguish from bot)
     * @returns Whether this is an interruption that should stop the bot
     */
    handlePotentialInterruption(isInterim, transcript, speakerId) {
        // Only handle interruptions if bot is currently speaking
        if (!this.botState.isSpeaking || !this.botState.currentResponse) {
            return false;
        }
        // Don't interrupt if it's the bot itself speaking
        if (speakerId && this.isBotSpeaker(speakerId)) {
            return false;
        }
        // Check if enough time has passed to allow interruption
        const speakingTime = Date.now() - (this.botState.responseStartTime || 0);
        if (speakingTime < this.INTERRUPTION_THRESHOLD_MS) {
            console.log(`⏳ Not interrupting - only ${speakingTime}ms of speaking`);
            return false;
        }
        // For interim transcripts, we detect the start of user speaking
        if (isInterim && transcript.trim()) {
            console.log("🛑 INTERRUPTION DETECTED - User started speaking");
            this.interruptBot();
            return true;
        }
        return false;
    }
    /**
     * Interrupt the bot's current response
     */
    interruptBot() {
        if (!this.botState.isSpeaking || !this.botState.currentResponse) {
            return;
        }
        const interruptedResponse = {
            text: this.botState.currentResponse,
            startTime: this.botState.responseStartTime || Date.now(),
            interruptedAt: Date.now(),
        };
        this.interruptedResponses.push(interruptedResponse);
        console.log("📚 Stored interrupted response:", interruptedResponse.text.substring(0, 50) + "...");
        // Update bot state
        this.botState.interruptedAt = Date.now();
        this.botState.isSpeaking = false;
        this.botState.resumeAfterInterruption = true;
    }
    /**
     * Check if we should resume an interrupted response or handle new input
     * @param newTranscript - The final transcript from user
     * @returns Object indicating what action to take
     */
    handleUserInput(newTranscript) {
        const normalizedTranscript = newTranscript.toLowerCase().trim();
        // If bot wasn't interrupted, handle normally
        if (!this.botState.resumeAfterInterruption) {
            return { action: "respond" };
        }
        // Check if user is asking a different question or giving new input
        if (this.isNewQuestion(normalizedTranscript)) {
            console.log("🔄 User asked new question, responding to that instead");
            this.clearInterruptedResponses();
            this.botState.resumeAfterInterruption = false;
            return { action: "respond" };
        }
        // Check if user wants to continue/resume
        if (this.isContinueSignal(normalizedTranscript)) {
            console.log("▶️ User wants to continue, resuming interrupted response");
            const resumeText = this.getResumeText();
            this.botState.resumeAfterInterruption = false;
            return {
                action: "resume",
                responseText: resumeText,
            };
        }
        // If it's just acknowledgment or brief response, resume automatically
        if (this.isBriefAcknowledgment(normalizedTranscript)) {
            console.log("⏭️ Brief acknowledgment detected, auto-resuming");
            const resumeText = this.getResumeText();
            this.botState.resumeAfterInterruption = false;
            return {
                action: "resume",
                responseText: resumeText,
            };
        }
        // Default: wait for more input
        console.log("⏸️ Waiting for user to indicate next action");
        return { action: "ignore" };
    }
    /**
     * Check if the transcript indicates a new question
     */
    isNewQuestion(transcript) {
        const questionWords = [
            "what",
            "how",
            "why",
            "where",
            "when",
            "who",
            "can you",
            "do you",
            "tell me",
        ];
        return questionWords.some((word) => transcript.includes(word));
    }
    /**
     * Check if the transcript indicates user wants to continue
     */
    isContinueSignal(transcript) {
        const continueSignals = [
            "continue",
            "go on",
            "keep going",
            "resume",
            "finish",
        ];
        return continueSignals.some((signal) => transcript.includes(signal));
    }
    /**
     * Check if the transcript is just a brief acknowledgment
     */
    isBriefAcknowledgment(transcript) {
        const briefResponses = [
            "ok",
            "okay",
            "yes",
            "sure",
            "right",
            "uh huh",
            "mm hmm",
            "yeah",
        ];
        return briefResponses.includes(transcript) || transcript.length < 10;
    }
    /**
     * Get text to resume from interrupted response
     */
    getResumeText() {
        if (this.interruptedResponses.length === 0) {
            return undefined;
        }
        const lastInterrupted = this.interruptedResponses[this.interruptedResponses.length - 1];
        // For now, just return a continuation message
        // In a more sophisticated system, you could try to resume from where it was cut off
        return "As I was saying... " + lastInterrupted.text;
    }
    /**
     * Clear stored interrupted responses
     */
    clearInterruptedResponses() {
        this.interruptedResponses = [];
    }
    /**
     * Check if speaker is the bot
     * @param speakerId - The speaker ID from the transcript
     */
    isBotSpeaker(speakerId) {
        if (!speakerId)
            return false;
        const lowerSpeakerId = speakerId.toLowerCase();
        // Common patterns for bot identification
        const botPatterns = [
            "bot",
            "assistant",
            "ai",
            "sherlocks",
            "recall-bot",
            "system",
        ];
        return botPatterns.some((pattern) => lowerSpeakerId.includes(pattern));
    }
    /**
     * Get current bot state (for debugging/monitoring)
     */
    getBotState() {
        return Object.assign({}, this.botState);
    }
    /**
     * Reset all state (useful for new conversations)
     */
    reset() {
        this.botState = {
            isSpeaking: false,
            currentResponse: null,
            responseStartTime: null,
            interruptedAt: null,
            resumeAfterInterruption: false,
        };
        this.interruptedResponses = [];
    }
}
// Export singleton instance
exports.interruptionHandler = new InterruptionHandler();
/**
 * TODO: Potential future enhancement - Direct audio stopping
 *
 * Currently, when an interruption is detected, we just mark the bot as interrupted
 * but the audio may continue playing until it naturally ends. To improve the user
 * experience, we could investigate if Recall AI provides an API to stop audio output
 * immediately when an interruption occurs.
 *
 * This might involve:
 * 1. A "stop audio" API endpoint
 * 2. Tracking active audio sessions/IDs
 * 3. Immediate audio cutoff capabilities
 *
 * For now, the system handles interruptions gracefully by managing conversation
 * state and resuming appropriately.
 */
