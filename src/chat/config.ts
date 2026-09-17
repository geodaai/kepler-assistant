import type {AiSettingsSliceConfig} from '@sqlrooms/ai';

export const PROVIDER_DEFAULT_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta',
  deepseek: 'https://api.deepseek.com/v1',
  xai: 'https://api.x.ai/v1',
  ollama: 'http://localhost:11434/v1'
};

/**
 * Extra request headers some providers need when the client runs in the page.
 *
 * Anthropic's API treats a plain browser request as disallowed: the CORS
 * preflight (`OPTIONS`) comes back `400 Disallowed CORS origin` with no
 * `access-control-allow-origin`, so the browser drops the real request and the
 * app only sees `Failed to fetch`. Opting in with this header makes the
 * preflight succeed and the request go through. It is required even though the
 * base URL above is the OpenAI-compatible endpoint — that path has the same
 * browser gate.
 *
 * Providers absent from this map are sent as-is.
 */
export const PROVIDER_REQUEST_HEADERS: Record<string, Record<string, string>> = {
  anthropic: {'anthropic-dangerous-direct-browser-access': 'true'}
};

export const LLM_MODELS = [
  {name: 'openai', models: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']},
  {name: 'anthropic', models: ['claude-opus-5', 'claude-sonnet-5']},
  {
    name: 'google',
    models: ['gemini-3.1-pro-preview', 'gemini-3.7-flash', 'gemini-3.5-flash-lite']
  },
  {name: 'deepseek', models: ['deepseek-v4-flash', 'deepseek-v4-pro']},
  {name: 'xai', models: ['grok-4.6']},
  {name: 'ollama', models: ['deepseek-v4-flash:cloud', 'qwen3.6:27b', 'gpt-oss:20b']}
];

export const AI_SETTINGS = {
  providers: LLM_MODELS.reduce((acc, provider) => {
    acc[provider.name] = {
      baseUrl: PROVIDER_DEFAULT_BASE_URLS[provider.name] || '',
      apiKey: '',
      models: provider.models.map(model => ({id: model, modelName: model}))
    };
    return acc;
  }, {} as Record<string, {baseUrl: string; apiKey: string; models: {id: string; modelName: string}[]}>)
} satisfies Pick<AiSettingsSliceConfig, 'providers'>;
