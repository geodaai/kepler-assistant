import {createOpenAICompatible} from '@ai-sdk/openai-compatible';
import type {AiSliceOptions, AiSliceState} from '@sqlrooms/ai-core';
import type {StoreApi} from '@sqlrooms/room-store';
import type {LanguageModel} from 'ai';
import {PROVIDER_REQUEST_HEADERS} from './config';

/**
 * The model type `AiSliceOptions.getCustomModel` expects. It resolves to the
 * `ai` copy `@sqlrooms/ai-core` was built against, which is a different major
 * than this package's own `ai` — hence the cast below rather than a shared
 * import.
 */
type TransportLanguageModel = ReturnType<
  NonNullable<AiSliceOptions['getCustomModel']>
>;

/**
 * Build a provider client for one provider/model pair.
 *
 * All configured providers (openai, anthropic, google, deepseek, xai, ollama)
 * speak the OpenAI-compatible protocol at their own base URL, so a single
 * client covers them. The one per-provider difference is the request headers
 * the browser needs — see `PROVIDER_REQUEST_HEADERS`.
 *
 * `@ai-sdk/openai-compatible` (v1.0.x) emits `specificationVersion = "v2"`,
 * which `ai` v7's `ToolLoopAgent` accepts directly. (Older 0.2.x emits "v1" and
 * throws `UnsupportedModelVersionError` under `ai` v7 — that was the skill
 * sub-agent crash seen when changing the basemap to "dark".)
 */
function createProviderModel({
  provider,
  modelId,
  apiKey,
  baseURL,
  includeUsage
}: {
  provider: string;
  modelId: string;
  apiKey: string;
  baseURL: string;
  includeUsage?: boolean;
}): LanguageModel {
  return createOpenAICompatible({
    apiKey,
    name: provider,
    baseURL,
    headers: PROVIDER_REQUEST_HEADERS[provider],
    ...(includeUsage ? {includeUsage: true} : {})
  }).chatModel(modelId) as unknown as LanguageModel;
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

/**
 * Resolve the current session's language model for a skill sub-agent. Mirrors
 * the model-construction logic in `@sqlrooms/ai-core`'s chat transport: it
 * reads the session's provider/model + the API key/base URL from the AI
 * settings slice and builds an OpenAI-compatible client.
 *
 * Always returns a model — the sub-agent call site needs one, and an unset key
 * surfaces as the provider's own authentication error.
 */
export function getModel(store: StoreApi<AiSliceState>): LanguageModel {
  const state = store.getState();
  const currentSession = state.ai.getCurrentSession();
  const provider = currentSession?.modelProvider || 'openai';
  const modelId = currentSession?.model || 'gpt-5.6-sol';

  return createProviderModel({
    provider,
    modelId,
    apiKey: state.ai.getApiKeyFromSettings(),
    baseURL: state.ai.getBaseUrlFromSettings() || DEFAULT_BASE_URL
  });
}

/**
 * The chat transport's model factory (`AiSliceOptions.getCustomModel`).
 *
 * `@sqlrooms/ai-core` builds its own OpenAI-compatible client when no custom
 * model is supplied, and that client has no way to carry provider request
 * headers — which is why anthropic had to be built here instead.
 *
 * Returns `undefined` until the selected provider has an API key, so SQLRooms
 * keeps rendering its API-key input instead of treating the model as ready
 * (`requiresApiKey()` keys off whether this factory currently returns one).
 * No request can happen in that state anyway.
 *
 * Reads `getSelectedModel()` rather than the current session so the factory is
 * correct before the first message creates a session.
 */
export function getChatModel(
  store: StoreApi<AiSliceState>
): TransportLanguageModel {
  const state = store.getState();
  const {modelProvider, model} = state.ai.getSelectedModel();
  const apiKey = state.ai.getApiKeyFromSettings(modelProvider, model);
  if (!apiKey) {
    return undefined;
  }

  return createProviderModel({
    provider: modelProvider,
    modelId: model,
    apiKey,
    baseURL:
      state.ai.getBaseUrlFromSettings(modelProvider, model) || DEFAULT_BASE_URL,
    // Match the client we replace, so token usage still reaches the session.
    includeUsage: true
  }) as unknown as TransportLanguageModel;
}
