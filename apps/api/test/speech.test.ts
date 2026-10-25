import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadEnv } from '../src/config/env.js';
import { resetSpeech } from '../src/services/ai/speech.js';
import { auth, createApp, registerCandidate, truncateAll, type Session } from './helpers.js';

let app: FastifyInstance;
let cand: Session;
beforeAll(async () => {
  app = await createApp();
  await truncateAll();
  cand = await registerCandidate(app, 40);
});
afterAll(async () => app.close());
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SPEECH_PROVIDER;
  delete process.env.SPEECH_BASE_URL;
  loadEnv();
  resetSpeech();
});

describe('speech provider', () => {
  it('reports speech as unavailable and refuses audio routes when not configured', async () => {
    const status = await app.inject({ method: 'GET', url: '/api/v1/ai/status', headers: auth(cand) });
    expect(status.json().features.speech).toBe(false);
    expect(status.json().speech.provider).toBe('none');
    const speak = await app.inject({ method: 'POST', url: '/api/v1/ai/speak', headers: auth(cand), payload: { text: 'hello' } });
    expect(speak.statusCode).toBe(503);
  });

  it('streams synthesized audio and transcribes uploads through an OpenAI-compatible endpoint', async () => {
    process.env.SPEECH_PROVIDER = 'openai_compatible';
    process.env.SPEECH_BASE_URL = 'http://speech.local/v1';
    loadEnv();
    resetSpeech();
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      calls.push(url);
      if (url.endsWith('/audio/speech')) {
        const body = JSON.parse(String(init?.body));
        expect(body.model).toBe('gpt-4o-mini-tts');
        expect(body.input).toBe('Tell me about your project.');
        return new Response(new Uint8Array([73, 68, 51, 4, 0, 0]), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
      }
      if (url.endsWith('/audio/transcriptions')) {
        return new Response(JSON.stringify({ text: 'I built an order tracking service.' }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('not found', { status: 404 });
    }));

    const status = await app.inject({ method: 'GET', url: '/api/v1/ai/status', headers: auth(cand) });
    expect(status.json().features.speech).toBe(true);
    expect(status.json().speech.provider).toContain('speech.local');

    const speak = await app.inject({ method: 'POST', url: '/api/v1/ai/speak', headers: auth(cand), payload: { text: 'Tell me about your project.' } });
    expect(speak.statusCode).toBe(200);
    expect(speak.headers['content-type']).toBe('audio/mpeg');
    expect(speak.rawPayload.length).toBe(6);

    const boundary = 'xxBOUNDARYxx';
    const audio = Buffer.alloc(4096, 1);
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="answer.webm"\r\nContent-Type: audio/webm\r\n\r\n`),
      audio,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const tr = await app.inject({ method: 'POST', url: '/api/v1/ai/transcribe', headers: { ...auth(cand), 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body });
    expect(tr.statusCode).toBe(200);
    expect(tr.json().text).toBe('I built an order tracking service.');
    expect(calls.some((u) => u.startsWith('http://speech.local/v1/audio/'))).toBe(true);
  });
});
