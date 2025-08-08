import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const RECALL_API_KEY = process.env.RECALL_API_KEY;
const RECALL_API_URL = "https://us-west-2.recall.ai/api/v1/bot/";

let currentBotId: string | null = null;

export async function startRecallBot(meetingUrl: string) {
  try {
    const response = await axios.post(
      RECALL_API_URL,
      {
        meeting_url: meetingUrl,
        bot_name: "Sherlocks",
        platform: "google_meet",
        recording_config: {
          transcript: {
            enabled: true,
            provider: {
              deepgram_streaming: {
                model: "nova-2",
              },
            },
          },
          realtime_endpoints: [
            {
              type: "websocket",
              url: "wss://a63971060c54.ngrok-free.app",
              events: ["transcript.data", "participant_events.chat_message"],
            },
          ],
        },

        output_media: {
          enabled: true,
        },
        automatic_audio_output: {
          in_call_recording: {
            data: {
              kind: "mp3",
              b64_data: "base64_data",
            },
          },
        },
        automatic_leave: {
          waiting_room_timeout: 120,
          noone_joined_timeout: 300,
        },
        automatic_video_output: {
          url: "",
        },
      },
      {
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          Authorization: `Token ${RECALL_API_KEY}`,
        },
      }
    );

    const { id, meeting_url } = response.data;
    currentBotId = id; // Store bot ID for audio output
    console.log("✅ Bot joined!");
    console.log("bot_id:", id);
    console.log("meeting:", meeting_url);
    console.log("🔍 Full Recall API response:", response.data);

    return {
      botId: id,
      meetingInfo: meeting_url,
    };
  } catch (error: any) {
    console.error(
      " Failed to start bot:",
      error.response?.data || error.message
    );
    throw error;
  }
}

/**
 * Send audio data to the bot to speak in the call
 * @param audioBuffer - The audio buffer to send (should be base64 encoded)
 */
export async function sendAudioToBot(audioBuffer: Buffer): Promise<boolean> {
  if (!currentBotId) {
    console.error("❌ No bot ID available for audio output");
    return false;
  }

  try {
    console.log("🎤 Sending audio to bot for speech output...");
    console.log("🔍 Bot ID:", currentBotId);
    console.log("🔍 Audio buffer size:", audioBuffer.length);

    // Convert buffer to base64
    const base64Audio = audioBuffer.toString("base64");
    console.log("🔍 Base64 audio length:", base64Audio.length);

    // Send audio to the dedicated output_audio endpoint
    const url = `${RECALL_API_URL}${currentBotId}/output_audio/`;
    console.log("🔍 API URL:", url);

    const payload = {
      kind: "mp3",
      b64_data: base64Audio,
    };

    console.log("🔍 Payload structure:", {
      kind: payload.kind,
      b64_data_length: payload.b64_data.length,
    });

    const response = await axios.post(url, payload, {
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        Authorization: `Token ${RECALL_API_KEY}`,
      },
      timeout: 10000, // 10 second timeout
    });

    console.log("✅ Audio sent to bot successfully!");
    console.log("🔍 Response status:", response.status);
    console.log("🔍 Response headers:", response.headers);
    console.log("🔍 Bot audio response:", response.data);
    return true;
  } catch (error: any) {
    console.error("❌ Failed to send audio to bot:");
    console.error("❌ Error status:", error.response?.status);
    console.error("❌ Error headers:", error.response?.headers);
    console.error("❌ Error data:", error.response?.data);
    console.error("❌ Error message:", error.message);
    console.error("❌ Full error:", error);
    return false;
  }
}

/**
 * Get the current bot ID
 */
export function getCurrentBotId(): string | null {
  return currentBotId;
}
