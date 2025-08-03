import { startRecallBot } from "./recall";

async function main() {
  const meetingUrl = "https://meet.google.com/xom-jpuq-htt";
  const { participantId, audioUrl } = await startRecallBot(meetingUrl);
}

main();
