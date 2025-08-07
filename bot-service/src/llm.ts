import { createClient } from "@deepgram/sdk";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import path from "path";
import { promisify } from "util";
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
        model: "aura-2-thalia-en", // Use a natural-sounding voice
        encoding: "linear16",
        container: "wav", // Deepgram supports WAV
        sample_rate: 16000, // Match the audio format expected by Recall AI
      }
    );

    // Get the audio stream from the response
    const stream = await response.getStream();

    if (stream) {
      // Convert stream to WAV buffer
      const wavBuffer = await getAudioBuffer(stream);
      console.log(
        "✅ Text-to-speech WAV conversion successful, buffer size:",
        wavBuffer.length
      );

      // Convert WAV to MP3
      const mp3Buffer = await convertWavToMp3(wavBuffer);
      if (mp3Buffer) {
        console.log(
          "✅ WAV to MP3 conversion successful, MP3 buffer size:",
          mp3Buffer.length
        );
        return mp3Buffer;
      } else {
        console.error("❌ Failed to convert WAV to MP3");
        return null;
      }
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

      // Create readable stream from WAV buffer
      const inputStream = new Readable();
      inputStream.push(wavBuffer);
      inputStream.push(null); // End stream

      // Create output stream to collect MP3 data
      const outputStream = new PassThrough();

      // Create ffmpeg command with streaming
      const command = ffmpeg(inputStream)
        .inputFormat("wav")
        .audioCodec("libmp3lame")
        .audioBitrate(64) // Lower bitrate for faster conversion
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

      // Collect output chunks
      outputStream.on("data", (chunk: Buffer) => {
        mp3Chunks.push(chunk);
      });

      outputStream.on("error", (error: any) => {
        console.error("❌ Output stream error:", error);
        resolve(null);
      });

      // Pipe ffmpeg output to our collector
      command.pipe(outputStream, { end: true });
    } catch (error) {
      console.error("❌ Streaming conversion setup error:", error);
      resolve(null);
    }
  });
}
