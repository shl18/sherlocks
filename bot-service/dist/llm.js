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
exports.getIntentForText = getIntentForText;
exports.isBotSpeaking = isBotSpeaking;
exports.startBotSpeaking = startBotSpeaking;
exports.stopBotSpeaking = stopBotSpeaking;
exports.clearSpeechQueue = clearSpeechQueue;
exports.isBotProcessing = isBotProcessing;
exports.setBotProcessing = setBotProcessing;
exports.handleInterruption = handleInterruption;
exports.getRemainingSpeechDuration = getRemainingSpeechDuration;
exports.forceResetBotState = forceResetBotState;
exports.askLLM = askLLM;
exports.shouldGenerateVideoScript = shouldGenerateVideoScript;
exports.generateIncidentVideoScript = generateIncidentVideoScript;
exports.isGreeting = isGreeting;
exports.generateGreetingResponse = generateGreetingResponse;
exports.generateIdentityResponse = generateIdentityResponse;
exports.generateShortAckResponse = generateShortAckResponse;
exports.generateRootCauseParagraph = generateRootCauseParagraph;
exports.generateStructuredVideoScript = generateStructuredVideoScript;
exports.runIncidentVideoScriptPipeline = runIncidentVideoScriptPipeline;
exports.summarizeFromImageBase64 = summarizeFromImageBase64;
exports.textToSpeech = textToSpeech;
const sdk_1 = require("@deepgram/sdk");
const openai_1 = __importDefault(require("openai"));
const fluent_ffmpeg_1 = __importDefault(require("fluent-ffmpeg"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const openaiClient = new openai_1.default({ apiKey: process.env.OPENAI_API_KEY });
const deepgramClient = (0, sdk_1.createClient)(process.env.DEEPGRAM_API_KEY);
const conversationContext = {
    recentIntents: [],
    lastResponseTime: 0,
};
const botState = {
    isSpeaking: false,
    currentSpeechId: null,
    speechStartTime: null,
    estimatedSpeechDuration: null,
    speechQueue: [],
    isProcessing: false,
    lastSpeechText: null,
};
const MAX_INTENT_HISTORY = 5;
const MIN_RESPONSE_INTERVAL = 2000;
const SAME_INTENT_COOLDOWN = 6000;
// Average speaking rate: ~150 words per minute (2.5 words per second)
// Average word length: ~5 characters, so roughly 12.5 characters per second
const CHARACTERS_PER_SECOND = 12.5;
function normalizeForIntent(input) {
    // Lowercase, strip punctuation, collapse excessive repeated letters, compact spaces
    const lower = input.toLowerCase();
    const noPunct = lower.replace(/[^a-z0-9\s]/g, " ");
    const collapseRepeats = noPunct.replace(/(.)\1{2,}/g, "$1$1"); // e.g., helllo -> hello
    const compact = collapseRepeats.replace(/\s+/g, " ").trim();
    return compact;
}
function detectIntent(normalizedTranscript) {
    const text = normalizeForIntent(normalizedTranscript);
    const matchesAny = (patterns) => {
        return patterns.some((p) => {
            const escaped = p.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
            const regex = new RegExp(`\\b${escaped}\\b`, "i");
            return regex.test(text);
        });
    };
    const greetingPhrases = [
        "hello",
        "hi",
        "hey",
        "hey sai",
        "hello all",
        "hi all",
        "hey all",
        "hello everyone",
        "hey everyone",
        "good morning",
        "good afternoon",
        "good evening",
        "how are you doing",
        "whats up",
    ];
    if (matchesAny(greetingPhrases))
        return "greeting";
    const helpPhrases = [
        "help me",
        "i need help",
        "can you help",
        "help with",
        "need assistance",
        "assist me",
        "i need assistance",
    ];
    if (matchesAny(helpPhrases))
        return "help";
    const identityPhrases = [
        "who are you",
        "what u do",
        "what do you do",
        "what you do",
        "what are you",
        "what is this",
        "tell me about yourself",
        "introduce yourself",
    ];
    if (matchesAny(identityPhrases))
        return "identity";
    const shortAckWords = ["yes", "ok", "sure", "thanks", "bye"];
    if (matchesAny(shortAckWords))
        return "short";
    return null;
}
/**
 * Public helper to get coarse intent from raw text
 */
function getIntentForText(text) {
    const normalized = normalizeForIntent(text || "");
    return detectIntent(normalized);
}
//Check if we should respond based on conversation context
function shouldRespond(intent) {
    const now = Date.now();
    // Check if enough time has passed since last response (minimum interval)
    if (now - conversationContext.lastResponseTime < MIN_RESPONSE_INTERVAL) {
        console.log("🔇 Skipping response - too soon after last response");
        return false;
    }
    // Check if this intent was the most recent one
    const lastIntent = conversationContext.recentIntents[conversationContext.recentIntents.length - 1];
    if (lastIntent === intent) {
        // Same intent - check if enough time has passed for repeat
        const timeSinceLastResponse = now - conversationContext.lastResponseTime;
        if (timeSinceLastResponse < SAME_INTENT_COOLDOWN) {
            console.log(`🔇 Skipping response - same intent "${intent}" within ${SAME_INTENT_COOLDOWN / 1000}s cooldown`);
            return false;
        }
        else {
            console.log(`✅ Allowing repeat response - same intent "${intent}" after ${timeSinceLastResponse / 1000}s`);
        }
    }
    return true;
}
/**
 * Update conversation context with new intent
 */
function updateConversationContext(intent) {
    conversationContext.recentIntents.push(intent);
    // Keep only the most recent intents
    if (conversationContext.recentIntents.length > MAX_INTENT_HISTORY) {
        conversationContext.recentIntents = conversationContext.recentIntents.slice(-MAX_INTENT_HISTORY);
    }
    conversationContext.lastResponseTime = Date.now();
    console.log("Updated conversation context. Recent intents:", conversationContext.recentIntents);
}
/**
 * Estimate speech duration based on text length
 */
function estimateSpeechDuration(text) {
    return Math.ceil((text.length / CHARACTERS_PER_SECOND) * 1000); // in milliseconds
}
/**
 * Check if bot is currently speaking
 */
function isBotSpeaking() {
    if (!botState.isSpeaking)
        return false;
    // Check if estimated speech time has passed
    if (botState.speechStartTime && botState.estimatedSpeechDuration) {
        const elapsed = Date.now() - botState.speechStartTime;
        if (elapsed > botState.estimatedSpeechDuration) {
            // Speech should have finished, update state
            stopBotSpeaking();
            return false;
        }
    }
    return true;
}
/**
 * Mark bot as speaking
 */
function startBotSpeaking(speechId, text) {
    const duration = estimateSpeechDuration(text);
    botState.isSpeaking = true;
    botState.currentSpeechId = speechId;
    botState.speechStartTime = Date.now();
    botState.estimatedSpeechDuration = duration;
    botState.lastSpeechText = text;
    console.log(`🗣️ Bot started speaking (ID: ${speechId}, estimated duration: ${duration}ms)`);
    // Auto-stop after estimated duration + buffer
    setTimeout(() => {
        if (botState.currentSpeechId === speechId) {
            stopBotSpeaking();
        }
    }, duration + 1000); // Add 1 second buffer
}
/**
 * Mark bot as stopped speaking
 */
function stopBotSpeaking() {
    if (botState.isSpeaking) {
        console.log(`🔇 Bot stopped speaking (was ID: ${botState.currentSpeechId})`);
    }
    botState.isSpeaking = false;
    botState.currentSpeechId = null;
    botState.speechStartTime = null;
    botState.estimatedSpeechDuration = null;
    botState.lastSpeechText = null;
}
/**
 * Clear speech queue when interrupted
 */
function clearSpeechQueue() {
    if (botState.speechQueue.length > 0) {
        console.log(`🗑️ Clearing speech queue (${botState.speechQueue.length} items)`);
        botState.speechQueue = [];
    }
}
/**
 * Check if bot is currently processing a request
 */
function isBotProcessing() {
    return botState.isProcessing;
}
/**
 * Set bot processing state
 */
function setBotProcessing(processing) {
    botState.isProcessing = processing;
    if (processing) {
        console.log("🔄 Bot started processing request");
    }
    else {
        console.log("✅ Bot finished processing request");
    }
}
/**
 * Handle interruption when user speaks while bot is talking
 */
function handleInterruption(newTranscript) {
    if (isBotSpeaking() || isBotProcessing()) {
        console.log(`🚫 INTERRUPTION DETECTED! User said: "${newTranscript}"`);
        if (isBotSpeaking()) {
            console.log(`🔇 Stopping bot speech (ID: ${botState.currentSpeechId})`);
            stopBotSpeaking();
        }
        if (isBotProcessing()) {
            console.log("⏹️ Bot was processing - marking as interrupted");
        }
        // Clear any queued speech
        clearSpeechQueue();
        // Reset processing state
        setBotProcessing(false);
        return true;
    }
    return false;
}
/**
 * Get remaining speech duration for the current speech
 */
function getRemainingSpeechDuration() {
    if (!botState.isSpeaking ||
        !botState.speechStartTime ||
        !botState.estimatedSpeechDuration) {
        return 0;
    }
    const elapsed = Date.now() - botState.speechStartTime;
    const remaining = Math.max(0, botState.estimatedSpeechDuration - elapsed);
    return remaining;
}
/**
 * Force reset all bot states (for external interruption handling)
 */
function forceResetBotState() {
    console.log("🔄 Force resetting all bot states");
    stopBotSpeaking();
    clearSpeechQueue();
    setBotProcessing(false);
}
// export async function askDummyLLM(
//   transcript: string,
//   wasInterrupted: boolean = false
// ): Promise<string | null> {
//   const normalizedTranscript = transcript.toLowerCase().trim();
//   console.log("🎧 Processing transcript:", transcript);
//   if (wasInterrupted) {
//     console.log("🚫 Processing interrupted transcript - bypassing cooldowns");
//   }
//   const intent = detectIntent(normalizedTranscript);
//   if (!intent) {
//     console.log("No intent detected for this transcript");
//     return null;
//   }
//   console.log("Detected intent:", intent);
//   // Skip cooldown checks if this was an interruption
//   if (!wasInterrupted && !shouldRespond(intent)) {
//     return null;
//   }
//   let reply: string | null = null;
//   switch (intent) {
//     case "greeting":
//       // Big reply
//       reply =
//         "Hello there! It’s an absolute pleasure to meet you today. My name is Sherlocks — your friendly, ever-curious, and always-ready AI assistant. Think of me as your knowledgeable companion, your brainstorming buddy, and your tireless problem-solver, all wrapped into one.  I hope your day has been nothing short of amazing so far, and if it hasn’t, well… maybe I can help turn it around. Whether you’re here to explore ideas, unravel mysteries, learn something new, get help with a tricky problem, or simply enjoy a good conversation, I’m ready and eager to dive right in with you. \n\n From answering your questions with precision and clarity, to offering a spark of inspiration when you need it most, my goal is simple: to make your life easier, brighter, and a little more interesting every time we interact.";
//       break;
//     case "identity":
//       // Medium reply
//       reply =
//         "I'm Sherlocks, an AI bot designed to help you with various questions and tasks. I can assist with information, have conversations, and try to be helpful in whatever way you need.";
//       break;
//     case "short":
//       // Small reply
//       reply = "Got it!";
//       break;
//     default:
//       console.log("No response defined for intent:", intent);
//       return null;
//   }
//   if (reply) {
//     updateConversationContext(intent);
//     console.log("LLM Response:", reply);
//     return reply;
//   }
//   return null;
// }
function askLLM(transcript_1) {
    return __awaiter(this, arguments, void 0, function* (transcript, wasInterrupted = false) {
        var _a, _b, _c, _d;
        try {
            if (!process.env.OPENAI_API_KEY) {
                console.error("❌ OPENAI_API_KEY is not set. Skipping askLLM.");
                return null;
            }
            const prompt = transcript === null || transcript === void 0 ? void 0 : transcript.trim();
            if (!prompt)
                return null;
            const system = "You are Sherlocks, an SRE-focused incident triage assistant. Your job is to quickly identify likely root causes, impacted components, and immediate mitigations from short snippets of context. Be concise (1-3 sentences), action-oriented, and specific. Prefer concrete next steps (dashboards, logs to check, feature flags, rollbacks) over generic advice. If interrupted, prioritize the newest message.";
            const model = process.env.OPENAI_MODEL || "gpt-5-mini-2025-08-07";
            // Prefer the lightweight responses for latency
            const completion = yield openaiClient.chat.completions.create({
                model,
                max_completion_tokens: 180,
                messages: [
                    { role: "system", content: system },
                    {
                        role: "user",
                        content: wasInterrupted
                            ? `${prompt}\n\n[Note: This came after an interruption; prioritize this request.]`
                            : prompt,
                    },
                ],
            });
            const text = (_d = (_c = (_b = (_a = completion.choices) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.message) === null || _c === void 0 ? void 0 : _c.content) === null || _d === void 0 ? void 0 : _d.trim();
            if (!text)
                return null;
            return text;
        }
        catch (error) {
            console.error("❌ OpenAI askLLM error:", error);
            return null;
        }
    });
}
/**
 * Detect whether the provided text looks like an incident/alert payload
 * and should be reformatted into a narrated "Video Script" summary.
 */
function shouldGenerateVideoScript(text) {
    const t = (text || "").toLowerCase();
    if (!t)
        return false;
    const markers = [
        "video script",
        "alert",
        "critical",
        "5xx",
        "runbook",
        "datadog",
        "kubectl",
        "pod ",
        "pods ",
        "deployment",
        "commit",
        "jenkins",
        "load average",
        "rds",
        "replica",
        "environment",
        "investigation summary",
        "recommended actions",
    ];
    return markers.some((m) => t.includes(m));
}
/**
 * Generate a short narrated "Video Script" from raw incident/alert text.
 * The output is optimized for TTS and on-call review.
 */
function generateIncidentVideoScript(incidentText) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        try {
            if (!process.env.OPENAI_API_KEY) {
                console.error("❌ OPENAI_API_KEY is not set. Skipping generateIncidentVideoScript.");
                return null;
            }
            const prompt = incidentText === null || incidentText === void 0 ? void 0 : incidentText.trim();
            if (!prompt)
                return null;
            const system = [
                "You are Sherlocks, an SRE incident narrator.",
                "Given raw incident notes/alerts, write a concise 'Video Script' for a voiceover.",
                "Output ONLY the script in this structure:",
                "",
                "Video Script",
                "",
                "\tAlert : <one-line alert headline>",
                "",
                "\tAnswer:",
                "\t<2-4 short paragraphs with: observation, likely cause, and immediate actions>",
                "\tInclude inline square-bracket callouts that name sources from the input, e.g.",
                "\t[ errors are increasing since 10:30pm (Datadog) ]",
                "\t[ kubectl top shows high CPU in dostt pods (Kubernetes) ]",
                "\t[ last deployment at 10:25pm (Jenkins) ]",
                "\t[ suspect change around line 121 (GitHub) ]",
                "",
                "At the end, add 3-5 bullets listing sources checked or to check next.",
                "When details are missing, infer cautiously and mark as 'likely'.",
                "Keep under 180 words. Use present tense. No greetings or closings.",
            ].join("\n");
            const model = process.env.OPENAI_MODEL || "gpt-5-mini-2025-08-07";
            const completion = yield openaiClient.chat.completions.create({
                model,
                max_completion_tokens: 280,
                messages: [
                    { role: "system", content: system },
                    { role: "user", content: prompt },
                ],
            });
            const text = (_d = (_c = (_b = (_a = completion.choices) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.message) === null || _c === void 0 ? void 0 : _c.content) === null || _d === void 0 ? void 0 : _d.trim();
            if (!text)
                return null;
            return text;
        }
        catch (error) {
            console.error("❌ OpenAI generateIncidentVideoScript error:", error);
            return null;
        }
    });
}
/**
 * Return true if the text is a greeting (hello/hi/etc.) or help request
 */
function isGreeting(text) {
    const normalized = normalizeForIntent(text || "");
    const intent = detectIntent(normalized);
    return intent === "greeting" || intent === "help";
}
/**
 * Provide a warm, concise greeting or help response suitable for TTS.
 */
function generateGreetingResponse(text) {
    const normalized = normalizeForIntent(text || "");
    const intent = detectIntent(normalized);
    if (intent === "help") {
        return ("I'm here to help! I can analyze incidents, debug issues, and provide guidance. " +
            "You can share your screen by saying 'look at my screen', paste error logs, " +
            "or just describe what's happening. What do you need assistance with?");
    }
    return ("Hello there! It's wonderful to meet you. I'm Sherlocks — your friendly AI " +
        "assistant. I'm here to help with incident triage, debugging, and anything " +
        "else you need. Just tell me what's going on, and we'll tackle it together.");
}
/**
 * Provide a concise identity description suitable for TTS.
 */
function generateIdentityResponse() {
    return ("I'm Sherlocks — an SRE-focused assistant. I quickly triage incidents, " +
        "summarize errors, and suggest next actions like dashboards, logs, and rollbacks. " +
        "Tell me what you're seeing, or share your screen, and I'll help you debug.");
}
/**
 * Short acknowledgement for brief inputs
 */
function generateShortAckResponse() {
    return "Got it!";
}
/**
 * Generate a concise root-cause paragraph from raw incident alert text.
 */
function generateRootCauseParagraph(incidentText) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        try {
            if (!process.env.OPENAI_API_KEY)
                return null;
            const prompt = incidentText === null || incidentText === void 0 ? void 0 : incidentText.trim();
            if (!prompt)
                return null;
            const system = [
                "You are Sherlocks, an SRE root-cause summarizer.",
                "Given alert text and notes, produce ONE concise paragraph (2-4 sentences)",
                "with likely root cause, impacted components, and immediate mitigation.",
                "Avoid bullet points. Keep under 80 words.",
            ].join("\n");
            const model = process.env.OPENAI_MODEL || "gpt-5-mini-2025-08-07";
            const completion = yield openaiClient.chat.completions.create({
                model,
                max_completion_tokens: 160,
                messages: [
                    { role: "system", content: system },
                    { role: "user", content: prompt },
                ],
            });
            const text = (_d = (_c = (_b = (_a = completion.choices) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.message) === null || _c === void 0 ? void 0 : _c.content) === null || _d === void 0 ? void 0 : _d.trim();
            return text || null;
        }
        catch (error) {
            console.error("❌ OpenAI generateRootCauseParagraph error:", error);
            return null;
        }
    });
}
/**
 * Convert a paragraph into a structured video script JSON.
 * The model MUST return strict JSON matching the VideoScript type.
 */
function generateStructuredVideoScript(paragraph) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e;
        try {
            if (!process.env.OPENAI_API_KEY)
                return null;
            const content = paragraph === null || paragraph === void 0 ? void 0 : paragraph.trim();
            if (!content)
                return null;
            const system = [
                "You are a formatter that outputs ONLY strict JSON.",
                "Given a short paragraph describing an incident's root cause,",
                "produce a concise video script with 3-5 segments and total duration 10-20 seconds.",
                "Schema:",
                "{",
                '  "total_duration_ms": number,',
                '  "segments": [',
                '    { "id": string, "start_ms": number, "end_ms": number, "background_url": string, "narration": string }',
                "  ]",
                "}",
                "Constraints:",
                "- start_ms >= 0, end_ms > start_ms, segments are contiguous without gaps",
                "- narration is sized to fit the segment duration at ~12.5 chars/sec",
                "- background_url should be a path tag like /github, /jenkins, /datadog, or /",
                "- If a custom full URL is required, use a valid https URL",
                "- DO NOT include any commentary, code fences, or text outside JSON",
            ].join("\n");
            const user = [
                "Paragraph:",
                content,
                "",
                "Background selection guidance:",
                "- logs/metrics: /datadog",
                "- deployments/builds: /jenkins",
                "- code/PRs: /github",
                "- default/home: /",
            ].join("\n");
            const model = process.env.OPENAI_MODEL || "gpt-5-mini-2025-08-07";
            const completion = yield openaiClient.chat.completions.create({
                model,
                max_completion_tokens: 500,
                response_format: { type: "json_object" },
                messages: [
                    { role: "system", content: system },
                    { role: "user", content: user },
                ],
            });
            const raw = (_d = (_c = (_b = (_a = completion.choices) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.message) === null || _c === void 0 ? void 0 : _c.content) === null || _d === void 0 ? void 0 : _d.trim();
            if (!raw)
                return null;
            const parsed = JSON.parse(raw);
            // Basic validation
            if (!((_e = parsed === null || parsed === void 0 ? void 0 : parsed.segments) === null || _e === void 0 ? void 0 : _e.length) ||
                typeof parsed.total_duration_ms !== "number") {
                return null;
            }
            return parsed;
        }
        catch (error) {
            console.error("❌ OpenAI generateStructuredVideoScript error:", error);
            return null;
        }
    });
}
/**
 * High-level pipeline: incident text → root cause paragraph → structured video script.
 */
function runIncidentVideoScriptPipeline(incidentText) {
    return __awaiter(this, void 0, void 0, function* () {
        let paragraph = yield generateRootCauseParagraph(incidentText);
        if (!paragraph) {
            // Fallback heuristic paragraph
            const snippet = incidentText.trim().slice(0, 240).replace(/\s+/g, " ");
            paragraph =
                "Likely CPU saturation in the reported service aligned with the alert window. " +
                    "Mitigate by scaling replicas, profiling hot paths, and reviewing the most recent deployment. Context: " +
                    snippet;
        }
        let script = yield generateStructuredVideoScript(paragraph);
        if (!script) {
            // Fallback heuristic script
            const segments = [
                {
                    id: "intro",
                    start_ms: 0,
                    end_ms: 4000,
                    background_url: "/datadog",
                    narration: "Critical incident detected. Metrics indicate sustained resource pressure around the alert window.",
                },
                {
                    id: "deploy",
                    start_ms: 4000,
                    end_ms: 8000,
                    background_url: "/jenkins",
                    narration: "Check the most recent deployment near the alert time for CPU heavy changes and roll back if needed.",
                },
                {
                    id: "code",
                    start_ms: 8000,
                    end_ms: 12000,
                    background_url: "/github",
                    narration: "Review the latest commit and related PRs. Profile hot endpoints and reduce compute hotspots.",
                },
            ];
            script = { total_duration_ms: 12000, segments };
        }
        return { paragraph, script };
    });
}
/**
 * OCR-like extraction using OpenAI vision: summarize on-screen errors/logs.
 * Input is a PNG/JPEG base64 string without data URL prefix.
 */
function summarizeFromImageBase64(base64Image) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        try {
            if (!process.env.OPENAI_API_KEY)
                return null;
            const b64 = base64Image === null || base64Image === void 0 ? void 0 : base64Image.trim();
            if (!b64)
                return null;
            // Use Chat Completions with image input (o4-mini or gpt-4o-mini)
            const model = process.env.OPENAI_VISION_MODEL ||
                process.env.OPENAI_MODEL ||
                "gpt-5-mini-2025-08-07";
            const system = "You are Sherlocks. Extract key error messages, stack traces, metrics, and service names from the screenshot. Return a concise paragraph (<=80 words) suitable for incident triage.";
            const messages = [
                { role: "system", content: system },
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: "Analyze this screen and summarize the likely issue and what to check next.",
                        },
                        {
                            type: "image_url",
                            image_url: {
                                url: `data:image/png;base64,${b64}`,
                            },
                        },
                    ],
                },
            ];
            const completion = yield openaiClient.chat.completions.create({
                model,
                max_completion_tokens: 160,
                messages,
            });
            const text = (_d = (_c = (_b = (_a = completion.choices) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.message) === null || _c === void 0 ? void 0 : _c.content) === null || _d === void 0 ? void 0 : _d.trim();
            return text || null;
        }
        catch (error) {
            console.error("❌ summarizeFromImageBase64 error:", error);
            return null;
        }
    });
}
/**
 * Convert text to speech using Deepgram TTS API and convert to MP3
 * @param text - The text to convert to speech
 * @returns MP3 audio buffer containing the generated speech
 */
function textToSpeech(text) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            console.log("🔊 Converting text to speech:", text);
            // Make TTS request to Deepgram (generate WAV)
            const response = yield deepgramClient.speak.request({ text }, {
                model: "aura-2-thalia-en",
                encoding: "linear16",
                container: "wav",
                sample_rate: 16000,
            });
            const stream = yield response.getStream();
            if (stream) {
                const wavBuffer = yield getAudioBuffer(stream);
                const mp3Buffer = yield convertWavToMp3(wavBuffer);
                if (mp3Buffer) {
                    return mp3Buffer;
                }
                else {
                    console.error("Failed to convert WAV to MP3");
                    return null;
                }
            }
            else {
                console.error(" Failed to get audio stream from Deepgram TTS");
                return null;
            }
        }
        catch (error) {
            console.error("Text-to-speech error:", error);
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
/**
 * Convert WAV buffer to MP3 buffer using streaming ffmpeg (much faster - no temp files!)
 * @param wavBuffer - The WAV audio buffer to convert
 * @returns MP3 audio buffer
 */
function convertWavToMp3(wavBuffer) {
    return __awaiter(this, void 0, void 0, function* () {
        return new Promise((resolve) => {
            try {
                console.log("🎵 Starting streaming WAV→MP3 conversion...");
                const startTime = Date.now();
                const mp3Chunks = [];
                const { Readable, PassThrough } = require("stream");
                const inputStream = new Readable();
                inputStream.push(wavBuffer);
                inputStream.push(null);
                const outputStream = new PassThrough();
                const command = (0, fluent_ffmpeg_1.default)(inputStream)
                    .inputFormat("wav")
                    .audioCodec("libmp3lame")
                    .audioBitrate(64)
                    .audioFrequency(16000)
                    .format("mp3")
                    .on("start", (commandLine) => {
                    console.log("🔄 FFmpeg streaming command:", commandLine.substring(0, 100) + "...");
                })
                    .on("end", () => {
                    const duration = Date.now() - startTime;
                    console.log(`✅ Streaming conversion complete in ${duration}ms`);
                    const finalMp3Buffer = Buffer.concat(mp3Chunks);
                    console.log(`🎵 MP3 buffer size: ${finalMp3Buffer.length} bytes`);
                    resolve(finalMp3Buffer);
                })
                    .on("error", (error) => {
                    console.error("❌ Streaming FFmpeg error:", error);
                    resolve(null);
                });
                outputStream.on("data", (chunk) => {
                    mp3Chunks.push(chunk);
                });
                outputStream.on("error", (error) => {
                    console.error("❌ Output stream error:", error);
                    resolve(null);
                });
                command.pipe(outputStream, { end: true });
            }
            catch (error) {
                console.error("❌ Streaming conversion setup error:", error);
                resolve(null);
            }
        });
    });
}
