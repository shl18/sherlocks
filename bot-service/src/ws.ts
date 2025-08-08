import WebSocket from "ws";
import { askLLM, textToSpeech } from "./llm";
import { sendAudioToBot } from "./recall";

type TranscriptDataEvent = {
  event: "transcript.data";
  data: {
    text: string; // The transcribed text
    is_final: boolean; // Whether this is a final transcript or interim
    speaker?: {
      id: string;
      name?: string;
    };
    timestamp: number;
    bot_id: string;
    recording_id: string;
    confidence?: number;
  };
};

const wss = new WebSocket.Server({ port: 3456 });

wss.on("connection", (ws) => {
  console.log("✅ New WebSocket client connected from Recall AI");
  console.log("📝 Ready to receive transcript events via WebSocket");

  ws.on("message", async (message: WebSocket.Data) => {
    try {
      const wsMessage = JSON.parse(message.toString()) as TranscriptDataEvent;
      console.log(
        "📥 Received WebSocket message:",
        JSON.stringify(wsMessage, null, 2)
      );

      if (wsMessage.event === "transcript.data") {
        const transcriptData = wsMessage.data;

        console.log(`📝 Transcript: "${transcriptData.text}"`);
        console.log(
          `🔍 Speaker: ${
            transcriptData.speaker?.name ||
            transcriptData.speaker?.id ||
            "Unknown"
          }`
        );
        console.log(`🔍 Is final: ${transcriptData.is_final}`);
        console.log(`🔍 Confidence: ${transcriptData.confidence || "N/A"}`);
        console.log(`🔍 Bot ID: ${transcriptData.bot_id}`);
        console.log(`🔍 Recording ID: ${transcriptData.recording_id}`);

        // Only process final transcripts to avoid duplicate responses
        if (transcriptData.is_final && transcriptData.text?.trim()) {
          try {
            const reply = await askLLM(transcriptData.text);
            if (reply) {
              console.log("🤖 LLM Reply:", reply);

              // Convert LLM response to speech
              console.log("🔊 Converting LLM response to speech...");
              const audioBuffer = await textToSpeech(reply);

              if (audioBuffer) {
                console.log(
                  "🎵 Audio buffer size:",
                  audioBuffer.length,
                  "bytes"
                );

                // Send TTS audio to the bot to speak in the call
                const success = await sendAudioToBot(audioBuffer);

                if (success) {
                  console.log(
                    "🗣️ Bot will now speak the response in the call!"
                  );
                } else {
                  console.log("❌ Failed to send audio to bot");
                }
              } else {
                console.log("❌ Failed to convert LLM response to speech");
              }
            } else {
              console.log("🤖 LLM: No response generated");
            }
          } catch (error) {
            console.error("❌ LLM processing error:", error);
          }
        } else {
          console.log("⏭️ Skipping interim transcript or empty text");
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
