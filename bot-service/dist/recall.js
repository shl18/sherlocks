"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startRecallBot = startRecallBot;
const axios_1 = __importDefault(require("axios"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const RECALL_API_KEY = process.env.RECALL_API_KEY;
const RECALL_API_URL = "https://us-west-2.recall.ai/api/v1/bot/";
function startRecallBot(meetingUrl) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        try {
            const response = yield axios_1.default.post(RECALL_API_URL, {
                meeting_url: meetingUrl,
                bot_name: "Sherlocks",
                platform: "google_meet",
            }, {
                headers: {
                    accept: "application/json",
                    "content-type": "application/json",
                    Authorization: `Token ${RECALL_API_KEY}`,
                },
            });
            const { participant_id, audio_url } = response.data;
            console.log(` Bot joined! ID: ${participant_id}`);
            console.log(` Audio stream URL: ${audio_url}`);
            return { participantId: participant_id, audioUrl: audio_url };
        }
        catch (error) {
            console.error(" Failed to start bot:", ((_a = error.response) === null || _a === void 0 ? void 0 : _a.data) || error.message);
            throw error;
        }
    });
}
