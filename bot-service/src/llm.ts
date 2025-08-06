/**
 * Dummy LLM that responds to specific keywords
 * This is a simple implementation that listens for "hello" and responds appropriately
 */
export async function askLLM(transcript: string): Promise<string | null> {
  // Convert transcript to lowercase for case-insensitive matching
  const normalizedTranscript = transcript.toLowerCase().trim();

  console.log("🎧 Processing transcript:", transcript);

  // Check if the transcript contains "hello"
  if (normalizedTranscript.includes("hello")) {
    const reply = "hi I am sherlocks how can I help you";
    console.log("🤖 LLM Response:", reply);
    return reply;
  }

  // For now, we'll only respond to "hello"
  // You can add more trigger words and responses here
  console.log("🤐 No response triggered for this transcript");
  return null;
}
