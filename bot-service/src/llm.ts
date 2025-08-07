import { createClient } from "@deepgram/sdk";
import dotenv from "dotenv";
dotenv.config();

const deepgramClient = createClient(process.env.DEEPGRAM_API_KEY);

/**
 * Dummy LLM that responds to specific keywords
 * This is a simple implementation that listens for "hello" and responds appropriately
 */
export async function askLLM(transcript: string): Promise<string | null> {
  // Convert transcript to lowercase for case-insensitive matching
  const normalizedTranscript = transcript.toLowerCase().trim();

  console.log("🎧 Processing transcript:", transcript);

  // Check if the transcript contains "hello"
  if (
    normalizedTranscript.includes("hello") ||
    normalizedTranscript.includes("hi") ||
    normalizedTranscript.includes("hey") ||
    normalizedTranscript.includes("how are you") ||
    normalizedTranscript.includes("how are you doing")
  ) {
    const reply = "`hey i am sherlocks`";
    console.log("🤖 LLM Response:", reply);
    return reply;
  }

  // For now, we'll only respond to "hello"
  // You can add more trigger words and responses here
  console.log("🤐 No response triggered for this transcript");
  return null;
}

/**
 * Convert text to speech using Deepgram TTS API
 * @param text - The text to convert to speech
 * @returns Audio buffer containing the generated speech
 */
export async function textToSpeech(text: string): Promise<Buffer | null> {
  try {
    console.log("🔊 Converting text to speech:", text);

    // Make TTS request to Deepgram
    const response = await deepgramClient.speak.request(
      { text },
      {
        model: "aura-2-thalia-en", // Use a natural-sounding voice
        encoding: "linear16",
        container: "wav",
        sample_rate: 16000, // Match the audio format expected by Recall AI
      }
    );

    // Get the audio stream from the response
    const stream = await response.getStream();

    if (stream) {
      // Convert stream to buffer
      const audioBuffer = await getAudioBuffer(stream);
      console.log(
        "✅ Text-to-speech conversion successful, audio buffer size:",
        audioBuffer.length
      );
      return audioBuffer;
    } else {
      console.error("❌ Failed to get audio stream from Deepgram TTS");
      return null;
    }
  } catch (error) {
    console.error("❌ Text-to-speech error:", error);
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
