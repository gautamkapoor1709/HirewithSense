import OpenAI, { toFile } from 'openai';
import { env } from '../../config/env.js';
import { aiCalls } from '../../plugins/metrics.js';

/**
 * Speech provider: transcription and text-to-speech over the OpenAI audio API shape. Works with
 * OpenAI itself and with self-hosted engines that implement the same endpoints (Speaches with
 * faster-whisper + Kokoro, LocalAI, …). Configured independently of the language model.
 */
export interface SpeechProvider {
  readonly name: string;
  readonly configured: boolean;
  readonly sttModel: string | null;
  readonly ttsModel: string | null;
  readonly voice: string | null;
  transcribe(audio: Buffer, filename: string, mime: string): Promise<string>;
  speak(text: string): Promise<{ audio: Buffer; mime: string }>;
}

interface ResolvedConfig {
  baseURL?: string;
  apiKey: string;
  sttModel: string;
  ttsModel: string;
  voice: string;
  format: 'mp3' | 'wav' | 'opus' | 'aac' | 'flac';
  timeout: number;
  label: string;
}

/** Resolve SPEECH_* with fallback to the legacy AI_ENABLE_AUDIO + AI_* configuration. */
export function resolveSpeechConfig(): ResolvedConfig | null {
  const e = env();
  if (e.SPEECH_PROVIDER === 'openai_compatible') {
    const apiKey = e.SPEECH_API_KEY ?? e.AI_API_KEY ?? 'not-needed';
    return {
      baseURL: e.SPEECH_BASE_URL,
      apiKey,
      sttModel: e.SPEECH_STT_MODEL,
      ttsModel: e.SPEECH_TTS_MODEL,
      voice: e.SPEECH_TTS_VOICE,
      format: e.SPEECH_TTS_FORMAT,
      timeout: e.SPEECH_TIMEOUT_MS,
      label: e.SPEECH_BASE_URL ? `speech(${safeHost(e.SPEECH_BASE_URL)})` : 'speech(openai)',
    };
  }
  if (e.AI_ENABLE_AUDIO && e.AI_PROVIDER === 'openai_compatible' && e.AI_API_KEY) {
    return {
      baseURL: e.AI_BASE_URL,
      apiKey: e.AI_API_KEY,
      sttModel: e.AI_STT_MODEL ?? e.SPEECH_STT_MODEL,
      ttsModel: e.AI_TTS_MODEL ?? e.SPEECH_TTS_MODEL,
      voice: e.AI_TTS_VOICE ?? e.SPEECH_TTS_VOICE,
      format: e.SPEECH_TTS_FORMAT,
      timeout: e.AI_TIMEOUT_MS,
      label: e.AI_BASE_URL ? `speech(${safeHost(e.AI_BASE_URL)})` : 'speech(openai)',
    };
  }
  return null;
}

const safeHost = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return 'custom';
  }
};

const MIME: Record<ResolvedConfig['format'], string> = { mp3: 'audio/mpeg', wav: 'audio/wav', opus: 'audio/ogg', aac: 'audio/aac', flac: 'audio/flac' };

class OpenAiCompatibleSpeech implements SpeechProvider {
  readonly name: string;
  readonly configured = true;
  readonly sttModel: string;
  readonly ttsModel: string;
  readonly voice: string;
  private readonly client: OpenAI;
  private readonly format: ResolvedConfig['format'];

  constructor(private readonly cfg: ResolvedConfig) {
    this.name = cfg.label;
    this.sttModel = cfg.sttModel;
    this.ttsModel = cfg.ttsModel;
    this.voice = cfg.voice;
    this.format = cfg.format;
    this.client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL, timeout: cfg.timeout, maxRetries: 1 });
  }

  async transcribe(audio: Buffer, filename: string, mime: string): Promise<string> {
    try {
      const file = await toFile(audio, filename, { type: mime });
      const res = await this.client.audio.transcriptions.create({ file, model: this.sttModel, response_format: 'json' });
      aiCalls.inc({ task: 'speech.transcribe', provider: this.name, outcome: 'ok' });
      return (res as { text: string }).text ?? '';
    } catch (err) {
      aiCalls.inc({ task: 'speech.transcribe', provider: this.name, outcome: 'error' });
      throw err;
    }
  }

  async speak(text: string): Promise<{ audio: Buffer; mime: string }> {
    try {
      const res = await this.client.audio.speech.create({
        model: this.ttsModel,
        voice: this.voice,
        input: text.slice(0, 4000),
        response_format: this.format,
      });
      aiCalls.inc({ task: 'speech.speak', provider: this.name, outcome: 'ok' });
      return { audio: Buffer.from(await res.arrayBuffer()), mime: MIME[this.format] };
    } catch (err) {
      aiCalls.inc({ task: 'speech.speak', provider: this.name, outcome: 'error' });
      throw err;
    }
  }
}

class NoSpeech implements SpeechProvider {
  readonly name = 'none';
  readonly configured = false;
  readonly sttModel = null;
  readonly ttsModel = null;
  readonly voice = null;
  async transcribe(): Promise<string> {
    throw new Error('Server-side transcription is not configured (set SPEECH_PROVIDER)');
  }
  async speak(): Promise<{ audio: Buffer; mime: string }> {
    throw new Error('Server-side speech is not configured (set SPEECH_PROVIDER)');
  }
}

let provider: SpeechProvider | null = null;

export function getSpeech(): SpeechProvider {
  if (provider) return provider;
  const cfg = resolveSpeechConfig();
  provider = cfg ? new OpenAiCompatibleSpeech(cfg) : new NoSpeech();
  return provider;
}

/** Test seam. */
export function resetSpeech(): void {
  provider = null;
}
