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
  // Make output_media optional so we don't screenshare by default
  output_media?: {
    screenshare: { kind: string; config: { url: string } };
  };
  // automatic_audio_output: {
  //   in_call_recording: { data: { kind: "mp3" | "wav"; b64_data: string } };
  // };
  automatic_leave: {
    waiting_room_timeout: number;
    noone_joined_timeout: number;
  };
  // automatic_video_output: { url: string };
};

export const SCREENSHARE_BASE_URL = "https://counter-ruby-phi.vercel.app";
export const USE_HASH_ROUTES =
  (process.env.USE_HASH_ROUTES || "false").toLowerCase() === "true";

export const ENABLE_CACHE_BUST =
  (process.env.ENABLE_CACHE_BUST || "true").toLowerCase() === "true";

// Use a single-stream screenshare by embedding the entire video script into a query param
// The webpage should read ?script=<base64> and switch views on the client at frame times
export const USE_EMBEDDED_SCRIPT =
  (process.env.USE_EMBEDDED_SCRIPT || "false").toLowerCase() === "true";

export const BACKGROUND_ROUTES: Record<string, string> = {
  home: "/",
  github: "/github",
  jenkins: "/jenkins",
  jerkin: "/jenkins", // common typo alias
  datadog: "/datadog",
  grafana: "/datadog", // map grafana tag to same route if you prefer
  kubernetes: "/kubernetes",
  k8s: "/kubernetes",
  rds: "/rds",
  db: "/rds",
  database: "/rds",
  redis: "/redis",
  // aliases
  logs: "/datadog",
  pr: "/github",
  pr_details: "/github",
};

export function resolveBackgroundUrl(tagOrUrl: string): string {
  const input = String(tagOrUrl || "").trim();
  if (!input) return `${SCREENSHARE_BASE_URL}${BACKGROUND_ROUTES.home}`;
  if (input.startsWith("http://") || input.startsWith("https://")) return input;
  let path = input;
  if (!input.startsWith("/")) {
    const alias = BACKGROUND_ROUTES[input.toLowerCase()];
    path = alias || BACKGROUND_ROUTES.home;
  }
  if (USE_HASH_ROUTES) {
    const normalized = path.startsWith("/") ? path : `/${path}`;
    const url = `${SCREENSHARE_BASE_URL}/#${normalized}`;
    return ENABLE_CACHE_BUST
      ? `${url}${url.includes("?") ? "&" : "?"}ts=${Date.now()}`
      : url;
  }
  const url = `${SCREENSHARE_BASE_URL}${path}`;
  return ENABLE_CACHE_BUST
    ? `${url}${url.includes("?") ? "&" : "?"}ts=${Date.now()}`
    : url;
}

//  a small script payload that the webpage can execute to change views client-side
export type EmbeddedFrame = { start_ms: number; end_ms: number; view: string };
export type EmbeddedScriptPayload = { frames: EmbeddedFrame[] };

function viewFromBackgroundUrl(pathOrTag: string): string {
  const key = (pathOrTag || "/").toLowerCase();
  if (key.includes("github")) return "github";
  if (key.includes("jenkins")) return "jenkins";
  if (key.includes("datadog") || key.includes("grafana")) return "grafana"; // map datadog/grafana as needed
  if (key.includes("kubernetes") || key.includes("k8s")) return "kubernetes";
  if (key.includes("redis")) return "redis";
  if (key.includes("rds") || key.includes("database") || key.includes("db"))
    return "rds";
  return "home";
}

export function scriptPayloadFromVideoScript(script: {
  segments: { start_ms: number; end_ms: number; background_url?: string }[];
}): EmbeddedScriptPayload {
  const frames: EmbeddedFrame[] = (script.segments || []).map((s) => ({
    start_ms: Math.max(0, Number(s.start_ms) || 0),
    end_ms: Math.max(0, Number(s.end_ms) || 0),
    view: viewFromBackgroundUrl(String(s.background_url || "/")),
  }));
  return { frames };
}

export function buildScreenshareUrlWithScript(script: {
  segments: { start_ms: number; end_ms: number; background_url?: string }[];
}): string {
  const payload = scriptPayloadFromVideoScript(script);
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const base = SCREENSHARE_BASE_URL;
  const sep = base.includes("?") ? "&" : "?";
  const url = `${base}${sep}script=${b64}`;
  return ENABLE_CACHE_BUST ? `${url}&ts=${Date.now()}` : url;
}

// ===== Screen OCR session config =====
export const SCREEN_OCR = {
  enabledByDefault: false, // keep off unless explicitly enabled by voice/chat
  throttleMs: 3000, // process at most one frame every 3s
  sessionTimeoutMs: 2 * 60 * 1000, // auto-stop after 2 minutes
};

export const SCREEN_OCR_PHRASES = {
  start: [
    "see my screenshare",
    "analyze my screen",
    "look at my screen",
    "check my screen",
    "view my screen",
    "help me debug from screen",
    "read my screen",
    "what do you see on my screen",
    "analyze this screen",
    "look at this",
  ],
  stop: ["stop analyzing", "stop screen analysis", "you can stop now"],
};

export const SCREENSHARE_PHRASES = {
  start: [
    "start screenshare",
    "start screen share",
    "share your screen",
    "start sharing",
    "show the screen",
    "start showing",
    "enable screenshare",
    "turn on screenshare",
  ],
  stop: [
    "stop screenshare",
    "stop screen share",
    "stop the screenshare",
    "please stop the screenshare",
    "turn off screenshare",
    "disable screenshare",
    "stop sharing",
    "you can stop sharing",
  ],
};

export const MUTE_PHRASES = {
  start: [
    "mute",
    "go mute",
    "on mute",
    "be quiet",
    "please be quiet",
    "shut up",
    "please shut up",
    "stop talking",
    "stop speaking",
    "don't talk",
    "do not talk",
    "no talking",
    "be silent",
    "stay silent",
    "stop it",
    "stop it i got it",
    "i got it",
    "quit talking",
    "please stop",
  ],
  stop: [
    "unmute",
    "you can talk",
    "you can speak now",
    "start talking",
    "resume talking",
    "resume speaking",
    "please speak",
    "talk now",
  ],
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
        url: "wss://7dc1b1176697.ngrok-free.app",
        events: [
          "transcript.data",
          "participant_events.chat_message",
          "video_separate_png.data",
        ],
      },
    ],
  },
  // automatic_audio_output: {
  //   in_call_recording: { data: { kind: "mp3", b64_data: "base64_data" } },
  // },
  automatic_leave: { waiting_room_timeout: 120, noone_joined_timeout: 300 },
  // automatic_video_output: { url: "" },
});
