import type {AgentToolCall} from '@sqlrooms/ai-core';
import {describe, expect, it} from 'vitest';
import {
  collectTurnCallsForTurn,
  collectTurnToolCalls,
} from './collectTurnToolCalls';

const toolPart = (
  overrides: Partial<{
    type: string;
    toolCallId?: string;
    toolName?: string;
    input?: unknown;
    output?: unknown;
    errorText?: string;
    state?: string;
  }>,
) => ({
  type: 'tool-run_sql',
  toolCallId: 'call-1',
  state: 'output-available',
  ...overrides,
});

const nestedCall = (
  id: string,
  overrides: Partial<AgentToolCall> = {},
): AgentToolCall => ({
  toolCallId: id,
  toolName: `tool-${id}`,
  state: 'success',
  ...overrides,
});

describe('collectTurnToolCalls', () => {
  it('collects tool parts in order with mapped states', () => {
    const messages = [
      {
        role: 'assistant',
        parts: [
          toolPart({
            type: 'tool-run_sql',
            toolCallId: 'sql-1',
            state: 'input-available',
          }),
          toolPart({
            type: 'tool-run_sql',
            toolCallId: 'sql-2',
            state: 'output-available',
          }),
          toolPart({
            type: 'tool-make_chart',
            toolCallId: 'chart-1',
            state: 'output-error',
            errorText: 'boom',
          }),
        ],
      },
    ];
    const calls = collectTurnToolCalls(messages, {});
    expect(calls.map((c) => [c.toolCallId, c.toolName, c.state])).toEqual([
      ['sql-1', 'run_sql', 'pending'],
      ['sql-2', 'run_sql', 'success'],
      ['chart-1', 'make_chart', 'error'],
    ]);
    expect(calls[2].errorText).toBe('boom');
  });

  it('maps output-denied and approval-requested states', () => {
    const messages = [
      {
        role: 'assistant',
        parts: [
          toolPart({toolCallId: 'a', type: 'tool-x', state: 'output-denied'}),
          toolPart({
            toolCallId: 'b',
            type: 'tool-x',
            state: 'approval-requested',
          }),
        ],
      },
    ];
    const calls = collectTurnToolCalls(messages, {});
    expect(calls.map((c) => c.state)).toEqual(['error', 'approval-requested']);
  });

  it('keeps output only for output-available parts', () => {
    const messages = [
      {
        role: 'assistant',
        parts: [
          toolPart({toolCallId: 'done', output: {rows: 3}}),
          toolPart({
            toolCallId: 'pending',
            state: 'input-complete',
            output: {rows: 9},
          }),
        ],
      },
    ];
    const calls = collectTurnToolCalls(messages, {});
    expect(calls[0].output).toEqual({rows: 3});
    expect(calls[1].output).toBeUndefined();
  });

  it('uses the dynamic-tool name for dynamic parts', () => {
    const messages = [
      {
        role: 'assistant',
        parts: [toolPart({type: 'dynamic-tool', toolName: 'my_widget'})],
      },
    ];
    const calls = collectTurnToolCalls(messages, {});
    expect(calls[0].toolName).toBe('my_widget');
  });

  it('appends nested sub-agent calls after their parent, depth-first', () => {
    const calls = [nestedCall('h3-1'), nestedCall('h3-2', {state: 'pending'})];
    const deeper = [nestedCall('inner-1')];
    const agentProgress = {
      'agent-1': calls,
      'h3-2': deeper,
    };
    const messages = [
      {
        role: 'assistant',
        parts: [
          toolPart({
            type: 'tool-agent_skill',
            toolCallId: 'agent-1',
            input: {reasoning: 'Planning'},
          }),
        ],
      },
    ];
    const collected = collectTurnToolCalls(messages, agentProgress);
    expect(collected.map((c) => c.toolCallId)).toEqual([
      'agent-1',
      'h3-1',
      'h3-2',
      'inner-1',
    ]);
  });

  it('falls back to persisted agentToolCalls when no live progress exists', () => {
    const messages = [
      {
        role: 'assistant',
        parts: [
          toolPart({
            type: 'tool-agent_skill',
            toolCallId: 'agent-1',
            output: {
              finalOutput: 'done',
              agentToolCalls: [nestedCall('old-1'), nestedCall('old-2')],
            },
          }),
        ],
      },
    ];
    expect(collectTurnToolCalls(messages, {}).map((c) => c.toolCallId)).toEqual(
      ['agent-1', 'old-1', 'old-2'],
    );
  });

  it('de-duplicates a tool call appearing more than once', () => {
    const agentProgress = {'agent-1': [nestedCall('dup')]};
    const messages = [
      {
        role: 'assistant',
        parts: [
          toolPart({type: 'tool-agent_skill', toolCallId: 'agent-1'}),
          toolPart({type: 'tool-agent_skill', toolCallId: 'agent-1'}),
        ],
      },
    ];
    const collected = collectTurnToolCalls(messages, agentProgress);
    expect(collected.map((c) => c.toolCallId)).toEqual(['agent-1', 'dup']);
  });

  it('collectTurnCallsForTurn scopes to the turn of the given user-message id', () => {
    const messages = [
      {id: 'turn-1', role: 'user', parts: []},
      {
        role: 'assistant',
        parts: [toolPart({toolCallId: 'turn-1-sql'})],
      },
      {id: 'turn-2', role: 'user', parts: []},
      {
        role: 'assistant',
        parts: [toolPart({type: 'tool-agent_skill', toolCallId: 'agent-2'})],
      },
    ];
    const agentProgress = {'agent-2': [nestedCall('nested-2a')]};
    const turn1 = collectTurnCallsForTurn('turn-1', messages, agentProgress);
    expect(turn1.map((c) => c.toolCallId)).toEqual(['turn-1-sql']);
    const turn2 = collectTurnCallsForTurn('turn-2', messages, agentProgress);
    expect(turn2.map((c) => c.toolCallId)).toEqual(['agent-2', 'nested-2a']);
    expect(collectTurnCallsForTurn('missing', messages, agentProgress)).toEqual(
      [],
    );
    expect(collectTurnCallsForTurn(undefined, messages, agentProgress)).toEqual(
      [],
    );
  });

  it('only considers messages after the last user message', () => {
    const messages = [
      {role: 'user', parts: [toolPart({toolCallId: 'user-side'})]},
      {
        role: 'assistant',
        parts: [
          toolPart({toolCallId: 'turn-1'}),
          toolPart({toolCallId: 'turn-2'}),
        ],
      },
    ];
    expect(collectTurnToolCalls(messages, {}).map((c) => c.toolCallId)).toEqual(
      ['turn-1', 'turn-2'],
    );
  });

  it('skips non-tool parts and unkeyed tool parts', () => {
    const messages = [
      {
        role: 'assistant',
        parts: [
          {type: 'text', text: 'hello'},
          {type: 'reasoning', text: 'hmm'},
          toolPart({toolCallId: undefined}),
          toolPart({toolCallId: 'real'}),
        ],
      },
    ];
    expect(collectTurnToolCalls(messages, {}).map((c) => c.toolCallId)).toEqual(
      ['real'],
    );
  });

  it('handles empty or undefined inputs', () => {
    expect(collectTurnToolCalls(undefined, {})).toEqual([]);
    expect(collectTurnToolCalls([], {})).toEqual([]);
  });
});
