import axios from "axios";
import dotenv from "dotenv";
import { BOT_CONFIG } from "./constants";
import { error } from "console";

dotenv.config();

const RECALL_API_KEY = process.env.RECALL_API_KEY;
const RECALL_API_URL = "https://us-west-2.recall.ai/api/v1/bot/";

let currentBotId: string | null = null;

export async function startRecallBot(meetingUrl: string) {
  try {
    const response = await axios.post(RECALL_API_URL, BOT_CONFIG(meetingUrl), {
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        Authorization: `Token ${RECALL_API_KEY}`,
      },
    });

    const { id, meeting_url } = response.data;
    currentBotId = id;
    console.log("Bot joined!");
    console.log("bot_id:", id);
    console.log("meeting:", meeting_url);
    console.log(" Full Recall API response:", response.data);

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

//bot screenshare

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function switchScreenshare(newUrl: string) {
  if (!currentBotId) {
    console.error(" No bot ID available for screenshare");
    return error;
  }

  const url = `${RECALL_API_URL}${currentBotId}/output_media/`;
  const headers = {
    accept: "application/json",
    "content-type": "application/json",
    Authorization: `Token ${RECALL_API_KEY}`,
  };

  // Use explicit screenshare target per Recall API spec
  const postPayload = {
    screenshare: { kind: "webpage", config: { url: newUrl } },
  } as const;
  const deletePayload = { screenshare: true } as const;

  // Up to 3 attempts with small backoff and a DELETE between attempts
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await axios.delete(url, { headers, data: deletePayload });
      console.log("⏹️ Stopped current media stream");
    } catch (delErr: any) {
      // Some accounts may not have an active stream; ignore 404/400 during delete
      console.warn(
        "⚠️ Delete output_media returned:",
        delErr.response?.status || delErr.message
      );
    }

    // tiny delay to let Recall settle
    await sleep(250);

    try {
      const response = await axios.post(url, postPayload, { headers });
      console.log("▶ Streaming new webpage:", newUrl);
      return response;
    } catch (postErr: any) {
      console.error(
        `❌ Failed to start bot screenshare (attempt ${attempt}/3):`,
        postErr.response?.status,
        postErr.response?.data || postErr.message
      );
      await sleep(250 * attempt);
    }
  }
  console.error("❌ Exhausted retries for starting screenshare");
}

/**
 * Stop any active screenshare/output_media stream for the current bot.
 */
export async function stopScreenshare(): Promise<boolean> {
  if (!currentBotId) {
    console.error("❌ No bot ID available to stop screenshare");
    return false;
  }
  try {
    const url = `${RECALL_API_URL}${currentBotId}/output_media/`;
    const headers = {
      accept: "application/json",
      "content-type": "application/json",
      Authorization: `Token ${RECALL_API_KEY}`,
    };
    await axios.delete(url, { headers, data: { screenshare: true } });
    console.log("⏹️ Stopped current screenshare/output media");
    return true;
  } catch (e: any) {
    const status = e?.response?.status;
    if (status === 404 || status === 400) {
      console.warn("ℹ️ No active screenshare to stop (", status, ")");
      return true;
    }
    console.error("❌ Failed to stop screenshare:", status, e?.message);
    return false;
  }
}

/**
 * Fetch current output media for the active bot.
 */
export async function getCurrentOutputMedia(): Promise<
  any[] | { methodNotAllowed: true } | null
> {
  if (!currentBotId) {
    console.error(" No bot ID available for getCurrentOutputMedia");
    return null;
  }
  try {
    const resp = await axios.get(
      `${RECALL_API_URL}${currentBotId}/output_media/`,
      {
        headers: {
          accept: "application/json",
          Authorization: `Token ${RECALL_API_KEY}`,
        },
        timeout: 5000,
      }
    );
    return Array.isArray(resp.data) ? resp.data : null;
  } catch (e: any) {
    if (e?.response?.status === 405) {
      console.warn(
        "ℹ️ Recall GET /output_media not allowed (405). Skipping confirmation polling."
      );
      return { methodNotAllowed: true } as const;
    }
    console.error(
      "❌ Failed to fetch output media:",
      e.response?.status,
      e.response?.data || e.message
    );
    return null;
  }
}

function normalizeUrlForCompare(url: string): string {
  try {
    const u = new URL(url);
    // Ignore cache-busting ts param if present
    u.searchParams.delete("ts");
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Poll Recall until the webpage output_media matches the expected URL (ignoring ts param).
 */
export async function waitForScreenshareUrl(
  expectedUrl: string,
  timeoutMs: number = 8000,
  intervalMs: number = 400
): Promise<boolean> {
  const target = normalizeUrlForCompare(expectedUrl);
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const items = await getCurrentOutputMedia();
    if ((items as any)?.methodNotAllowed) {
      // Cannot confirm via GET; return false to allow fallback delay path
      return false;
    }
    if (items && Array.isArray(items) && items.length) {
      const current = items.find((m: any) => m?.kind === "webpage");
      const currentUrl = current?.config?.url;
      if (currentUrl && normalizeUrlForCompare(currentUrl) === target) {
        return true;
      }
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
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
 * Stop current audio output by sending a very short silence
 * This effectively cancels any ongoing audio playback
 */
export async function stopBotAudio(): Promise<boolean> {
  if (!currentBotId) {
    console.error("❌ No bot ID available for audio stop");
    return false;
  }

  try {
    console.log("🔇 Stopping bot audio output...");

    // Import the textToSpeech function to generate silence
    const { textToSpeech } = await import("./llm");

    // Generate a very short silence by using a single character
    const silenceBuffer = await textToSpeech(".");

    if (!silenceBuffer) {
      console.error("❌ Failed to generate silence audio");
      return false;
    }

    const base64Silence = silenceBuffer.toString("base64");

    const url = `${RECALL_API_URL}${currentBotId}/output_audio/`;

    const payload = {
      kind: "mp3",
      b64_data: base64Silence,
    };

    const response = await axios.post(url, payload, {
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        Authorization: `Token ${RECALL_API_KEY}`,
      },
      timeout: 5000, // 5 second timeout for stop command
    });

    console.log("✅ Bot audio stopped successfully!");
    return true;
  } catch (error: any) {
    console.error("❌ Failed to stop bot audio:");
    console.error("❌ Error:", error.message);
    return false;
  }
}

/**
 * Get the current bot ID
 */
export function getCurrentBotId(): string | null {
  return currentBotId;
}
