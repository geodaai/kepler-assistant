import type {AgentToolCall} from '@sqlrooms/ai-core';

/**
 * Returns the most recent non-empty reasoning text in the current turn, or
 * `undefined` if none exists. Scans the turn's assistant messages from the end
 * so the newest activity wins. For a tool part that spawned a sub-agent, the
 * nested calls (from `agentProgress`) are checked first — their `reasoning`
 * fields are the sub-agent's latest activity — before the parent tool's own
 * `reasoning` input. Falls back to the model's `reasoning` parts.
 *
 * The message/part types are structural rather than `ai`'s `UIMessage` because
 * the session's `uiMessages` are typed by `@sqlrooms/ai-config` (ai v6) while
 * @sqlrooms/ai-core is built on ai v7 — the two `UIMessage` types are not
 * mutually assignable. Only the fields we read are declared.
 */
export function getLatestReasoningText(
  messages: readonly AnyUIMessage[] | undefined,
  agentProgress: Record<string, AgentToolCall[]>,
): string | undefined {
  const currentTurn = getCurrentTurnMessages(messages);
  for (
    let messageIndex = currentTurn.length - 1;
    messageIndex >= 0;
    messageIndex--
  ) {
    const message = currentTurn[messageIndex];
    if (message.role !== 'assistant') continue;
    const parts = message.parts ?? [];
    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex--) {
      const part = parts[partIndex];
      if (part.type === 'reasoning') {
        const text = part.text?.trim();
        if (text) return text;
        continue;
      }
      if (!isToolPart(part.type)) continue;
      if (part.toolCallId) {
        const nested = agentProgress[part.toolCallId];
        if (nested?.length) {
          for (
            let nestedIndex = nested.length - 1;
            nestedIndex >= 0;
            nestedIndex--
          ) {
            const nestedReasoning = getInputReasoning(
              nested[nestedIndex].input,
            );
            if (nestedReasoning) return nestedReasoning;
          }
        }
      }
      const reasoning = getInputReasoning(part.input);
      if (reasoning) return reasoning;
    }
  }
  return undefined;
}

export type AnyUIMessage = {
  role: string;
  parts?: readonly AnyUIMessagePart[];
};

export type AnyUIMessagePart = {
  type: string;
  text?: string;
  toolCallId?: string;
  input?: unknown;
};

export function getInputReasoning(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const reasoning = (input as Record<string, unknown>).reasoning;
  if (typeof reasoning !== 'string') return undefined;
  const trimmed = reasoning.trim();
  return trimmed || undefined;
}

function getCurrentTurnMessages(
  messages: readonly AnyUIMessage[] | undefined,
): readonly AnyUIMessage[] {
  if (!messages?.length) return [];
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role === 'user') return messages.slice(index);
  }
  return messages;
}

function isToolPart(type: string): boolean {
  return type === 'dynamic-tool' || type.startsWith('tool-');
}
