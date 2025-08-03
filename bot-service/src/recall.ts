import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const RECALL_API_KEY = process.env.RECALL_API_KEY;
const RECALL_API_URL = "https://us-west-2.recall.ai/api/v1/bot/";

export async function startRecallBot(meetingUrl: string) {
  try {
    const response = await axios.post(
      RECALL_API_URL,
      {
        meeting_url: meetingUrl,
        bot_name: "Sherlocks",
        platform: "google_meet",
        events: ["audio_mixed_raw.data"],
        recording_config: {
          audio_mixed_raw: {
            enabled: true,
          },
          realtime_endpoints: [
            {
              type: "websocket",
              url: " wss://9b3905f12a98.ngrok-free.app",
              events: ["audio_mixed_raw.data"],
            },
          ],
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
    console.log("✅ Bot joined!");
    console.log("bot_id:", id);
    console.log("meeting:", meeting_url);
    console.log("🔍 Full Recall API response:", response.data);

    // Audio stream will be provided via the websocket endpoint configured above
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
