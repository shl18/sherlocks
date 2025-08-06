import WebSocket from "ws";
import fs from "fs";
import { createClient } from "@deepgram/sdk";
import { askLLM } from "./llm";

type AudioDataEvent = {
  event: "audio_mixed_raw.data";
  data: {
    data: {
      buffer: string; // Base64 encoded audio data
      timestamp: {
        relative: number;
        absolute: string;
      };
    };
    realtime_endpoint: {
      id: string;
      metadata: Record<string, string>;
    };
    recording: {
      id: string;
      metadata: Record<string, string>;
    };
    bot: {
      id: string;
      metadata: Record<string, string>;
    };
    audio_mixed: {
      id: string;
      metadata: Record<string, string>;
    };
  };
};

const deepgramClient = createClient(process.env.DEEPGRAM_API_KEY);

const wss = new WebSocket.Server({ port: 3456 });

wss.on("connection", (ws) => {
  console.log("New WebSocket client connected");

  // Check Deepgram API key
  if (!process.env.DEEPGRAM_API_KEY) {
    console.error("❌ DEEPGRAM_API_KEY not found in environment variables!");
    return;
  }
  console.log(
    "🔑 Deepgram API key found, length:",
    process.env.DEEPGRAM_API_KEY.length
  );

  // Create Deepgram connection for this WebSocket session
  console.log("🎙️ Creating Deepgram connection with config...");

  // Try multiple configurations
  let deepgramConnection;
  try {
    // First try: simplified configuration
    deepgramConnection = deepgramClient.listen.live({
      model: "base", // Use base model instead
      language: "en-US",
      encoding: "linear16",
      sample_rate: 16000,
      channels: 1,
      interim_results: true,
    });
    console.log("🎙️ Deepgram connection created with base model");
  } catch (error) {
    console.error("❌ Failed to create Deepgram connection:", error);
    try {
      // Fallback: even simpler config
      deepgramConnection = deepgramClient.listen.live({
        model: "nova-2",
        encoding: "linear16",
        sample_rate: 16000,
      });
      console.log("🎙️ Deepgram connection created with fallback config");
    } catch (fallbackError) {
      console.error(
        "❌ Fallback Deepgram connection also failed:",
        fallbackError
      );
      return;
    }
  }

  let deepgramReady = false;
  let audioPacketCount = 0;

  // Add connection timeout
  const connectionTimeout = setTimeout(() => {
    if (!deepgramReady) {
      console.error("⏰ Deepgram connection timeout after 10 seconds");
    }
  }, 10000);

  deepgramConnection.on("open", () => {
    console.log("Deepgram socket opened for new connection");
    deepgramReady = true;
    clearTimeout(connectionTimeout);
    console.log("🔗 Deepgram is now ready to receive audio");
    console.log("🔗 Deepgram ready state:", deepgramConnection.getReadyState());

    // Send a small test audio packet to verify connection
    setTimeout(() => {
      console.log("🧪 Sending test audio packet to verify Deepgram...");
      const testAudio = Buffer.alloc(1600, 0); // 100ms of silence at 16kHz mono
      const testArrayBuffer = testAudio.buffer.slice(
        testAudio.byteOffset,
        testAudio.byteOffset + testAudio.byteLength
      );
      deepgramConnection.send(testArrayBuffer);
      console.log("🧪 Test audio packet sent");
    }, 1000);
  });

  // Handle Results events (the correct event type from Deepgram)
  deepgramConnection.on("Results", async (data: any) => {
    console.log("🔍 Raw Deepgram Results:", JSON.stringify(data, null, 2));
    const transcript = data.channel?.alternatives[0]?.transcript;
    if (transcript && transcript.trim()) {
      console.log("🎤 Transcript:", transcript);
      try {
        const reply = await askLLM(transcript);
        if (reply) {
          console.log("🤖 LLM Reply:", reply);
        } else {
          console.log("🤖 LLM: No response generated");
        }
      } catch (error) {
        console.error("❌ LLM error:", error);
      }
    } else {
      console.log("🔕 No transcript or empty transcript received");
    }
  });

  // Also keep the old transcript handler as fallback
  deepgramConnection.on("transcript", async (data: any) => {
    console.log("🔍 Fallback transcript event:", JSON.stringify(data, null, 2));
    const transcript = data.channel?.alternatives[0]?.transcript;
    if (transcript && transcript.trim()) {
      console.log("🎤 Fallback Transcript:", transcript);
      try {
        const reply = await askLLM(transcript);
        if (reply) {
          console.log("🤖 Fallback LLM Reply:", reply);
        } else {
          console.log("🤖 Fallback LLM: No response generated");
        }
      } catch (error) {
        console.error("❌ Fallback LLM error:", error);
      }
    }
  });

  // Add comprehensive Deepgram debugging
  deepgramConnection.on("metadata", (data: any) => {
    console.log("📊 Deepgram metadata:", JSON.stringify(data, null, 2));
  });

  deepgramConnection.on("utteranceEnd", (data: any) => {
    console.log("🗣️ Utterance ended:", JSON.stringify(data, null, 2));
  });

  deepgramConnection.on("close", (data: any) => {
    console.log(
      "🔌 Deepgram connection closed:",
      JSON.stringify(data, null, 2)
    );
  });

  deepgramConnection.on("error", (err: any) => {
    console.error("❌ Deepgram error:", JSON.stringify(err, null, 2));
  });

  deepgramConnection.on("warning", (warning: any) => {
    console.warn("⚠️ Deepgram warning:", JSON.stringify(warning, null, 2));
  });

  deepgramConnection.on("unhandled", (data: any) => {
    console.log("🤷 Deepgram unhandled event:", JSON.stringify(data, null, 2));
  });

  // Debug: Event listeners are now properly registered for Results events
  console.log(
    "🔍 Deepgram event listeners registered for: Results, transcript, metadata, utteranceEnd, etc."
  );

  ws.on("message", (message: WebSocket.Data) => {
    try {
      const wsMessage = JSON.parse(message.toString()) as AudioDataEvent;
      if (wsMessage.event === "audio_mixed_raw.data") {
        audioPacketCount++;
        console.log(
          `📥 Received audio packet #${audioPacketCount}, recording ID: ${wsMessage.data.recording.id}`
        );
        const audioBuffer = Buffer.from(wsMessage.data.data.buffer, "base64");
        console.log(`🔊 Sending ${audioBuffer.length} bytes to Deepgram`);

        // Add detailed debugging
        console.log(
          `🔍 Audio buffer first 20 bytes:`,
          audioBuffer.subarray(0, 20)
        );
        console.log(`🔍 Buffer type:`, typeof audioBuffer);
        console.log(`🔍 Is Buffer:`, Buffer.isBuffer(audioBuffer));

        // Check if Deepgram connection is ready
        if (deepgramReady && deepgramConnection.getReadyState() === 1) {
          // Convert Buffer to ArrayBuffer for Deepgram
          const arrayBuffer = audioBuffer.buffer.slice(
            audioBuffer.byteOffset,
            audioBuffer.byteOffset + audioBuffer.byteLength
          );
          deepgramConnection.send(arrayBuffer);
          console.log("✅ Successfully sent to Deepgram");
        } else {
          console.log(
            `❌ Deepgram not ready - Ready flag: ${deepgramReady}, State: ${deepgramConnection.getReadyState()}`
          );
        }

        const recordingId = wsMessage.data.recording.id;
        const filePath = `/tmp/${recordingId}.bin`;
        fs.appendFileSync(filePath, audioBuffer);
      } else {
        console.log(`Unhandled event type: ${wsMessage.event}`);
      }
    } catch (error) {
      console.error("Failed to parse or process message:", error);
    }
  });
  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
  });
  ws.on("close", () => {
    console.log("WebSocket connection closed");
    deepgramConnection.requestClose();
  });
});

console.log("WebSocket server started and listening on port 3456");
