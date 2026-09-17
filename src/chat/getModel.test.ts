import {createServer, type IncomingHttpHeaders, type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {generateText} from 'ai';
import {getChatModel} from './getModel';

// The AI SDK warns on every call that the OpenAI-compatible client runs in v2
// specification compatibility mode. Expected here, and it drowns the test output.
(globalThis as {AI_SDK_LOG_WARNINGS?: boolean}).AI_SDK_LOG_WARNINGS = false;

/**
 * The header this file guards never appears in the app's own code — it is
 * attached inside the provider client — so the only honest way to test it is to
 * point the client at a real server and read the request off the wire.
 *
 * Without `anthropic-dangerous-direct-browser-access` anthropic's CORS
 * preflight answers `400 Disallowed CORS origin` with no
 * `access-control-allow-origin`, the browser drops the request, and the chat
 * only ever reports `Failed to fetch`.
 */
let server: Server;
let baseURL: string;
let requests: {method: string; url: string; headers: IncomingHttpHeaders}[];

beforeAll(async () => {
  requests = [];
  server = createServer((req, res) => {
    requests.push({method: req.method ?? '', url: req.url ?? '', headers: req.headers});
    res.writeHead(200, {'content-type': 'application/json'});
    res.end(
      JSON.stringify({
        id: 'test',
        object: 'chat.completion',
        created: 0,
        model: 'test-model',
        choices: [
          {index: 0, message: {role: 'assistant', content: 'ok'}, finish_reason: 'stop'}
        ],
        usage: {prompt_tokens: 1, completion_tokens: 1, total_tokens: 2}
      })
    );
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

/** Minimal stand-in for the AI settings slice `getChatModel` reads from. */
function storeWith(provider: string, model: string, apiKey?: string) {
  return {
    getState: () => ({
      ai: {
        getSelectedModel: () => ({modelProvider: provider, model}),
        getApiKeyFromSettings: () => apiKey,
        getBaseUrlFromSettings: () => baseURL
      }
    })
  } as unknown as Parameters<typeof getChatModel>[0];
}

/** Send one prompt through the model `getChatModel` builds and report the request. */
async function send(provider: string, model: string) {
  requests.length = 0;
  await generateText({model: getChatModel(storeWith(provider, model, 'test-key'))!, prompt: 'hi'});
  const post = requests.find(request => request.method === 'POST');
  if (!post) throw new Error(`no request reached the server for ${provider}`);
  return post;
}

describe('getChatModel', () => {
  it('sends the anthropic browser-access header to the OpenAI-compatible path', async () => {
    const post = await send('anthropic', 'claude-opus-5');

    expect(post.url).toBe('/v1/chat/completions');
    expect(post.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(post.headers.authorization).toBe('Bearer test-key');
  });

  it('leaves providers that do not need it untouched', async () => {
    const post = await send('openai', 'gpt-5.6-sol');

    expect(post.url).toBe('/v1/chat/completions');
    expect(post.headers.authorization).toBe('Bearer test-key');
    expect(post.headers['anthropic-dangerous-direct-browser-access']).toBeUndefined();
  });

  it('returns undefined until the selected provider has an API key', () => {
    // SQLRooms keys its API-key input off whether this factory returns a model,
    // so an unset key has to stay undefined rather than build an unusable one.
    expect(getChatModel(storeWith('anthropic', 'claude-opus-5'))).toBeUndefined();
  });
});
