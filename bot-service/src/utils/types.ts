export type TranscriptDataEvent = {
  event: "transcript.data";
  data: {
    data: {
      words: Array<{
        text: string;
        start_timestamp: {
          relative: number;
          absolute: string;
        };
        end_timestamp: {
          relative: number;
          absolute: string;
        };
      }>;
      participant: {
        id: number;
        name: string;
        is_host: boolean;
        platform: string;
        extra_data?: any;
      };
    };
    transcript: {
      id: string;
      metadata: any;
    };
    realtime_endpoint: {
      id: string;
      metadata: any;
    };
    recording: {
      id: string;
      metadata: any;
    };
    bot: {
      id: string;
      metadata: any;
    };
  };
};

export type ChatMessageEvent = {
  event: "participant_events.chat_message";
  data: {
    data: {
      participant: {
        name: string;
        is_host: boolean;
        platform: string;
        extra_data?: any;
      };
      timestamp: {
        relative: number;
        absolute: string;
      };
      data: {
        text: string;
        to: string;
      };
    };
    participant_events: {
      id: string;
      metadata: any;
    };
    realtime_endpoint: {
      id: string;
      metadata: any;
    };
    recording: {
      id: string;
      metadata: any;
    };
    bot: {
      id: string;
      metadata: any;
    };
  };
};

export type VideoSeparatePngEvent = {
  event: "video_separate_png.data";
  data: {
    data: {
      buffer: string; // base64 encoded png at 2fps with resolution 360x640
      timestamp: {
        relative: number;
        absolute: string;
      };
      type: "webcam" | "screenshare";
      participant: {
        id: number;
        name: string | null;
        is_host: boolean;
        platform: string | null;
        extra_data: object;
      };
    };
    realtime_endpoint: {
      id: string;
      metadata: object;
    };
    video_separate: {
      id: string;
      metadata: object;
    };
    recording: {
      id: string;
      metadata: object;
    };
    bot: {
      id: string;
      metadata: object;
    };
  };
};

export interface ConversationContext {
  recentIntents: string[];
  lastResponseTime: number;
}

// ===== Video Script Types =====
export type VideoScriptSegment = {
  id: string;
  start_ms: number; // inclusive
  end_ms: number; // exclusive
  background_url: string;
  narration: string;
};

export type VideoScript = {
  total_duration_ms: number;
  segments: VideoScriptSegment[];
};

export interface BotState {
  isSpeaking: boolean;
  currentSpeechId: string | null;
  speechStartTime: number | null;
  estimatedSpeechDuration: number | null;
  speechQueue: string[];
  isProcessing: boolean;
  lastSpeechText: string | null;
}
