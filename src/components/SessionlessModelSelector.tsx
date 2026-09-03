import React, {useMemo} from 'react';
import {
  cn,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue
} from '@sqlrooms/ui';
import {extractModelsFromSettings} from '@sqlrooms/ai-core';
import {useRoomStore} from '../store';

/** Capitalizes a provider key for display (e.g. "openai" -> "Openai"). */
const capitalize = (value: string): string =>
  value.charAt(0).toUpperCase() + value.slice(1);

interface Model {
  provider: string;
  label: string;
  value: string;
}

interface SessionlessModelSelectorProps {
  className?: string;
  models?: Model[];
}

const MODEL_KEY_SEPARATOR = '::';

/**
 * Encodes one part of a model select key.
 *
 * We encode provider/model segments before joining to avoid collisions when
 * either value contains the separator token.
 */
const encodeModelKeyPart = (value: string): string => encodeURIComponent(value);

/**
 * Decodes one part of a model select key.
 */
const decodeModelKeyPart = (value: string): string => decodeURIComponent(value);

/**
 * Builds a stable select value for a provider/model pair.
 */
const getModelSelectKey = (provider: string, modelValue: string): string =>
  `${encodeModelKeyPart(provider)}${MODEL_KEY_SEPARATOR}${encodeModelKeyPart(modelValue)}`;

/**
 * Parses a select value back to provider/model.
 *
 * Returns `null` for malformed input so UI handlers can safely ignore it.
 */
const parseModelSelectKey = (
  selectValue: string
): {provider: string; modelValue: string} | null => {
  const [encodedProvider, encodedModelValue, ...extraParts] =
    selectValue.split(MODEL_KEY_SEPARATOR);
  if (!encodedProvider || !encodedModelValue || extraParts.length > 0) {
    return null;
  }

  try {
    return {
      provider: decodeModelKeyPart(encodedProvider),
      modelValue: decodeModelKeyPart(encodedModelValue)
    };
  } catch {
    return null;
  }
};

/**
 * Model selector that works before a chat session exists.
 *
 * The stock `Chat.ModelSelector` returns `null` when there is no current
 * session — which is exactly the state the inline API-key composer renders in
 * (first-time users have no session until they send their first message). That
 * left the API-key entry screen with no way to pick a provider, so a user who
 * only has, say, an Anthropic key saw "Enter your OpenAI API key..." and no
 * model selector.
 *
 * This variant reads the resolved selection (`getSelectedModel()`, which falls
 * back to the default provider/model when no session exists) so the selector is
 * visible next to the API-key input. Changing the model creates a session if
 * none exists — the session carries the chosen provider/model forward, so the
 * API-key hint updates to the new provider and the first send uses the selected
 * model. When a session already exists it behaves exactly like the stock
 * selector (`setAiModel`).
 */
export function SessionlessModelSelector({
  className,
  models: passedModels
}: SessionlessModelSelectorProps) {
  // Select primitives (not the object) so zustand's Object.is comparison
  // doesn't re-render on every store change.
  const modelProvider = useRoomStore(s => s.ai.getSelectedModel().modelProvider);
  const model = useRoomStore(s => s.ai.getSelectedModel().model);
  const currentSession = useRoomStore(s => s.ai.getCurrentSession());
  const setAiModel = useRoomStore(s => s.ai.setAiModel);
  const createSession = useRoomStore(s => s.ai.createSession);

  const aiSettingsConfig = useRoomStore(s => s.aiSettings.config);
  const settingsModels = useMemo(
    () => (aiSettingsConfig ? extractModelsFromSettings(aiSettingsConfig) : []),
    [aiSettingsConfig]
  );

  const models = passedModels ?? settingsModels;

  const handleModelChange = (selectValue: string) => {
    const parsed = parseModelSelectKey(selectValue);
    if (!parsed) return;
    if (currentSession) {
      setAiModel(parsed.provider, parsed.modelValue);
    } else {
      // No session yet (lazy session creation): create one carrying the chosen
      // provider/model so the selection persists and the API-key hint updates.
      createSession(undefined, parsed.provider, parsed.modelValue);
    }
  };

  const currentSelectValue = getModelSelectKey(modelProvider, model);
  const currentModelDetails = models.find(
    m => m.provider === modelProvider && m.value === model
  );
  // The resolved selection can name a model that isn't in the settings list
  // (e.g. the library's generic default `gpt-4.1` before the user picks one).
  // Radix Select renders the selected item's text when a value is set, and only
  // falls back to its `placeholder` when the value is empty — so a value that
  // matches no item would render an empty trigger. Passing the current model's
  // label as `SelectValue` children makes the trigger always show what is
  // actually selected instead of a bare "Select model".
  const currentModelLabel = currentModelDetails?.label ?? model;

  // Group models by provider
  const modelsByProvider = models.reduce(
    (acc, modelEntry) => {
      if (!acc[modelEntry.provider]) {
        acc[modelEntry.provider] = [];
      }
      acc[modelEntry.provider]!.push(modelEntry);
      return acc;
    },
    {} as Record<string, Model[]>
  );

  return (
    <div className={cn('min-w-0', className)}>
      <Select value={currentSelectValue} onValueChange={handleModelChange}>
        <SelectTrigger className="h-8 w-auto max-w-[220px] min-w-0 px-2.5 py-1 text-xs font-medium shadow-none [&>span]:truncate">
          <SelectValue>{currentModelLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {Object.entries(modelsByProvider).map(([provider, providerModels]) => (
            <React.Fragment key={provider}>
              <SelectGroup>
                <SelectLabel className="text-muted-foreground/50 py-1 text-center text-xs font-bold">
                  {capitalize(provider)}
                </SelectLabel>
                {providerModels.map(modelEntry => (
                  <SelectItem
                    key={getModelSelectKey(modelEntry.provider, modelEntry.value)}
                    value={getModelSelectKey(modelEntry.provider, modelEntry.value)}
                    className="py-1 pr-7 text-xs"
                  >
                    {modelEntry.label}
                  </SelectItem>
                ))}
              </SelectGroup>
              <SelectSeparator />
            </React.Fragment>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
