import axios from "axios";
import { convertWavToMp3 } from "../../lib/helper";

export type HumeVoiceSpec = {
  id?: string;
  name?: string;
  provider?: string; // defaults to CUSTOM_VOICE on Hume side
};

export async function textToSpeech(
  text: string,
  voice?: HumeVoiceSpec
): Promise<Buffer | null> {
  try {
    const apiKey = process.env.HUME_API_KEY?.trim();
    if (!apiKey) {
      console.error("❌ HUME_API_KEY is not set");
      return null;
    }

    const useVoice: HumeVoiceSpec | undefined =
      voice ||
      (process.env.HUME_VOICE_ID || process.env.HUME_VOICE_NAME
        ? {
            id: process.env.HUME_VOICE_ID || undefined,
            name: process.env.HUME_VOICE_NAME || undefined,
          }
        : undefined);

    const url = "https://api.hume.ai/v0/tts";

    const payload: any = {
      utterances: [
        {
          text,
          ...(useVoice ? { voice: useVoice } : {}),
        },
      ],
    };

    const headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "audio/wav, application/json",
    } as const;

    const resp = await axios.post(url, payload, {
      headers,
      responseType: "arraybuffer",
      validateStatus: () => true,
    });

    if (resp.status >= 400) {
      const textSnippet = Buffer.from(resp.data || "")
        .toString("utf8")
        .slice(0, 400);
      console.error(
        `❌ Hume TTS error ${resp.status}: ${resp.statusText} ${textSnippet}`
      );
      return null;
    }

    const contentType = String(
      resp.headers["content-type"] || ""
    ).toLowerCase();

    if (contentType.startsWith("audio/")) {
      const wavBuffer = Buffer.from(resp.data);
      const mp3 = await convertWavToMp3(wavBuffer);
      if (!mp3) {
        console.error("❌ Failed to convert WAV to MP3");
        return null;
      }
      return mp3;
    }

    try {
      const jsonText = Buffer.from(resp.data).toString("utf8");
      const json = JSON.parse(jsonText);

      let wavB64: string | null =
        json?.audio?.wav_b64 ||
        json?.audio_b64 ||
        json?.utterances?.[0]?.audio?.wav_b64 ||
        json?.utterances?.[0]?.audio ||
        null;

      if (!wavB64 || typeof wavB64 !== "string") {
        console.error("❌ Hume TTS JSON did not contain expected audio data");
        return null;
      }
      if (wavB64.startsWith("data:")) {
        const comma = wavB64.indexOf(",");
        wavB64 = comma >= 0 ? wavB64.slice(comma + 1) : wavB64;
      }
      const wavBuffer = Buffer.from(wavB64, "base64");
      const mp3 = await convertWavToMp3(wavBuffer);
      if (!mp3) {
        console.error("❌ Failed to convert WAV to MP3");
        return null;
      }
      return mp3;
    } catch (e) {
      console.error("❌ Failed to parse Hume TTS JSON response:", e);
      return null;
    }
  } catch (error) {
    console.error("❌ Text-to-speech error (Hume):", error);
    return null;
  }
}
