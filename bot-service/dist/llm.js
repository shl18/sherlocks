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
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
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
exports.askLLMWithRetries = askLLMWithRetries;
exports.shouldGenerateVideoScript = shouldGenerateVideoScript;
exports.generateIncidentVideoScript = generateIncidentVideoScript;
exports.isGreeting = isGreeting;
exports.generateGreetingResponse = generateGreetingResponse;
exports.generateIdentityResponse = generateIdentityResponse;
exports.generateShortAckResponse = generateShortAckResponse;
exports.generatePoliteClosingResponse = generatePoliteClosingResponse;
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
// -------- Streaming + rate-limit aware Chat Completions helper --------
function delay(ms) {
    return __awaiter(this, void 0, void 0, function* () {
        return new Promise((resolve) => setTimeout(resolve, ms));
    });
}
function chatCompletionStream(params_1) {
    return __awaiter(this, arguments, void 0, function* (params, attempts = 3) {
        var _a, e_1, _b, _c;
        var _d, _e, _f, _g, _h;
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
            try {
                const stream = yield openaiClient.chat.completions.create(Object.assign(Object.assign({}, params), { stream: true }));
                let text = "";
                try {
                    for (var _j = true, _k = (e_1 = void 0, __asyncValues(stream)), _l; _l = yield _k.next(), _a = _l.done, !_a; _j = true) {
                        _c = _l.value;
                        _j = false;
                        const chunk = _c;
                        const delta = (_f = (_e = (_d = chunk === null || chunk === void 0 ? void 0 : chunk.choices) === null || _d === void 0 ? void 0 : _d[0]) === null || _e === void 0 ? void 0 : _e.delta) === null || _f === void 0 ? void 0 : _f.content;
                        if (typeof delta === "string")
                            text += delta;
                    }
                }
                catch (e_1_1) { e_1 = { error: e_1_1 }; }
                finally {
                    try {
                        if (!_j && !_a && (_b = _k.return)) yield _b.call(_k);
                    }
                    finally { if (e_1) throw e_1.error; }
                }
                return (text === null || text === void 0 ? void 0 : text.trim()) || null;
            }
            catch (err) {
                const status = (err === null || err === void 0 ? void 0 : err.status) || ((_g = err === null || err === void 0 ? void 0 : err.response) === null || _g === void 0 ? void 0 : _g.status);
                if (status === 429 && attempt < attempts) {
                    const headers = (err === null || err === void 0 ? void 0 : err.headers) || ((_h = err === null || err === void 0 ? void 0 : err.response) === null || _h === void 0 ? void 0 : _h.headers) || {};
                    const retryAfterMs = Number(headers["retry-after-ms"]) || 250;
                    const backoff = retryAfterMs + attempt * 200;
                    console.warn(`⚠️ OpenAI rate limit (attempt ${attempt}/${attempts}). Retrying in ${backoff}ms...`);
                    yield delay(backoff);
                    continue;
                }
                console.error("❌ chatCompletionStream error:", err);
                return null;
            }
        }
        return null;
    });
}
// -------- JSON extraction helper (when model returns extra text) --------
function extractFirstJsonObject(text) {
    if (!text)
        return null;
    // Try to find the first well-formed top-level JSON object
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
        const candidate = text.slice(start, end + 1);
        try {
            JSON.parse(candidate);
            return candidate;
        }
        catch (_a) {
            // try to progressively shrink from the end
            for (let i = end; i > start; i--) {
                const c = text.slice(start, i);
                try {
                    JSON.parse(c);
                    return c;
                }
                catch (_b) {
                    /* keep trying */
                }
            }
        }
    }
    return null;
}
// Detects a structured RCA write-up with common section headings
function isStructuredRcaText(text) {
    const t = (text || "").toLowerCase();
    const markers = [
        "incident rca",
        "what all we checked",
        "what did not seem ok",
        "final conclusion",
        "deployment history",
        "database metrics",
        "service metrics",
    ];
    return markers.some((m) => t.includes(m));
}
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
    const gratitudePhrases = [
        "thank you",
        "thanks",
        "thank u",
        "thx",
        "ty",
        "appreciate it",
        "much appreciated",
        "thankyou",
        "thank you so much",
        "thanks so much",
    ];
    const closingPhrases = [
        "i am done",
        "i'm done",
        "done with it",
        "that's all",
        "thats all",
        "that's it",
        "thats it",
        "all good",
        "we are done",
        "we're done",
        "no further help",
        "nothing else",
        "you can leave",
        "you may leave",
        "bye",
        "goodbye",
        "see you",
    ];
    if (matchesAny(gratitudePhrases) || matchesAny(closingPhrases))
        return "closing";
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
            const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
            // Stream for rate-limit resilience
            const streamed = yield chatCompletionStream({
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
            if (streamed)
                return streamed;
            // Fallback non-streaming
            const completion = yield openaiClient.chat.completions.create({
                model,
                max_completion_tokens: 180,
                messages: [
                    { role: "system", content: system },
                    { role: "user", content: prompt },
                ],
            });
            return ((_d = (_c = (_b = (_a = completion.choices) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.message) === null || _c === void 0 ? void 0 : _c.content) === null || _d === void 0 ? void 0 : _d.trim()) || null;
        }
        catch (error) {
            console.error("❌ OpenAI askLLM error:", error);
            return null;
        }
    });
}
/**
 * Ask LLM with retries and alternate prompts to avoid empty responses.
 * Still 100% LLM-generated; no static text.
 */
function askLLMWithRetries(incidentText_1) {
    return __awaiter(this, arguments, void 0, function* (incidentText, wasInterrupted = false) {
        var _a, _b, _c, _d;
        // First attempt
        let reply = yield askLLM(incidentText, wasInterrupted);
        if (reply)
            return reply;
        // Second attempt: slightly stronger instruction appended to user content
        try {
            if (!process.env.OPENAI_API_KEY)
                return null;
            const prompt = (incidentText || "").trim();
            if (!prompt)
                return null;
            const system = "You are Sherlocks, an SRE-focused incident triage assistant. Provide a concrete, actionable triage reply in 2-4 sentences.";
            const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
            const streamed = yield chatCompletionStream({
                model,
                max_completion_tokens: 200,
                messages: [
                    { role: "system", content: system },
                    {
                        role: "user",
                        content: (wasInterrupted
                            ? `${prompt}\n\n[Prioritize this request (interruption)]\n`
                            : prompt) +
                            "\n\nRespond with specific likely cause(s) and next actions. Do not omit the answer.",
                    },
                ],
            });
            reply = streamed;
            if (!reply) {
                const completion = yield openaiClient.chat.completions.create({
                    model,
                    max_completion_tokens: 200,
                    messages: [
                        { role: "system", content: system },
                        { role: "user", content: prompt },
                    ],
                });
                reply = ((_d = (_c = (_b = (_a = completion.choices) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.message) === null || _c === void 0 ? void 0 : _c.content) === null || _d === void 0 ? void 0 : _d.trim()) || null;
            }
            if (reply)
                return reply;
        }
        catch (e) {
            console.error("❌ askLLMWithRetries second-attempt error:", e);
        }
        // Third attempt: derive a root-cause paragraph and use it directly
        try {
            const paragraph = yield generateRootCauseParagraph(incidentText);
            if (paragraph)
                return paragraph;
        }
        catch (e) {
            console.error("❌ askLLMWithRetries paragraph fallback error:", e);
        }
        return null;
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
        "rca",
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
        "postgresql",
        "replica",
        "environment",
        "investigation summary",
        "recommended actions",
        // DB / latency specific markers
        "postgres",
        "database",
        "pg_stat_activity",
        "slow query",
        "query execution",
        "max_connections",
        "latency",
        "p95",
        "active state",
    ];
    return markers.some((m) => t.includes(m));
}
/**
 * Generate a short narrated "Video Script" from raw incident/alert text.
 * The output is optimized for TTS and on-call review.
 */
function generateIncidentVideoScript(incidentText) {
    return __awaiter(this, void 0, void 0, function* () {
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
                "Keep under 220 words. Use present tense. No greetings or closings.",
            ].join("\n");
            const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
            let text = yield chatCompletionStream({
                model,
                max_completion_tokens: 280,
                messages: [
                    { role: "system", content: system },
                    { role: "user", content: prompt },
                ],
            });
            if (!text) {
                text = yield chatCompletionStream({
                    model,
                    max_completion_tokens: 320,
                    messages: [
                        { role: "system", content: system },
                        {
                            role: "user",
                            content: `${prompt}\n\nDo not omit the answer. Provide the full narrated script as requested.`,
                        },
                    ],
                });
            }
            return text || null;
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
 * Provide a polite closing/thanks response suitable for TTS.
 */
function generatePoliteClosingResponse() {
    return ("You're very welcome! If you need anything else later, just let me know. " +
        "Have a great day!");
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
            const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
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
function generateStructuredVideoScript(paragraph, incidentText) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        try {
            if (!process.env.OPENAI_API_KEY)
                return null;
            const content = paragraph === null || paragraph === void 0 ? void 0 : paragraph.trim();
            if (!content)
                return null;
            const system = [
                "You are a formatter that outputs ONLY strict JSON.",
                "Given incident context, produce a detailed video walkthrough script.",
                "Aim for 5-7 segments and total duration between 25-45 seconds to allow longer narration.",
                "Schema:",
                "{",
                '  "total_duration_ms": number,',
                '  "segments": [',
                '    { "id": string, "start_ms": number, "end_ms": number, "background_url": string, "narration": string }',
                "  ]",
                "}",
                "Constraints:",
                "- start_ms >= 0, end_ms > start_ms, segments are contiguous without gaps",
                "- narration should be rich and specific, sized to fit segment duration at ~12.5 chars/sec",
                "- background_url should be a path tag like /github, /jenkins, /datadog, /kubernetes, /rds, /redis, or /",
                "- If a custom full URL is required, use a valid https URL",
                "- DO NOT include any commentary, code fences, or text outside JSON",
            ].join("\n");
            const user = [
                "Root-cause paragraph:",
                content,
                incidentText ? "" : "",
                incidentText ? "Incident text:" : "",
                incidentText ? incidentText.trim() : "",
                "",
                "Background selection guidance:",
                "- logs/metrics: /datadog",
                "- deployments/builds: /jenkins",
                "- code/PRs: /github",
                "- kubernetes: /kubernetes",
                "- databases: /rds",
                "- caches/queues: /redis",
                "- default/home: /",
                "",
                "Narrative guidance:",
                "- Begin with the alert summary and time window",
                "- Explain observations and likely cause",
                "- Call out specific signals, dashboards, and changes tied to the context",
                "- Give actionable next steps and mitigation",
                "- Keep the narration continuous and easy to voice over",
            ].join("\n");
            const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
            let raw = yield chatCompletionStream({
                model,
                max_completion_tokens: 500,
                response_format: { type: "json_object" },
                messages: [
                    { role: "system", content: system },
                    { role: "user", content: user },
                ],
            });
            if (!raw)
                return null;
            // Some models may prepend/append text; try to extract JSON
            const jsonOnly = extractFirstJsonObject(raw) || raw;
            const parsed = JSON.parse(jsonOnly);
            // Basic validation
            if (!((_a = parsed === null || parsed === void 0 ? void 0 : parsed.segments) === null || _a === void 0 ? void 0 : _a.length) ||
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
 * Generate a structured video script directly from raw incident text.
 */
function generateStructuredVideoScriptFromIncident(incidentText) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        try {
            if (!process.env.OPENAI_API_KEY)
                return null;
            const content = incidentText === null || incidentText === void 0 ? void 0 : incidentText.trim();
            if (!content)
                return null;
            const system = [
                "You are a formatter that outputs ONLY strict JSON.",
                "Given an incident alert or investigation notes, produce a detailed video walkthrough script.",
                "Aim for 5-7 segments and total duration between 25-45 seconds to allow longer narration.",
                "Schema:",
                "{",
                '  "total_duration_ms": number,',
                '  "segments": [',
                '    { "id": string, "start_ms": number, "end_ms": number, "background_url": string, "narration": string }',
                "  ]",
                "}",
                "Constraints:",
                "- start_ms >= 0, end_ms > start_ms, segments are contiguous without gaps",
                "- narration should be rich and specific, sized to fit segment duration at ~12.5 chars/sec",
                "- background_url should be a path tag like /github, /jenkins, /datadog, /kubernetes, /rds, /redis, or /",
                "- If a custom full URL is required, use a valid https URL",
                "- DO NOT include any commentary, code fences, or text outside JSON",
            ].join("\n");
            const user = [
                "Incident text:",
                content,
                "",
                "Background selection guidance:",
                "- logs/metrics: /datadog",
                "- deployments/builds: /jenkins",
                "- code/PRs: /github",
                "- kubernetes: /kubernetes",
                "- databases: /rds",
                "- caches/queues: /redis",
                "- default/home: /",
                "",
                "Narrative guidance:",
                "- Begin with the alert summary and time window",
                "- Explain observations and likely cause",
                "- Call out specific signals, dashboards, and changes tied to the context",
                "- Give actionable next steps and mitigation",
                "- Keep the narration continuous and easy to voice over",
            ].join("\n");
            const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
            let raw = yield chatCompletionStream({
                model,
                max_completion_tokens: 700,
                response_format: { type: "json_object" },
                messages: [
                    { role: "system", content: system },
                    { role: "user", content: user },
                ],
            });
            if (!raw)
                return null;
            const jsonOnly = extractFirstJsonObject(raw) || raw;
            const parsed = JSON.parse(jsonOnly);
            if (!((_a = parsed === null || parsed === void 0 ? void 0 : parsed.segments) === null || _a === void 0 ? void 0 : _a.length) ||
                typeof parsed.total_duration_ms !== "number") {
                return null;
            }
            return parsed;
        }
        catch (error) {
            console.error("❌ generateStructuredVideoScriptFromIncident error:", error);
            return null;
        }
    });
}
/**
 * Convert an unstructured narrated "Video Script" text into structured segments via LLM.
 */
function convertNarratedScriptTextToStructured(videoScriptText) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        try {
            if (!process.env.OPENAI_API_KEY)
                return null;
            const content = videoScriptText === null || videoScriptText === void 0 ? void 0 : videoScriptText.trim();
            if (!content)
                return null;
            const system = [
                "You are a formatter that outputs ONLY strict JSON.",
                "You will receive a narrated incident walkthrough as plain text.",
                "Segment it into 5-7 coherent parts with timings and return JSON.",
                "Schema:",
                "{",
                '  "total_duration_ms": number,',
                '  "segments": [',
                '    { "id": string, "start_ms": number, "end_ms": number, "background_url": string, "narration": string }',
                "  ]",
                "}",
                "Constraints:",
                "- Total duration 25,000-45,000 ms",
                "- Segments contiguous, no gaps; start at 0 ms",
                "- Estimate timings using ~12.5 chars/sec for narration length",
                "- Choose background_url tags from /datadog, /jenkins, /github, /kubernetes, /rds, /redis, /",
                "- DO NOT include any commentary, code fences, or text outside JSON",
            ].join("\n");
            const user = ["Narrated script text:", content].join("\n\n");
            const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
            let raw = yield chatCompletionStream({
                model,
                max_completion_tokens: 800,
                response_format: { type: "json_object" },
                messages: [
                    { role: "system", content: system },
                    { role: "user", content: user },
                ],
            });
            if (!raw)
                return null;
            const jsonOnly = extractFirstJsonObject(raw) || raw;
            const parsed = JSON.parse(jsonOnly);
            if (!((_a = parsed === null || parsed === void 0 ? void 0 : parsed.segments) === null || _a === void 0 ? void 0 : _a.length) ||
                typeof parsed.total_duration_ms !== "number") {
                return null;
            }
            return parsed;
        }
        catch (error) {
            console.error("❌ convertNarratedScriptTextToStructured error:", error);
            return null;
        }
    });
}
/**
 * High-level pipeline: incident text → root cause paragraph → structured video script.
 */
function runIncidentVideoScriptPipeline(incidentText) {
    return __awaiter(this, void 0, void 0, function* () {
        // If the user pasted a structured RCA, generate the script directly from it
        if (isStructuredRcaText(incidentText)) {
            const directScript = yield generateStructuredVideoScriptFromIncident(incidentText);
            if (directScript) {
                // Create a short paragraph summary to return alongside the script
                const paragraph = (yield generateRootCauseParagraph(incidentText)) ||
                    "Narrated walkthrough based on the provided structured incident RCA.";
                return { paragraph, script: directScript };
            }
        }
        let paragraph = yield generateRootCauseParagraph(incidentText);
        if (!paragraph) {
            // Fallback heuristic paragraph
            const snippet = incidentText.trim().slice(0, 240).replace(/\s+/g, " ");
            paragraph =
                "Likely CPU saturation in the reported service aligned with the alert window. " +
                    "Mitigate by scaling replicas, profiling hot paths, and reviewing the most recent deployment. Context: " +
                    snippet;
        }
        let script = yield generateStructuredVideoScript(paragraph, incidentText);
        if (!script) {
            // Retry by generating from the raw incident text directly
            script = yield generateStructuredVideoScriptFromIncident(incidentText);
        }
        if (!script) {
            // Fallback to unstructured narrated script, then convert to structured
            const narrated = yield generateIncidentVideoScript(incidentText);
            if (narrated) {
                script = yield convertNarratedScriptTextToStructured(narrated);
            }
        }
        if (!script) {
            // Give up on structured playback; caller will use unstructured narration
            return null;
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
                "gpt-4o-mini";
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
                model: "aura-2-hermes-en",
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
