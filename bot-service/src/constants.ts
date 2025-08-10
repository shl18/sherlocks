export type RecallRealtimeEndpoint = {
  type: "websocket";
  url: string;
  events: string[];
};

export type RecallConstants = {
  meeting_url: string;
  bot_name: string;
  platform: string;
  recording_config: {
    video_separate_png: { kind: "jpeg" | "png" };
    video_mixed_layout: string;
    transcript: {
      enabled: boolean;
      provider: { deepgram_streaming: { model: string } };
    };
    realtime_endpoints: RecallRealtimeEndpoint[];
  };
  output_media: { enabled: boolean };
  automatic_audio_output: {
    in_call_recording: { data: { kind: "mp3" | "wav"; b64_data: string } };
  };
  automatic_leave: {
    waiting_room_timeout: number;
    noone_joined_timeout: number;
  };
  automatic_video_output: { url: string };
};

export const BOT_CONFIG = (meetingUrl: string): RecallConstants => ({
  meeting_url: meetingUrl,
  bot_name: "Sherlocks",
  platform: "google_meet",
  recording_config: {
    video_separate_png: { kind: "jpeg" },
    video_mixed_layout: "gallery_view_v2",
    transcript: {
      enabled: true,
      provider: { deepgram_streaming: { model: "nova-2" } },
    },
    realtime_endpoints: [
      {
        type: "websocket",
        url: "wss://7f97ba465c79.ngrok-free.app",
        events: [
          "transcript.data",
          "participant_events.chat_message",
          "video_separate_png.data",
        ],
      },
    ],
  },
  output_media: { enabled: true },
  automatic_audio_output: {
    in_call_recording: { data: { kind: "mp3", b64_data: "base64_data" } },
  },
  automatic_leave: { waiting_room_timeout: 120, noone_joined_timeout: 300 },
  automatic_video_output: { url: "" },
});
