import { createClient } from "@deepgram/sdk";
import ffmpeg from "fluent-ffmpeg";
import dotenv from "dotenv";
dotenv.config();

const deepgramClient = createClient(process.env.DEEPGRAM_API_KEY);

interface ConversationContext {
  recentIntents: string[];
  lastResponseTime: number;
}

const conversationContext: ConversationContext = {
  recentIntents: [],
  lastResponseTime: 0,
};

const MAX_INTENT_HISTORY = 5;
const MIN_RESPONSE_INTERVAL = 2000;
const SAME_INTENT_COOLDOWN = 6000;

function detectIntent(normalizedTranscript: string): string | null {
  if (
    normalizedTranscript.includes("hello") ||
    normalizedTranscript.includes("hi") ||
    normalizedTranscript.includes("hey") ||
    normalizedTranscript.includes("how are you doing") ||
    normalizedTranscript.includes("whats up")
  ) {
    return "greeting";
  }

  if (
    normalizedTranscript.includes("who are you") ||
    normalizedTranscript.includes("what u do") ||
    normalizedTranscript.includes("what is this")
  ) {
    return "identity";
  }

  return null;
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

export async function askLLM(transcript: string): Promise<string | null> {
  const normalizedTranscript = transcript.toLowerCase().trim();
  console.log("🎧 Processing transcript:", transcript);
  const intent = detectIntent(normalizedTranscript);

  if (!intent) {
    console.log("No intent detected for this transcript");
    return null;
  }

  console.log("Detected intent:", intent);

  if (!shouldRespond(intent)) {
    return null;
  }

  let reply: string | null = null;

  switch (intent) {
    case "greeting":
      reply = "hey i am sherlocks";
      break;
    case "identity":
      reply = "i am a bot that can help you with your questions";
      break;
    default:
      console.log("No response defined for intent:", intent);
      return null;
  }

  if (reply) {
    updateConversationContext(intent);
    console.log("LLM Response:", reply);
    return reply;
  }

  return null;
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
        model: "aura-2-thalia-en",
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
