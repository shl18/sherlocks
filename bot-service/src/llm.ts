import { OpenAI } from "openai";
import dotenv from "dotenv";
dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function askLLM(transcript: string) {
  const res = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [
      {
        role: "system",
        content: "You are a helpful assistant inside a Google Meet call.",
      },
      { role: "user", content: transcript },
    ],
  });

  const reply = res.choices[0].message.content;
  console.log(" LLM:", reply);
  return reply;
}
