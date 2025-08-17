import ffmpeg from "fluent-ffmpeg";

/**
 * Convert WAV buffer to MP3 buffer using streaming ffmpeg (much faster - no temp files!)
 * @param wavBuffer - The WAV audio buffer to convert
 * @returns MP3 audio buffer
 */

export async function convertWavToMp3(
  wavBuffer: Buffer
): Promise<Buffer | null> {
  return new Promise((resolve) => {
    try {
      console.log("🎵 Starting streaming WAV→MP3 conversion...");
      const startTime = Date.now();

      const mp3Chunks: Buffer[] = [];
      const { Readable, PassThrough } = require("stream");

      const inputStream = new Readable();
      inputStream.push(wavBuffer);
      inputStream.push(null);

      const outputStream = new PassThrough();

      const command = ffmpeg(inputStream)
        .inputFormat("wav")
        .audioCodec("libmp3lame")
        .audioBitrate(64)
        .audioFrequency(16000)
        .format("mp3")
        .on("start", (commandLine) => {
          console.log(
            "🔄 FFmpeg streaming command:",
            commandLine.substring(0, 100) + "..."
          );
        })
        .on("end", () => {
          const duration = Date.now() - startTime;
          console.log(`✅ Streaming conversion complete in ${duration}ms`);

          const finalMp3Buffer = Buffer.concat(mp3Chunks);
          console.log(`🎵 MP3 buffer size: ${finalMp3Buffer.length} bytes`);
          resolve(finalMp3Buffer);
        })
        .on("error", (error) => {
          console.error("❌ Streaming FFmpeg error:", error);
          resolve(null);
        });
      outputStream.on("data", (chunk: Buffer) => {
        mp3Chunks.push(chunk);
      });

      outputStream.on("error", (error: any) => {
        console.error("❌ Output stream error:", error);
        resolve(null);
      });

      command.pipe(outputStream, { end: true });
    } catch (error) {
      console.error("❌ Streaming conversion setup error:", error);
      resolve(null);
    }
  });
}

/**
 * Helper function to convert stream to audio buffer
 */

export async function getAudioBuffer(
  response: ReadableStream<Uint8Array>
): Promise<Buffer> {
  const reader = response.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const dataArray = chunks.reduce(
    (acc, chunk) => Uint8Array.from([...acc, ...chunk]),
    new Uint8Array(0)
  );

  return Buffer.from(dataArray.buffer);
}
