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
      },
      {
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          Authorization: `Token ${RECALL_API_KEY}`,
        },
      }
    );

    const { participant_id, audio_url } = response.data;
    console.log(` Bot joined! ID: ${participant_id}`);
    console.log(` Audio stream URL: ${audio_url}`);

    return { participantId: participant_id, audioUrl: audio_url };
  } catch (error: any) {
    console.error(
      " Failed to start bot:",
      error.response?.data || error.message
    );
    throw error;
  }
}
