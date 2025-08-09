import { startRecallBot } from "./recall";
import "./ws";

async function main() {
  const meetingUrl = "https://meet.google.com/vji-wwvm-kkd";
  const { botId } = await startRecallBot(meetingUrl);
  if (!botId) {
    console.log("❌ Failed to start bot");
    return;
  }
  console.log(
    "✅ WebSocket server is running and ready to receive transcripts..."
  );
  console.log("📡 Recall AI will send transcripts to our WebSocket server");
  console.log("📝 Transcripts will be processed by LLM automatically");
}

main();
