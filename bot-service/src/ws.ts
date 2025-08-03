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

  // Create Deepgram connection for this WebSocket session
  const deepgramConnection = deepgramClient.listen.live({
    model: "nova-2",
    smart_format: true,
    language: "en-US",
    punctuate: true,
    interim_results: false,
  });

  deepgramConnection.on("open", () => {
    console.log("Deepgram socket opened for new connection");
  });

  deepgramConnection.on("transcript", async (data: any) => {
    console.log("🔍 Raw Deepgram data:", JSON.stringify(data, null, 2));
    const transcript = data.channel?.alternatives[0]?.transcript;
    if (transcript && transcript.trim()) {
      console.log("🎤 Transcript:", transcript);
      try {
        const reply = await askLLM(transcript);
        console.log("🤖 LLM Reply:", reply);
      } catch (error) {
        console.error("LLM error:", error);
      }
    } else {
      console.log("🔕 No transcript or empty transcript received");
    }
  });

  deepgramConnection.on("error", (err: any) => {
    console.error("Deepgram error:", err);
  });

  ws.on("message", (message: WebSocket.Data) => {
    try {
      const wsMessage = JSON.parse(message.toString()) as AudioDataEvent;
      if (wsMessage.event === "audio_mixed_raw.data") {
        console.log(
          `📥 Received audio packet, recording ID: ${wsMessage.data.recording.id}`
        );
        const audioBuffer = Buffer.from(wsMessage.data.data.buffer, "base64");
        console.log(`🔊 Sending ${audioBuffer.length} bytes to Deepgram`);
        deepgramConnection.send(audioBuffer as any);
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
