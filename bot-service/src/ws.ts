import WebSocket from "ws";
import {
  askLLM,
  textToSpeech,
  handleInterruption,
  startBotSpeaking,
  setBotProcessing,
  forceResetBotState,
  isBotSpeaking,
  getRemainingSpeechDuration,
} from "./llm";
import { sendAudioToBot, stopBotAudio } from "./recall";

type TranscriptDataEvent = {
  event: "transcript.data";
  data: {
    data: {
      words: Array<{
        text: string;
        start_timestamp: {
          relative: number;
          absolute: string;
        };
        end_timestamp: {
          relative: number;
          absolute: string;
        };
      }>;
      participant: {
        id: number;
        name: string;
        is_host: boolean;
        platform: string;
        extra_data?: any;
      };
    };
    transcript: {
      id: string;
      metadata: any;
    };
    realtime_endpoint: {
      id: string;
      metadata: any;
    };
    recording: {
      id: string;
      metadata: any;
    };
    bot: {
      id: string;
      metadata: any;
    };
  };
};

type ChatMessageEvent = {
  event: "participant_events.chat_message";
  data: {
    data: {
      participant: {
        name: string;
        is_host: boolean;
        platform: string;
        extra_data?: any;
      };
      timestamp: {
        relative: number;
        absolute: string;
      };
      data: {
        text: string;
        to: string;
      };
    };
    participant_events: {
      id: string;
      metadata: any;
    };
    realtime_endpoint: {
      id: string;
      metadata: any;
    };
    recording: {
      id: string;
      metadata: any;
    };
    bot: {
      id: string;
      metadata: any;
    };
  };
};

type WebSocketEvent =
  | TranscriptDataEvent
  | ChatMessageEvent
  | { event: string; data: any };

/**
 * Process text input with LLM and send audio response
 * @param text - The text to process (from transcript or chat)
 * @param source - The source of the text ("transcript" or "chat")
 */
// Global lock to prevent concurrent processing
let isCurrentlyProcessing = false;
let currentProcessingId: string | null = null;
let lastAudioSentTime = 0;
const AUDIO_COOLDOWN_MS = 10000; // 10 seconds minimum time between audio outputs to prevent overlap

// Global audio lock to prevent any audio overlap
let isAudioPlaying = false;
let currentAudioId: string | null = null;

// ===== Chunked TTS Playback (Cancelable) =====
let currentTtsGenerationId: string | null = null;

function newTtsGenerationId(): string {
  const id = `gen_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  currentTtsGenerationId = id;
  return id;
}

function cancelCurrentTtsGeneration(): void {
  currentTtsGenerationId = null;
}

function hasGenerationBeenCancelled(generationId: string): boolean {
  return currentTtsGenerationId !== generationId;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function splitIntoChunks(text: string): string[] {
  const maxLen = 140; // keep chunks short for fast latency
  // First split by sentence boundaries
  const sentences = text
    .split(/([.!?]+\s+)/)
    .reduce<string[]>((acc, part, idx, arr) => {
      if (part.trim().length === 0) return acc;
      // Merge text with its following punctuation token
      if (idx < arr.length - 1 && /[.!?]+\s+/.test(arr[idx + 1] || "")) {
        acc.push((part + (arr[idx + 1] || "")).trim());
        arr[idx + 1] = ""; // consume the punctuation token
      } else {
        acc.push(part.trim());
      }
      return acc;
    }, []);

  const chunks: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length <= maxLen) {
      chunks.push(sentence);
      continue;
    }
    // Further split long sentences by words without breaking mid-word
    const words = sentence.split(/\s+/);
    let buf = "";
    for (const word of words) {
      if ((buf + (buf ? " " : "") + word).length > maxLen) {
        if (buf) chunks.push(buf);
        buf = word;
      } else {
        buf = buf ? `${buf} ${word}` : word;
      }
    }
    if (buf) chunks.push(buf);
  }
  return chunks;
}

function estimateDurationMs(text: string): number {
  // ~12.5 chars/sec from llm.ts
  const CHARACTERS_PER_SECOND = 12.5;
  const base = Math.ceil((text.length / CHARACTERS_PER_SECOND) * 1000);
  return Math.max(600, base); // minimum ~0.6s to avoid ultra short clips
}

async function speakInChunks(
  reply: string,
  generationId: string,
  source: "transcript" | "chat"
): Promise<void> {
  const chunks = splitIntoChunks(reply);
  for (const chunk of chunks) {
    if (hasGenerationBeenCancelled(generationId)) {
      console.log("🛑 Chunked TTS cancelled before generating next chunk");
      break;
    }

    // Generate TTS for this chunk
    const audioBuffer = await textToSpeech(chunk);
    if (!audioBuffer) {
      console.log("❌ Failed to convert chunk to speech, skipping chunk");
      continue;
    }

    if (hasGenerationBeenCancelled(generationId)) {
      console.log("🛑 Chunked TTS cancelled after generation, before send");
      break;
    }

    // Ensure we are not overlapping: if something else is speaking, try to stop and wait briefly
    if (isAudioPlaying || isBotSpeaking()) {
      console.log("🔇 Attempting to stop audio before sending next chunk...");
      await stopBotAudio();
      await sleep(250);
    }

    // Send the audio chunk
    const speechId = `speech_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;
    const success = await sendAudioToBot(audioBuffer);
    if (!success) {
      console.log("❌ Failed to send audio chunk to bot");
      // If send fails, cancel the rest to avoid piling up
      break;
    }

    // Mark speaking and estimate duration for pacing
    startBotSpeaking(speechId, chunk);
    isAudioPlaying = true;
    currentAudioId = speechId;
    const estimatedMs = estimateDurationMs(chunk) + 200; // small buffer

    // Wait in small slices so we can react to cancellation quickly
    let remaining = estimatedMs;
    while (remaining > 0) {
      if (hasGenerationBeenCancelled(generationId)) {
        console.log(
          "🛑 Chunked TTS cancelled mid-wait; attempting to stop audio"
        );
        await stopBotAudio();
        break;
      }
      const slice = Math.min(150, remaining);
      await sleep(slice);
      remaining -= slice;
    }

    // Release audio lock for next chunk
    if (currentAudioId === speechId) {
      isAudioPlaying = false;
      currentAudioId = null;
    }

    if (hasGenerationBeenCancelled(generationId)) {
      console.log("🛑 Chunked TTS cancelled after chunk send");
      break;
    }
  }
}

async function processTextWithLLM(
  text: string,
  source: "transcript" | "chat"
): Promise<void> {
  // Prevent multiple concurrent processing
  if (isCurrentlyProcessing) {
    console.log(
      `⏭️ Skipping ${source} processing - already processing another request`
    );
    return;
  }

  const processingId = `proc_${Date.now()}_${Math.random()
    .toString(36)
    .substr(2, 9)}`;

  try {
    isCurrentlyProcessing = true;
    currentProcessingId = processingId;
    console.log(`🧠 Processing ${source} text with LLM: "${text}"`);

    // Mark bot as processing
    setBotProcessing(true);

    // Check for interruption - if user speaks while bot is talking
    const wasInterrupted = handleInterruption(text);
    if (wasInterrupted) {
      console.log("🚫 Previous bot speech interrupted by user input");

      // Stop any current audio output and cancel ongoing chunk generation
      console.log("🔇 Attempting to stop current bot audio...");
      await stopBotAudio();
      cancelCurrentTtsGeneration();

      // Reset states
      forceResetBotState();
      currentProcessingId = processingId;
    }

    const reply = await askLLM(text, wasInterrupted);
    if (reply) {
      console.log(`🤖 LLM Reply for ${source}:`, reply);

      // Start chunked, cancelable playback asynchronously
      const generationId = newTtsGenerationId();
      // Fire and forget so we don't block receiving further transcripts
      void speakInChunks(reply, generationId, source);
    } else {
      console.log(`🤖 LLM: No response generated for ${source}`);
    }
  } catch (error) {
    console.error(`❌ LLM processing error for ${source}:`, error);
  } finally {
    // Clear processing state quickly so we can accept new inputs/interruption
    setBotProcessing(false);
    if (currentProcessingId === processingId) {
      isCurrentlyProcessing = false;
      currentProcessingId = null;
    }
  }
}

const wss = new WebSocket.Server({ port: 3456 });

wss.on("connection", (ws) => {
  console.log("✅ New WebSocket client connected from Recall AI");
  console.log("📝 Ready to receive transcript events via WebSocket");

  ws.on("message", async (message: WebSocket.Data) => {
    try {
      const wsMessage = JSON.parse(message.toString()) as WebSocketEvent;
      console.log(
        "📥 Received WebSocket message:",
        JSON.stringify(wsMessage, null, 2)
      );

      if (wsMessage.event === "transcript.data") {
        // Type assertion to ensure proper typing
        const transcriptEvent = wsMessage as TranscriptDataEvent;

        // Extract data from the nested structure
        const wordsData = transcriptEvent.data.data.words;
        const participant = transcriptEvent.data.data.participant;
        const botId = transcriptEvent.data.bot.id;
        const recordingId = transcriptEvent.data.recording.id;

        // Combine all words into a transcript text
        const transcriptText = wordsData.map((word) => word.text).join(" ");

        console.log(`📝 Transcript: "${transcriptText}"`);
        console.log(`🔍 Speaker: ${participant.name} (ID: ${participant.id})`);
        console.log(`🔍 Is host: ${participant.is_host}`);
        console.log(`🔍 Word count: ${wordsData.length}`);
        console.log(`🔍 Bot ID: ${botId}`);
        console.log(`🔍 Recording ID: ${recordingId}`);

        // Process the transcript if we have text
        if (transcriptText?.trim()) {
          await processTextWithLLM(transcriptText, "transcript");
        } else {
          console.log("⏭️ Skipping empty transcript");
        }
      } else if (wsMessage.event === "participant_events.chat_message") {
        // Type assertion to ensure proper typing
        const chatEvent = wsMessage as ChatMessageEvent;

        // Extract chat message data
        const participant = chatEvent.data.data.participant;
        const chatData = chatEvent.data.data.data;
        const timestamp = chatEvent.data.data.timestamp;
        const botId = chatEvent.data.bot.id;
        const recordingId = chatEvent.data.recording.id;

        console.log(`💬 Chat Message: "${chatData.text}"`);
        console.log(`🔍 Speaker: ${participant.name}`);
        console.log(`🔍 Is host: ${participant.is_host}`);
        console.log(`🔍 To: ${chatData.to}`);
        console.log(`🔍 Timestamp: ${timestamp.absolute}`);
        console.log(`🔍 Bot ID: ${botId}`);
        console.log(`🔍 Recording ID: ${recordingId}`);

        // Process the chat message if we have text
        if (chatData.text?.trim()) {
          await processTextWithLLM(chatData.text, "chat");
        } else {
          console.log("⏭️ Skipping empty chat message");
        }
      } else {
        console.log(`❓ Unhandled event type: ${wsMessage.event}`);
      }
    } catch (error) {
      console.error("❌ Failed to parse or process message:", error);
      console.error("📥 Raw message:", message.toString());
    }
  });
  ws.on("error", (error) => {
    console.error("❌ WebSocket error:", error);
  });
  ws.on("close", () => {
    console.log("🔌 WebSocket connection closed");
  });
});

console.log("✅ WebSocket server started and listening on port 3456");
console.log(
  "📡 Ready to receive transcript events from Recall AI via WebSocket"
);
console.log(
  "💡 Make sure your ngrok WebSocket URL is: wss://6fad6a2e0355.ngrok-free.app"
);
