import axios from "axios";

//elevenlabs

type ElevenLabsOptions = {
  voiceId?: string; // fallback to ELEVENLABS_VOICE_ID
  modelId?: string;
  stability?: number;
  similarityBoost?: number;
};

//MFZUKuGQUsGJPQjTS4wC
//eleven_v3_5

export async function textToSpeech(
  text: string,
  opts: ElevenLabsOptions = {}
): Promise<Buffer | null> {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  const voiceId = opts.voiceId || process.env.ELEVENLABS_VOICE_ID;
  const modelId =
    opts.modelId || process.env.ELEVENLABS_MODEL_ID || "eleven_v3_5";
  if (!apiKey || !voiceId) {
    console.error("Missing ELEVENLABS_API_KEY or ELEVENLABS_VOICE_ID");
    return null;
  }

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
  const payload = {
    text,
    model_id: modelId,
    voice_settings: {
      stability: opts.stability ?? 0.5,
      similarity_boost: opts.similarityBoost ?? 0.5,
    },
  };

  const resp = await axios.post(url, payload, {
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/wav",
    },
    responseType: "arraybuffer",
    validateStatus: () => true,
  });

  if (resp.status >= 400) {
    console.error(`ElevenLabs TTS error ${resp.status}: ${resp.statusText}`);
    return null;
  }
  return Buffer.from(resp.data); // MP3 bytes
}
