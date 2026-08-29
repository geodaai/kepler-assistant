import {
  useStoreWithAi,
  type ChatActionsProps,
  type ChatActiveStatusInfo,
} from '@sqlrooms/ai-core';
import {
  Button,
  cn,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@sqlrooms/ui';
import {BrainCircuit} from 'lucide-react';
import React from 'react';
import {collectTurnCallsForTurn} from './collectTurnToolCalls';
import {ShimmeringActiveStatus} from './ShimmeringActiveStatus';
import {ToolCallList} from './ToolCallList';
import {TurnIdContext} from './TurnIdContext';

/**
 * Library-local `Actions` slot ("custom DefaultChatActions").
 *
 * For the *running* turn this renders the live `ShimmeringActiveStatus` line
 * (with its expandable tool-call box) directly above the still-empty button
 * row — live progress appears where the turn's copy/fork buttons will land,
 * instead of a separate element after all turns (sqlrooms' `ActiveStatus` slot
 * is disabled via `HiddenChatActiveStatus`).
 *
 * For a *completed* turn it renders sqlrooms' copy/fork row plus an "Agent
 * Thoughts" button — placed after copy/fork — showing the turn's tool count
 * (e.g. "3 tools"). Clicking it expands the same max-height, scrollable
 * tool-call box directly above the action row. The button only appears once
 * the whole conversation has finished — while a run is in progress it stays
 * hidden even for already-completed earlier turns, so the running turn's live
 * status is the single point of activity.
 *
 * The box lists the tool calls of the turn this action row belongs to, in
 * chronological order. sqlrooms binds the `Actions` slot per turn without
 * passing any turn identity, so `AppChatTurn` supplies the turn id through
 * `TurnIdContext` and this component scopes its collection to it — clicking the
 * toggle under a finished response shows that response's tools, not the whole
 * conversation's.
 */
export const AppChatActions: React.FC<ChatActionsProps> = ({copy, fork}) => {
  const turnId = React.useContext(TurnIdContext);
  const session = useStoreWithAi((s) => s.ai.getCurrentSession());
  const sessionIsRunning = session?.isRunning ?? false;
  const uiMessages = session?.uiMessages;
  const agentProgress = useStoreWithAi((s) => s.ai.agentProgress);
  const toolCalls = React.useMemo(
    () => collectTurnCallsForTurn(turnId, uiMessages, agentProgress),
    [turnId, uiMessages, agentProgress],
  );
  const [expanded, setExpanded] = React.useState(false);

  // This action row belongs to the running turn when the current session is
  // running and this turn is its most recent (last) user turn. Its live status
  // line takes the place of the toggle button here.
  const isLive = React.useMemo(() => {
    if (!sessionIsRunning || turnId === undefined || !uiMessages?.length) {
      return false;
    }
    for (let index = uiMessages.length - 1; index >= 0; index--) {
      const message = uiMessages[index];
      if (message?.role !== 'user') continue;
      return message.id === turnId;
    }
    return false;
  }, [sessionIsRunning, turnId, uiMessages]);

  const Copy = copy?.Content;
  const Fork = fork?.Content;
  // The "Agent Thoughts" button appears only once the whole conversation has
  // finished — while a run is still in progress (even for already-completed
  // earlier turns) it stays hidden, so the running turn's live status is the
  // only point of activity.
  const showToggle = toolCalls.length > 0 && !sessionIsRunning;
  if (!isLive && !Copy && !Fork && !showToggle) return null;

  if (isLive) {
    const liveStatus: ChatActiveStatusInfo = {
      key: `live:${turnId}`,
      label: 'Running analysis…',
      kind: 'tool',
    };
    return (
      <div className="flex min-w-0 flex-col gap-1.5">
        <ShimmeringActiveStatus status={liveStatus} />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {expanded && showToggle && (
        <ToolCallList
          title="Agent Thoughts"
          toolCalls={toolCalls}
          onCollapse={() => setExpanded(false)}
        />
      )}
      <div className="flex justify-start gap-1">
        {Copy && <Copy />}
        {Fork && <Fork />}
        {showToggle && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                aria-label="Agent Thoughts"
                aria-pressed={expanded}
                title="Agent Thoughts"
                onClick={() => setExpanded((value) => !value)}
                className={cn(
                  'border-muted text-muted-foreground hover:text-foreground cursor-pointer gap-1.5 border',
                  expanded && 'bg-muted text-foreground',
                )}
              >
                <BrainCircuit className="h-4 w-4" />
                <span className="text-xs tabular-nums">
                  {toolCalls.length}{' '}
                  {toolCalls.length === 1 ? 'tool call' : 'tool calls'}
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Agent Thoughts</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
};
