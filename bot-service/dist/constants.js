"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BOT_CONFIG = exports.SCREENSHARE_PHRASES = exports.SCREEN_OCR_PHRASES = exports.SCREEN_OCR = exports.BACKGROUND_ROUTES = exports.USE_EMBEDDED_SCRIPT = exports.ENABLE_CACHE_BUST = exports.USE_HASH_ROUTES = exports.SCREENSHARE_BASE_URL = void 0;
exports.resolveBackgroundUrl = resolveBackgroundUrl;
exports.scriptPayloadFromVideoScript = scriptPayloadFromVideoScript;
exports.buildScreenshareUrlWithScript = buildScreenshareUrlWithScript;
// Base URL for the Vercel screenshare web app that renders different backgrounds
exports.SCREENSHARE_BASE_URL = "https://counter-ruby-phi.vercel.app";
// If true, build URLs like https://app/#/datadog instead of https://app/datadog
// This avoids server-side 404s on static deployments. Your web app must read location.hash.
exports.USE_HASH_ROUTES = (process.env.USE_HASH_ROUTES || "false").toLowerCase() === "true";
// Append a unique cache-busting query param to force fresh loads on the bot's browser
exports.ENABLE_CACHE_BUST = (process.env.ENABLE_CACHE_BUST || "true").toLowerCase() === "true";
// Use a single-stream screenshare by embedding the entire video script into a query param
// The webpage should read ?script=<base64> and switch views on the client at frame times
exports.USE_EMBEDDED_SCRIPT = (process.env.USE_EMBEDDED_SCRIPT || "false").toLowerCase() === "true";
// Logical routes that the LLM can reference as background_url path tags
exports.BACKGROUND_ROUTES = {
    home: "/",
    github: "/github",
    jenkins: "/jenkins",
    jerkin: "/jenkins", // common typo alias
    datadog: "/datadog",
    grafana: "/datadog", // map grafana tag to same route if you prefer
    // aliases
    logs: "/datadog",
    pr: "/github",
    pr_details: "/github",
};
function resolveBackgroundUrl(tagOrUrl) {
    const input = String(tagOrUrl || "").trim();
    if (!input)
        return `${exports.SCREENSHARE_BASE_URL}${exports.BACKGROUND_ROUTES.home}`;
    if (input.startsWith("http://") || input.startsWith("https://"))
        return input;
    // If path-like, use as-is; if alias-like, map to route
    let path = input;
    if (!input.startsWith("/")) {
        const alias = exports.BACKGROUND_ROUTES[input.toLowerCase()];
        path = alias || exports.BACKGROUND_ROUTES.home;
    }
    if (exports.USE_HASH_ROUTES) {
        // Normalize to /#/<route>
        const normalized = path.startsWith("/") ? path : `/${path}`;
        const url = `${exports.SCREENSHARE_BASE_URL}/#${normalized}`;
        return exports.ENABLE_CACHE_BUST
            ? `${url}${url.includes("?") ? "&" : "?"}ts=${Date.now()}`
            : url;
    }
    const url = `${exports.SCREENSHARE_BASE_URL}${path}`;
    return exports.ENABLE_CACHE_BUST
        ? `${url}${url.includes("?") ? "&" : "?"}ts=${Date.now()}`
        : url;
}
function viewFromBackgroundUrl(pathOrTag) {
    const key = (pathOrTag || "/").toLowerCase();
    if (key.includes("github"))
        return "github";
    if (key.includes("jenkins"))
        return "jenkins";
    if (key.includes("datadog") || key.includes("grafana"))
        return "grafana"; // map datadog/grafana as needed
    return "home";
}
function scriptPayloadFromVideoScript(script) {
    const frames = (script.segments || []).map((s) => ({
        start_ms: Math.max(0, Number(s.start_ms) || 0),
        end_ms: Math.max(0, Number(s.end_ms) || 0),
        view: viewFromBackgroundUrl(String(s.background_url || "/")),
    }));
    return { frames };
}
function buildScreenshareUrlWithScript(script) {
    const payload = scriptPayloadFromVideoScript(script);
    const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const base = exports.SCREENSHARE_BASE_URL;
    const sep = base.includes("?") ? "&" : "?";
    const url = `${base}${sep}script=${b64}`;
    return exports.ENABLE_CACHE_BUST ? `${url}&ts=${Date.now()}` : url;
}
// ===== Screen OCR session config =====
exports.SCREEN_OCR = {
    enabledByDefault: false, // keep off unless explicitly enabled by voice/chat
    throttleMs: 3000, // process at most one frame every 3s
    sessionTimeoutMs: 2 * 60 * 1000, // auto-stop after 2 minutes
};
exports.SCREEN_OCR_PHRASES = {
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
// Voice/chat phrases to explicitly control when the bot is allowed to screenshare
exports.SCREENSHARE_PHRASES = {
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
        "turn off screenshare",
        "disable screenshare",
        "stop sharing",
        "you can stop sharing",
    ],
};
const BOT_CONFIG = (meetingUrl) => ({
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
                url: "wss://13798a9d8d7c.ngrok-free.app",
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
exports.BOT_CONFIG = BOT_CONFIG;
