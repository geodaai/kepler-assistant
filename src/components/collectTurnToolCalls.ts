import type {AgentToolCall} from '@sqlrooms/ai-core';

/**
 * Collects the ordered, de-duplicated list of tool calls made so far in the
 * current chat turn, for the live tool box in `ShimmeringActiveStatus`.
 *
 * Walks the turn's assistant messages from oldest to newest. A tool part
 * becomes one entry; a sub-agent's calls (live from `agentProgress`, falling
 * back to the persisted `agentToolCalls`) follow their parent, depth-first,
 * mirroring the order the flat agent renderer presents them. Text and
 * `reasoning` parts are skipped — reasoning text is surfaced per row from each
 * tool's `input.reasoning` (via `getInputReasoning`) and in the status line
 * from the highlighted latest call.
 *
 * `collectTurnCallsForTurn` scopes to the turn whose user message has a given
 * id (used by the per-turn "Agent Thoughts" box in `AppChatActions`); the live
 * box uses `collectTurnToolCalls`, which slices to the most recent turn.
 *
 * Messages and parts are typed structurally rather than with `ai`'s
 * `UIMessage`: the session's `uiMessages` are typed by `@sqlrooms/ai-config`
 * (ai v6) while this file's `AgentToolCall` comes from `@sqlrooms/ai-core`
 * (ai v7) — the two `UIMessage` types are not mutually assignable, so only the
 * fields we read are declared.
 */

export type ToolCallUIMessage = {
  id?: string;
  role: string;
  parts?: readonly ToolCallUIMessagePart[];
};

export type ToolCallUIMessagePart = {
  type: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  state?: string;
};

/** Maps a UI part state onto the presentation state used by tool log lines. */
export function mapUiPartStateToAgentState(
  state: string | undefined,
): AgentToolCall['state'] {
  if (state === 'output-available') return 'success';
  if (state === 'output-error' || state === 'output-denied') return 'error';
  if (state === 'approval-requested') return 'approval-requested';
  return 'pending';
}

function partToToolCall(
  part: ToolCallUIMessagePart,
): AgentToolCall | undefined {
  if (!isToolPartType(part.type) || !part.toolCallId) return undefined;
  const state = mapUiPartStateToAgentState(part.state);
  // Persisted sub-agents carry their nested calls on the tool output
  // (`output.agentToolCalls`), the same shape buildChatTurnModel reads.
  const rawOutput = part.output;
  const agentToolCalls =
    rawOutput && typeof rawOutput === 'object'
      ? (rawOutput as {agentToolCalls?: AgentToolCall[]}).agentToolCalls
      : undefined;
  return {
    toolCallId: part.toolCallId,
    toolName:
      part.type === 'dynamic-tool'
        ? part.toolName || 'tool'
        : part.type.replace(/^tool-/, '') || 'tool',
    input: part.input,
    output: part.state === 'output-available' ? part.output : undefined,
    errorText: part.state === 'output-error' ? part.errorText : undefined,
    state,
    ...(agentToolCalls?.length ? {agentToolCalls} : {}),
  };
}

export function collectTurnToolCalls(
  messages: readonly ToolCallUIMessage[] | undefined,
  agentProgress: Record<string, AgentToolCall[]>,
): AgentToolCall[] {
  return collectCalls(getCurrentTurnMessages(messages), agentProgress);
}

/**
 * Collects the tool calls of the specific turn whose user message has the
 * given `turnId` (the session messages' `id`s), for the per-turn "Agent
 * Thoughts" box in `AppChatActions`. Returns `[]` when the turn is not in the
 * current session.
 */
export function collectTurnCallsForTurn(
  turnId: string | undefined,
  messages: readonly ToolCallUIMessage[] | undefined,
  agentProgress: Record<string, AgentToolCall[]>,
): AgentToolCall[] {
  return collectCalls(getTurnMessages(messages, turnId), agentProgress);
}

function getTurnMessages(
  messages: readonly ToolCallUIMessage[] | undefined,
  turnId: string | undefined,
): readonly ToolCallUIMessage[] {
  if (!messages?.length || !turnId) return [];
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (message?.role !== 'user' || message.id !== turnId) continue;
    for (let end = index + 1; end < messages.length; end++) {
      if (messages[end]?.role === 'user') return messages.slice(index, end);
    }
    return messages.slice(index);
  }
  return [];
}

function collectCalls(
  messages: readonly ToolCallUIMessage[] | undefined,
  agentProgress: Record<string, AgentToolCall[]>,
): AgentToolCall[] {
  const result: AgentToolCall[] = [];
  const seen = new Set<string>();

  const visitNested = (call: AgentToolCall): void => {
    if (seen.has(call.toolCallId)) return;
    seen.add(call.toolCallId);
    result.push(call);
    const nested = agentProgress[call.toolCallId] ?? call.agentToolCalls ?? [];
    for (const child of nested) visitNested(child);
  };

  for (const message of messages ?? []) {
    if (message.role !== 'assistant') continue;
    for (const part of message.parts ?? []) {
      const toolCall = partToToolCall(part);
      if (!toolCall) continue;
      visitNested(toolCall);
    }
  }
  return result;
}

function getCurrentTurnMessages(
  messages: readonly ToolCallUIMessage[] | undefined,
): readonly ToolCallUIMessage[] {
  if (!messages?.length) return [];
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role === 'user') return messages.slice(index);
  }
  return messages;
}

function isToolPartType(type: string): boolean {
  return type === 'dynamic-tool' || type.startsWith('tool-');
}
