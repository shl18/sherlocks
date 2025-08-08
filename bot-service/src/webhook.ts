import express from "express";
import { askLLM, textToSpeech } from "./llm";
import { sendAudioToBot } from "./recall";

// Recall AI webhook payload structure for transcripts
type RecallTranscriptWebhook = {
  text: string;
  is_final: boolean;
  confidence: number;
  speaker?: {
    id: string;
    name?: string;
  };
  timestamp: number;
  bot_id: string;
  recording_id: string;
};

const app = express();
const PORT = 3456;

// Middleware to parse JSON payloads
app.use(express.json());

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "OK", message: "Webhook server is running" });
});

// Webhook endpoint to receive transcripts from Recall AI
app.post("/transcript", async (req, res) => {
  try {
    console.log("📥 Received webhook from Recall AI");
    console.log("🔍 Raw payload:", JSON.stringify(req.body, null, 2));

    const transcriptData = req.body as RecallTranscriptWebhook;

    console.log(`📝 Transcript: "${transcriptData.text}"`);
    console.log(
      `🔍 Speaker: ${
        transcriptData.speaker?.name || transcriptData.speaker?.id || "Unknown"
      }`
    );
    console.log(`🔍 Is final: ${transcriptData.is_final}`);
    console.log(`🔍 Confidence: ${transcriptData.confidence}`);
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
            console.log("🎵 Audio buffer size:", audioBuffer.length, "bytes");

            // Send TTS audio to the bot to speak in the call
            const success = await sendAudioToBot(audioBuffer);

            if (success) {
              console.log("🗣️ Bot will now speak the response in the call!");
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

    // Respond with 200 OK to acknowledge receipt
    res.status(200).json({ message: "Transcript received successfully" });
  } catch (error) {
    console.error("❌ Failed to process webhook:", error);
    res.status(500).json({ error: "Failed to process transcript" });
  }
});

// Start the webhook server
app.listen(PORT, () => {
  console.log(`✅ Webhook server started on port ${PORT}`);
  console.log(`📡 Ready to receive transcript webhooks from Recall AI`);
  console.log(`🔗 Webhook URL: http://localhost:${PORT}/transcript`);
  console.log(`💡 Use ngrok to expose this URL publicly: ngrok http ${PORT}`);
});
