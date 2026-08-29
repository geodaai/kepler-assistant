import type {AiSettingsSliceConfig} from '@sqlrooms/ai';

export const PROVIDER_DEFAULT_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta',
  deepseek: 'https://api.deepseek.com/v1',
  xai: 'https://api.x.ai/v1',
  ollama: 'http://localhost:11434/v1'
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
