import {
  useElapsedTime,
  useStoreWithAi,
  type ChatActiveStatusInfo,
  type ChatActiveStatusProps,
} from '@sqlrooms/ai-core';
import {cn} from '@sqlrooms/ui';
import React from 'react';
import {collectTurnToolCalls} from './collectTurnToolCalls';
import {getInputReasoning} from './getLatestReasoningText';
import {ToolCallList} from './ToolCallList';

/**
 * Live status line whose label glimmers while the agent works, rendered by
 * `AppChatActions` for the running turn — directly above the still-empty
 * copy/fork button row, so live progress appears where the turn's action
 * buttons will land. sqlrooms' `ActiveStatus` slot is disabled
 * (`HiddenChatActiveStatus`), so this is the only live status in the chat.
 *
 * The line is collapsed by default; clicking it (or the close button on the
 * box when open) toggles the box listing the turn's tool calls so far. The
 * box is capped at a max height with vertical scrolling, lists the turn's tool
 * calls chronologically (newest at the bottom) and highlights the newest call
 * while it is still running as the "current" tool, auto-scrolling to keep it
 * in view. Collapsing the box keeps the current running tool highlighted in
 * the status line itself.
 *
 * The label mirrors the box's highlighted (newest) tool call — the `reasoning`
 * from that call's `input` (including nested calls from skill sub-agents,
 * tracked via `agentProgress`), trimmed to its first line, so *what* the agent
 * is doing (e.g. "Computing visit density per H3 cell") is surfaced directly
 * under the glimmer. When the highlighted call has no reasoning the generic
 * status label (e.g. "Running analysis…") is shown instead — the label always
 * describes the same call the box highlights, never an older one that happened
 * to be the last *with* reasoning.
 *
 * Once the turn completes this component unmounts, and the persistent access
 * point becomes the "Agent Thoughts" toggle in the action row
 * (`AppChatActions`), which expands the same box above the turn's action
 * buttons.
 *
 * Because the box replaces sqlrooms' `ActivityBox` — the library wires the
 * `Activity` and `ToolActivity` slots to render nothing — the transcript stays
 * clean while tool activity lives here (and in `AppChatActions`).
 *
 * The expanded state is per status instance: each new status mounts collapsed.
 *
 * The shimmer styles are injected inline rather than shipped as a CSS file
 * because kepler-assistant is a library with no stylesheet entry point — the
 * consumer app provides Tailwind. The `.busy-status-glimmer` class is unique
 * enough that the injected rules cannot leak into other UI.
 */
export const ShimmeringActiveStatus: React.FC<ChatActiveStatusProps> = ({
  status,
  className,
}) => (
  <>
    <style>{SHIMMER_CSS}</style>
    <ShimmeringActiveStatusLine
      key={status.key}
      status={status}
      className={className}
    />
  </>
);

const SHIMMER_CSS = `
  .busy-status-glimmer {
    display: inline-block;
    background-image: linear-gradient(
      90deg,
      hsl(var(--muted-foreground)) 0%,
      hsl(var(--muted-foreground)) 40%,
      hsl(var(--foreground)) 50%,
      hsl(var(--muted-foreground)) 60%,
      hsl(var(--muted-foreground)) 100%
    );
    background-size: 200% 100%;
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    animation: busy-status-glimmer-sweep 1.5s linear infinite;
  }
  @keyframes busy-status-glimmer-sweep {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .busy-status-glimmer {
      animation: none;
    }
  }
`;

const ShimmeringActiveStatusLine: React.FC<{
  status: ChatActiveStatusInfo;
  className?: string;
}> = ({status, className}) => {
  const [startedAt] = React.useState(() => Date.now());
  const elapsed = useElapsedTime(true, startedAt);
  const [expanded, setExpanded] = React.useState(false);

  const session = useStoreWithAi((s) => s.ai.getCurrentSession());
  const agentProgress = useStoreWithAi((s) => s.ai.agentProgress);
  const toolCalls = React.useMemo(
    () => collectTurnToolCalls(session?.uiMessages, agentProgress),
    [session?.uiMessages, agentProgress],
  );
  const latestToolCall = toolCalls[toolCalls.length - 1];
  const currentToolCallId = latestToolCall?.toolCallId;
  // The label mirrors the box's highlighted (newest) tool call: its own
  // `input.reasoning`, trimmed to a single line — never reasoning from an older
  // call that happened to be the last one *with* reasoning.
  const label = React.useMemo(() => {
    const reasoning = latestToolCall && getInputReasoning(latestToolCall.input);
    return reasoning ? getFirstLine(reasoning) : status.label;
  }, [latestToolCall, status.label]);

  return (
    <div
      className={cn('flex min-w-0 flex-col gap-1', className)}
      role="status"
      aria-live="polite"
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setExpanded((value) => !value);
          }
        }}
        className="text-muted-foreground hover:text-foreground flex min-w-0 cursor-pointer items-center gap-2 text-left text-sm transition-colors focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2"
      >
        <span className="text-foreground busy-status-glimmer min-w-0 truncate font-medium">
          {label}
        </span>
        {elapsed && (
          <span
            className="text-muted-foreground/60 shrink-0 text-xs tabular-nums"
            aria-hidden="true"
          >
            {elapsed}
          </span>
        )}
      </div>
      {expanded && (
        <ToolCallList
          toolCalls={toolCalls}
          onCollapse={() => setExpanded(false)}
          currentToolCallId={currentToolCallId}
          autoScroll
        />
      )}
    </div>
  );
};

/** Strips a reasoning text down to its first non-empty line for single-line display. */
function getFirstLine(text: string): string {
  const firstLine = text.split(/\r?\n/)[0];
  return (firstLine ?? text).trim();
}
