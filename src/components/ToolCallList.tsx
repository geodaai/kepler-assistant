import type {AgentToolCall} from '@sqlrooms/ai-core';
import {cn} from '@sqlrooms/ui';
import {CircleIcon, CircleXIcon, XIcon} from 'lucide-react';
import React from 'react';
import {getInputReasoning} from './getLatestReasoningText';
import {ToolCallDetailHover} from './ToolCallDetailHover';

/**
 * The bordered, scrollable tool-call box shared by the live
 * `ShimmeringActiveStatus` row and the per-turn "Agent Thoughts" toggle in
 * `AppChatActions`.
 *
 * The list is capped at a maximum height (`max-h-64`) and scrolls vertically
 * when there are many calls, so the box never grows unbounded. Calls render in
 * chronological order (oldest at the top, newest at the bottom); the caller can
 * pass the newest call's id as `currentToolCallId` to highlight it while it is
 * still running. With `autoScroll`, the body keeps the newest call in view as
 * the list grows.
 *
 * A close button on the top right collapses the box (matching the status row
 * toggle). The bullet / reasoning presentation of each row matches the sqlrooms
 * log lines. Each row also has a `ToolCallDetailHover` trigger for the tool
 * name, id, state, input and output.
 */
export const ToolCallList: React.FC<{
  toolCalls: AgentToolCall[];
  onCollapse: () => void;
  currentToolCallId?: string;
  autoScroll?: boolean;
  title?: string;
}> = ({
  toolCalls,
  onCollapse,
  currentToolCallId,
  autoScroll = false,
  title = 'Tool calls',
}) => (
  <div className="border-border/50 flex min-w-0 flex-col overflow-hidden rounded-md border">
    <div className="flex items-center justify-between py-1 pr-1 pl-2">
      <span className="text-muted-foreground/60 text-[10px] font-medium tracking-wide uppercase">
        {title}
      </span>
      <button
        type="button"
        onClick={onCollapse}
        aria-label="Collapse tool details"
        title="Collapse"
        className="text-muted-foreground/60 hover:text-foreground flex h-5 w-5 cursor-pointer items-center justify-center rounded transition-colors"
      >
        <XIcon className="h-3.5 w-3.5" />
      </button>
    </div>
    <ToolCallListBody
      toolCalls={toolCalls}
      currentToolCallId={currentToolCallId}
      autoScroll={autoScroll}
    />
  </div>
);

const ToolCallListBody: React.FC<{
  toolCalls: AgentToolCall[];
  currentToolCallId?: string;
  autoScroll?: boolean;
}> = ({toolCalls, currentToolCallId, autoScroll}) => {
  const listRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!autoScroll) return;
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [autoScroll, toolCalls.length]);
  return (
    <div className="text-muted-foreground w-full min-w-0 p-2.5 pt-0.5 text-xs">
      {toolCalls.length === 0 ? (
        <p className="text-muted-foreground/60">No tool calls yet.</p>
      ) : (
        <div ref={listRef} className="max-h-64 min-w-0 overflow-y-auto">
          {toolCalls.map((call) => (
            <ToolCallStatusRow
              key={call.toolCallId}
              toolCall={call}
              isCurrent={call.toolCallId === currentToolCallId}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/** One row of the tool-call list: bullet / reasoning text. */
export const ToolCallStatusRow: React.FC<{
  toolCall: AgentToolCall;
  isCurrent?: boolean;
}> = ({toolCall, isCurrent}) => {
  const isPending = toolCall.state === 'pending';
  const isError = toolCall.state === 'error';
  const reasoning = getInputReasoning(toolCall.input);
  const label = stripTrailingEllipsis(
    reasoning ?? (isPending ? 'Thinking...' : toolCall.toolName),
  );
  return (
    <div
      className={cn(
        'grid min-w-0 grid-cols-[14px_minmax(0,1fr)_auto] items-start gap-x-1.5 overflow-hidden rounded py-0.5',
        isCurrent && '-mx-1 bg-muted/40 px-1',
      )}
      aria-current={isCurrent ? 'true' : undefined}
    >
      <span className="flex h-3.5 w-3.5 items-center justify-center">
        {isError ? (
          <CircleXIcon className="h-3 w-3" />
        ) : (
          <CircleIcon className="text-muted-foreground/40 h-1.5 w-1.5 fill-current" />
        )}
      </span>
      <span
        className={cn(
          'min-w-0 leading-4 break-words whitespace-normal hyphens-auto',
          reasoning && 'italic',
          isCurrent && 'text-foreground font-medium',
        )}
      >
        {label}
      </span>
      <ToolCallDetailHover toolCall={toolCall} />
    </div>
  );
};

function stripTrailingEllipsis(text: string): string {
  return text.replace(/(?:\s*(?:\.\.\.|…))+\s*$/u, '').trimEnd();
}
