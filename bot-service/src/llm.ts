import { createClient } from "@deepgram/sdk";
import OpenAI from "openai";
import ffmpeg from "fluent-ffmpeg";
import dotenv from "dotenv";

dotenv.config();

const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const deepgramClient = createClient(process.env.DEEPGRAM_API_KEY);

interface ConversationContext {
  recentIntents: string[];
  lastResponseTime: number;
}

// ===== Video Script Types =====
export type VideoScriptSegment = {
  id: string;
  start_ms: number; // inclusive
  end_ms: number; // exclusive
  background_url: string;
  narration: string;
};

export type VideoScript = {
  total_duration_ms: number;
  segments: VideoScriptSegment[];
};

interface BotState {
  isSpeaking: boolean;
  currentSpeechId: string | null;
  speechStartTime: number | null;
  estimatedSpeechDuration: number | null;
  speechQueue: string[];
  isProcessing: boolean;
  lastSpeechText: string | null;
}

const conversationContext: ConversationContext = {
  recentIntents: [],
  lastResponseTime: 0,
};

const botState: BotState = {
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

// -------- JSON extraction helper (when model returns extra text) --------
function extractFirstJsonObject(
  text: string | undefined | null
): string | null {
  if (!text) return null;
  // Try to find the first well-formed top-level JSON object
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const candidate = text.slice(start, end + 1);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // try to progressively shrink from the end
      for (let i = end; i > start; i--) {
        const c = text.slice(start, i);
        try {
          JSON.parse(c);
          return c;
        } catch {
          /* keep trying */
        }
      }
    }
  }
  return null;
}

// Detects a structured RCA write-up with common section headings
function isStructuredRcaText(text: string): boolean {
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

function normalizeForIntent(input: string): string {
  // Lowercase, strip punctuation, collapse excessive repeated letters, compact spaces
  const lower = input.toLowerCase();
  const noPunct = lower.replace(/[^a-z0-9\s]/g, " ");
  const collapseRepeats = noPunct.replace(/(.)\1{2,}/g, "$1$1"); // e.g., helllo -> hello
  const compact = collapseRepeats.replace(/\s+/g, " ").trim();
  return compact;
}

function detectIntent(normalizedTranscript: string): string | null {
  const text = normalizeForIntent(normalizedTranscript);

  const matchesAny = (patterns: string[]): boolean => {
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
  if (matchesAny(greetingPhrases)) return "greeting";

  const helpPhrases = [
    "help me",
    "i need help",
    "can you help",
    "help with",
    "need assistance",
    "assist me",
    "i need assistance",
  ];
  if (matchesAny(helpPhrases)) return "help";

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
  if (matchesAny(identityPhrases)) return "identity";

  const shortAckWords = ["yes", "ok", "sure", "thanks", "bye"];
  if (matchesAny(shortAckWords)) return "short";

  return null;
}

/**
 * Public helper to get coarse intent from raw text
 */
export function getIntentForText(text: string): string | null {
  const normalized = normalizeForIntent(text || "");
  return detectIntent(normalized);
}

//Check if we should respond based on conversation context
function shouldRespond(intent: string): boolean {
  const now = Date.now();

  // Check if enough time has passed since last response (minimum interval)
  if (now - conversationContext.lastResponseTime < MIN_RESPONSE_INTERVAL) {
    console.log("🔇 Skipping response - too soon after last response");
    return false;
  }

  // Check if this intent was the most recent one
  const lastIntent =
    conversationContext.recentIntents[
      conversationContext.recentIntents.length - 1
    ];

  if (lastIntent === intent) {
    // Same intent - check if enough time has passed for repeat
    const timeSinceLastResponse = now - conversationContext.lastResponseTime;
    if (timeSinceLastResponse < SAME_INTENT_COOLDOWN) {
      console.log(
        `🔇 Skipping response - same intent "${intent}" within ${
          SAME_INTENT_COOLDOWN / 1000
        }s cooldown`
      );
      return false;
    } else {
      console.log(
        `✅ Allowing repeat response - same intent "${intent}" after ${
          timeSinceLastResponse / 1000
        }s`
      );
    }
  }

  return true;
}

/**
 * Update conversation context with new intent
 */
function updateConversationContext(intent: string) {
  conversationContext.recentIntents.push(intent);

  // Keep only the most recent intents
  if (conversationContext.recentIntents.length > MAX_INTENT_HISTORY) {
    conversationContext.recentIntents = conversationContext.recentIntents.slice(
      -MAX_INTENT_HISTORY
    );
  }

  conversationContext.lastResponseTime = Date.now();
  console.log(
    "Updated conversation context. Recent intents:",
    conversationContext.recentIntents
  );
}

/**
 * Estimate speech duration based on text length
 */
function estimateSpeechDuration(text: string): number {
  return Math.ceil((text.length / CHARACTERS_PER_SECOND) * 1000); // in milliseconds
}

/**
 * Check if bot is currently speaking
 */
export function isBotSpeaking(): boolean {
  if (!botState.isSpeaking) return false;

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
export function startBotSpeaking(speechId: string, text: string): void {
  const duration = estimateSpeechDuration(text);
  botState.isSpeaking = true;
  botState.currentSpeechId = speechId;
  botState.speechStartTime = Date.now();
  botState.estimatedSpeechDuration = duration;
  botState.lastSpeechText = text;

  console.log(
    `🗣️ Bot started speaking (ID: ${speechId}, estimated duration: ${duration}ms)`
  );

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
export function stopBotSpeaking(): void {
  if (botState.isSpeaking) {
    console.log(
      `🔇 Bot stopped speaking (was ID: ${botState.currentSpeechId})`
    );
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
export function clearSpeechQueue(): void {
  if (botState.speechQueue.length > 0) {
    console.log(
      `🗑️ Clearing speech queue (${botState.speechQueue.length} items)`
    );
    botState.speechQueue = [];
  }
}

/**
 * Check if bot is currently processing a request
 */
export function isBotProcessing(): boolean {
  return botState.isProcessing;
}

/**
 * Set bot processing state
 */
export function setBotProcessing(processing: boolean): void {
  botState.isProcessing = processing;
  if (processing) {
    console.log("🔄 Bot started processing request");
  } else {
    console.log("✅ Bot finished processing request");
  }
}

/**
 * Handle interruption when user speaks while bot is talking
 */
export function handleInterruption(newTranscript: string): boolean {
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
export function getRemainingSpeechDuration(): number {
  if (
    !botState.isSpeaking ||
    !botState.speechStartTime ||
    !botState.estimatedSpeechDuration
  ) {
    return 0;
  }

  const elapsed = Date.now() - botState.speechStartTime;
  const remaining = Math.max(0, botState.estimatedSpeechDuration - elapsed);
  return remaining;
}

/**
 * Force reset all bot states (for external interruption handling)
 */
export function forceResetBotState(): void {
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

export async function askLLM(
  transcript: string,
  wasInterrupted: boolean = false
): Promise<string | null> {
  try {
    if (!process.env.OPENAI_API_KEY) {
      console.error("❌ OPENAI_API_KEY is not set. Skipping askLLM.");
      return null;
    }
    const prompt = transcript?.trim();
    if (!prompt) return null;

    const system =
      "You are Sherlocks, an SRE-focused incident triage assistant. Your job is to quickly identify likely root causes, impacted components, and immediate mitigations from short snippets of context. Be concise (1-3 sentences), action-oriented, and specific. Prefer concrete next steps (dashboards, logs to check, feature flags, rollbacks) over generic advice. If interrupted, prioritize the newest message.";

    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    // Prefer the lightweight responses for latency
    const completion = await openaiClient.chat.completions.create({
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

    const text = completion.choices?.[0]?.message?.content?.trim();
    if (!text) return null;
    return text;
  } catch (error) {
    console.error("❌ OpenAI askLLM error:", error);
    return null;
  }
}

/**
 * Ask LLM with retries and alternate prompts to avoid empty responses.
 * Still 100% LLM-generated; no static text.
 */
export async function askLLMWithRetries(
  incidentText: string,
  wasInterrupted: boolean = false
): Promise<string | null> {
  // First attempt
  let reply = await askLLM(incidentText, wasInterrupted);
  if (reply) return reply;

  // Second attempt: slightly stronger instruction appended to user content
  try {
    if (!process.env.OPENAI_API_KEY) return null;
    const prompt = (incidentText || "").trim();
    if (!prompt) return null;
    const system =
      "You are Sherlocks, an SRE-focused incident triage assistant. Provide a concrete, actionable triage reply in 2-4 sentences.";
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
    const completion = await openaiClient.chat.completions.create({
      model,
      max_completion_tokens: 200,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content:
            (wasInterrupted
              ? `${prompt}\n\n[Prioritize this request (interruption)]\n`
              : prompt) +
            "\n\nRespond with specific likely cause(s) and next actions. Do not omit the answer.",
        },
      ],
    });
    reply = completion.choices?.[0]?.message?.content?.trim() || null;
    if (reply) return reply;
  } catch (e) {
    console.error("❌ askLLMWithRetries second-attempt error:", e);
  }

  // Third attempt: derive a root-cause paragraph and use it directly
  try {
    const paragraph = await generateRootCauseParagraph(incidentText);
    if (paragraph) return paragraph;
  } catch (e) {
    console.error("❌ askLLMWithRetries paragraph fallback error:", e);
  }

  return null;
}

/**
 * Detect whether the provided text looks like an incident/alert payload
 * and should be reformatted into a narrated "Video Script" summary.
 */
export function shouldGenerateVideoScript(text: string): boolean {
  const t = (text || "").toLowerCase();
  if (!t) return false;
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
export async function generateIncidentVideoScript(
  incidentText: string
): Promise<string | null> {
  try {
    if (!process.env.OPENAI_API_KEY) {
      console.error(
        "❌ OPENAI_API_KEY is not set. Skipping generateIncidentVideoScript."
      );
      return null;
    }

    const prompt = incidentText?.trim();
    if (!prompt) return null;

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

    const completion = await openaiClient.chat.completions.create({
      model,
      max_completion_tokens: 280,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
    });

    let text = completion.choices?.[0]?.message?.content?.trim();
    if (!text) {
      // Retry with a stronger prompt asking to not omit the answer
      const completion2 = await openaiClient.chat.completions.create({
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
      text = completion2.choices?.[0]?.message?.content?.trim();
    }
    return text || null;
  } catch (error) {
    console.error("❌ OpenAI generateIncidentVideoScript error:", error);
    return null;
  }
}

/**
 * Return true if the text is a greeting (hello/hi/etc.) or help request
 */
export function isGreeting(text: string): boolean {
  const normalized = normalizeForIntent(text || "");
  const intent = detectIntent(normalized);
  return intent === "greeting" || intent === "help";
}

/**
 * Provide a warm, concise greeting or help response suitable for TTS.
 */
export function generateGreetingResponse(text?: string): string {
  const normalized = normalizeForIntent(text || "");
  const intent = detectIntent(normalized);

  if (intent === "help") {
    return (
      "I'm here to help! I can analyze incidents, debug issues, and provide guidance. " +
      "You can share your screen by saying 'look at my screen', paste error logs, " +
      "or just describe what's happening. What do you need assistance with?"
    );
  }

  return (
    "Hello there! It's wonderful to meet you. I'm Sherlocks — your friendly AI " +
    "assistant. I'm here to help with incident triage, debugging, and anything " +
    "else you need. Just tell me what's going on, and we'll tackle it together."
  );
}

/**
 * Provide a concise identity description suitable for TTS.
 */
export function generateIdentityResponse(): string {
  return (
    "I'm Sherlocks — an SRE-focused assistant. I quickly triage incidents, " +
    "summarize errors, and suggest next actions like dashboards, logs, and rollbacks. " +
    "Tell me what you're seeing, or share your screen, and I'll help you debug."
  );
}

/**
 * Short acknowledgement for brief inputs
 */
export function generateShortAckResponse(): string {
  return "Got it!";
}

/**
 * Generate a concise root-cause paragraph from raw incident alert text.
 */
export async function generateRootCauseParagraph(
  incidentText: string
): Promise<string | null> {
  try {
    if (!process.env.OPENAI_API_KEY) return null;
    const prompt = incidentText?.trim();
    if (!prompt) return null;

    const system = [
      "You are Sherlocks, an SRE root-cause summarizer.",
      "Given alert text and notes, produce ONE concise paragraph (2-4 sentences)",
      "with likely root cause, impacted components, and immediate mitigation.",
      "Avoid bullet points. Keep under 80 words.",
    ].join("\n");

    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
    const completion = await openaiClient.chat.completions.create({
      model,
      max_completion_tokens: 160,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
    });

    const text = completion.choices?.[0]?.message?.content?.trim();
    return text || null;
  } catch (error) {
    console.error("❌ OpenAI generateRootCauseParagraph error:", error);
    return null;
  }
}

/**
 * Convert a paragraph into a structured video script JSON.
 * The model MUST return strict JSON matching the VideoScript type.
 */
export async function generateStructuredVideoScript(
  paragraph: string,
  incidentText?: string
): Promise<VideoScript | null> {
  try {
    if (!process.env.OPENAI_API_KEY) return null;
    const content = paragraph?.trim();
    if (!content) return null;

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
    const completion = await openaiClient.chat.completions.create({
      model,
      max_completion_tokens: 500,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    let raw = completion.choices?.[0]?.message?.content?.trim();
    if (!raw) return null;
    // Some models may prepend/append text; try to extract JSON
    const jsonOnly = extractFirstJsonObject(raw) || raw;
    const parsed = JSON.parse(jsonOnly) as VideoScript;

    // Basic validation
    if (
      !parsed?.segments?.length ||
      typeof parsed.total_duration_ms !== "number"
    ) {
      return null;
    }
    return parsed;
  } catch (error) {
    console.error("❌ OpenAI generateStructuredVideoScript error:", error);
    return null;
  }
}

/**
 * Generate a structured video script directly from raw incident text.
 */
async function generateStructuredVideoScriptFromIncident(
  incidentText: string
): Promise<VideoScript | null> {
  try {
    if (!process.env.OPENAI_API_KEY) return null;
    const content = incidentText?.trim();
    if (!content) return null;

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

    const model = process.env.OPENAI_MODEL || "gpt-5-2025-08-07";
    const completion = await openaiClient.chat.completions.create({
      model,
      max_completion_tokens: 700,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    let raw = completion.choices?.[0]?.message?.content?.trim();
    if (!raw) return null;
    const jsonOnly = extractFirstJsonObject(raw) || raw;
    const parsed = JSON.parse(jsonOnly) as VideoScript;
    if (
      !parsed?.segments?.length ||
      typeof parsed.total_duration_ms !== "number"
    ) {
      return null;
    }
    return parsed;
  } catch (error) {
    console.error("❌ generateStructuredVideoScriptFromIncident error:", error);
    return null;
  }
}

/**
 * Convert an unstructured narrated "Video Script" text into structured segments via LLM.
 */
async function convertNarratedScriptTextToStructured(
  videoScriptText: string
): Promise<VideoScript | null> {
  try {
    if (!process.env.OPENAI_API_KEY) return null;
    const content = videoScriptText?.trim();
    if (!content) return null;

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

    const model = process.env.OPENAI_MODEL || "gpt-5-2025-08-07";
    const completion = await openaiClient.chat.completions.create({
      model,
      max_completion_tokens: 800,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    let raw = completion.choices?.[0]?.message?.content?.trim();
    if (!raw) return null;
    const jsonOnly = extractFirstJsonObject(raw) || raw;
    const parsed = JSON.parse(jsonOnly) as VideoScript;
    if (
      !parsed?.segments?.length ||
      typeof parsed.total_duration_ms !== "number"
    ) {
      return null;
    }
    return parsed;
  } catch (error) {
    console.error("❌ convertNarratedScriptTextToStructured error:", error);
    return null;
  }
}

/**
 * High-level pipeline: incident text → root cause paragraph → structured video script.
 */
export async function runIncidentVideoScriptPipeline(
  incidentText: string
): Promise<{ paragraph: string; script: VideoScript } | null> {
  // If the user pasted a structured RCA, generate the script directly from it
  if (isStructuredRcaText(incidentText)) {
    const directScript = await generateStructuredVideoScriptFromIncident(
      incidentText
    );
    if (directScript) {
      // Create a short paragraph summary to return alongside the script
      const paragraph =
        (await generateRootCauseParagraph(incidentText)) ||
        "Narrated walkthrough based on the provided structured incident RCA.";
      return { paragraph, script: directScript };
    }
  }

  let paragraph = await generateRootCauseParagraph(incidentText);
  if (!paragraph) {
    // Fallback heuristic paragraph
    const snippet = incidentText.trim().slice(0, 240).replace(/\s+/g, " ");
    paragraph =
      "Likely CPU saturation in the reported service aligned with the alert window. " +
      "Mitigate by scaling replicas, profiling hot paths, and reviewing the most recent deployment. Context: " +
      snippet;
  }
  let script = await generateStructuredVideoScript(paragraph, incidentText);
  if (!script) {
    // Retry by generating from the raw incident text directly
    script = await generateStructuredVideoScriptFromIncident(incidentText);
  }
  if (!script) {
    // Fallback to unstructured narrated script, then convert to structured
    const narrated = await generateIncidentVideoScript(incidentText);
    if (narrated) {
      script = await convertNarratedScriptTextToStructured(narrated);
    }
  }
  if (!script) {
    // Give up on structured playback; caller will use unstructured narration
    return null;
  }
  return { paragraph, script };
}

/**
 * OCR-like extraction using OpenAI vision: summarize on-screen errors/logs.
 * Input is a PNG/JPEG base64 string without data URL prefix.
 */
export async function summarizeFromImageBase64(
  base64Image: string
): Promise<string | null> {
  try {
    if (!process.env.OPENAI_API_KEY) return null;
    const b64 = base64Image?.trim();
    if (!b64) return null;

    // Use Chat Completions with image input (o4-mini or gpt-4o-mini)
    const model =
      process.env.OPENAI_VISION_MODEL ||
      process.env.OPENAI_MODEL ||
      "gpt-4o-mini";
    const system =
      "You are Sherlocks. Extract key error messages, stack traces, metrics, and service names from the screenshot. Return a concise paragraph (<=80 words) suitable for incident triage.";

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
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

    const completion = await openaiClient.chat.completions.create({
      model,
      max_completion_tokens: 160,
      messages,
    });
    const text = completion.choices?.[0]?.message?.content?.trim();
    return text || null;
  } catch (error) {
    console.error("❌ summarizeFromImageBase64 error:", error);
    return null;
  }
}

/**
 * Convert text to speech using Deepgram TTS API and convert to MP3
 * @param text - The text to convert to speech
 * @returns MP3 audio buffer containing the generated speech
 */
export async function textToSpeech(text: string): Promise<Buffer | null> {
  try {
    console.log("🔊 Converting text to speech:", text);

    // Make TTS request to Deepgram (generate WAV)
    const response = await deepgramClient.speak.request(
      { text },
      {
        model: "aura-2-hermes-en",
        encoding: "linear16",
        container: "wav",
        sample_rate: 16000,
      }
    );

    const stream = await response.getStream();

    if (stream) {
      const wavBuffer = await getAudioBuffer(stream);
      const mp3Buffer = await convertWavToMp3(wavBuffer);
      if (mp3Buffer) {
        return mp3Buffer;
      } else {
        console.error("Failed to convert WAV to MP3");
        return null;
      }
    } else {
      console.error(" Failed to get audio stream from Deepgram TTS");
      return null;
    }
  } catch (error) {
    console.error("Text-to-speech error:", error);
    return null;
  }
}

/**
 * Helper function to convert stream to audio buffer
 */
async function getAudioBuffer(
  response: ReadableStream<Uint8Array>
): Promise<Buffer> {
  const reader = response.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const dataArray = chunks.reduce(
    (acc, chunk) => Uint8Array.from([...acc, ...chunk]),
    new Uint8Array(0)
  );

  return Buffer.from(dataArray.buffer);
}

/**
 * Convert WAV buffer to MP3 buffer using streaming ffmpeg (much faster - no temp files!)
 * @param wavBuffer - The WAV audio buffer to convert
 * @returns MP3 audio buffer
 */
async function convertWavToMp3(wavBuffer: Buffer): Promise<Buffer | null> {
  return new Promise((resolve) => {
    try {
      console.log("🎵 Starting streaming WAV→MP3 conversion...");
      const startTime = Date.now();

      const mp3Chunks: Buffer[] = [];
      const { Readable, PassThrough } = require("stream");

      const inputStream = new Readable();
      inputStream.push(wavBuffer);
      inputStream.push(null);

      const outputStream = new PassThrough();

      const command = ffmpeg(inputStream)
        .inputFormat("wav")
        .audioCodec("libmp3lame")
        .audioBitrate(64)
        .audioFrequency(16000)
        .format("mp3")
        .on("start", (commandLine) => {
          console.log(
            "🔄 FFmpeg streaming command:",
            commandLine.substring(0, 100) + "..."
          );
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
      outputStream.on("data", (chunk: Buffer) => {
        mp3Chunks.push(chunk);
      });

      outputStream.on("error", (error: any) => {
        console.error("❌ Output stream error:", error);
        resolve(null);
      });

      command.pipe(outputStream, { end: true });
    } catch (error) {
      console.error("❌ Streaming conversion setup error:", error);
      resolve(null);
    }
  });
}
