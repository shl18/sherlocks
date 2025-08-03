import { createClient } from "@deepgram/sdk";
import { WebSocket } from "ws";

const deepgramClient = createClient(process.env.DEEPGRAM_API_KEY);

export async function streamRecallToDeepgram(recallAudioUrl: string) {
  const deepgramConnection = deepgramClient.listen.live({
    model: "nova-2",
    smart_format: true,
    language: "en-US",
    punctuate: true,
    interim_results: false,
  });

  deepgramConnection.on("open", () => {
    console.log("Deepgram socket opened");
  });

  deepgramConnection.on("transcriptRecieced", (data: any) => {
    const transcript = JSON.parse(data).channel?.alternatives[0]?.transcript;
    if (transcript) {
      console.log("transcript recieved", transcript);
      //send transcript to llm
    }
  });

  deepgramConnection.on("error", (err: any) => {
    console.error("Deepgram error:", err);
  });

  //connnect to recall audio stream
  const recallSocket = new WebSocket(recallAudioUrl);
  recallSocket.on("open", () => {
    console.log("🎧 Connected to Recall audio");
  });

  recallSocket.on("message", (audioChunk) => {
    deepgramConnection.send(audioChunk as any);
  });

  recallSocket.on("close", () => {
    console.log("🔌 Recall audio stream closed");
    deepgramConnection.finish();
  });
}
