// import { convertWavToMp3, getAudioBuffer } from "./helper";
// import { createClient } from "@deepgram/sdk";

// const deepgramClient = createClient(process.env.DEEPGRAM_API_KEY);

//=======Deepgram TTS=======

// /**
//  * Convert text to speech using Deepgram TTS API and convert to MP3
//  * @param text - The text to convert to speech
//  * @returns MP3 audio buffer containing the generated speech
//  */
// // export async function textToSpeech(text: string): Promise<Buffer | null> {
// //   try {
// //     console.log("🔊 Converting text to speech:", text);

// //     // Make TTS request to Deepgram (generate WAV)
// //     const response = await deepgramClient.speak.request(
// //       { text },
// //       {
// //         model: "aura-2-hermes-en",
// //         encoding: "linear16",
// //         container: "wav",
// //         sample_rate: 16000,
// //       }
// //     );

// //     const stream = await response.getStream();

// //     if (stream) {
// //       const wavBuffer = await getAudioBuffer(stream);
// //       const mp3Buffer = await convertWavToMp3(wavBuffer);
// //       if (mp3Buffer) {
// //         return mp3Buffer;
// //       } else {
// //         console.error("Failed to convert WAV to MP3");
// //         return null;
// //       }
// //     } else {
// //       console.error(" Failed to get audio stream from Deepgram TTS");
// //       return null;
// //     }
// //   } catch (error) {
// //     console.error("Text-to-speech error:", error);
// //     return null;
// //   }
// // }
