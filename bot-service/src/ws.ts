import WebSocket from "ws";
import { askLLM, textToSpeech } from "./llm";
import { sendAudioToBot } from "./recall";

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
async function processTextWithLLM(
  text: string,
  source: "transcript" | "chat"
): Promise<void> {
  try {
    console.log(`🧠 Processing ${source} text with LLM: "${text}"`);

    const reply = await askLLM(text);
    if (reply) {
      console.log(`🤖 LLM Reply for ${source}:`, reply);

      // Convert LLM response to speech
      console.log("🔊 Converting LLM response to speech...");
      const audioBuffer = await textToSpeech(reply);

      if (audioBuffer) {
        console.log("🎵 Audio buffer size:", audioBuffer.length, "bytes");

        // Send TTS audio to the bot to speak in the call
        const success = await sendAudioToBot(audioBuffer);

        if (success) {
          console.log(
            `🗣️ Bot will now speak the response for ${source} in the call!`
          );
        } else {
          console.log("❌ Failed to send audio to bot");
        }
      } else {
        console.log("❌ Failed to convert LLM response to speech");
      }
    } else {
      console.log(`🤖 LLM: No response generated for ${source}`);
    }
  } catch (error) {
    console.error(`❌ LLM processing error for ${source}:`, error);
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
