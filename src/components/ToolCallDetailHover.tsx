import {
  cn,
  CopyButton,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@sqlrooms/ui';
import type {AgentToolCall} from '@sqlrooms/ai-core';
import {CircleDotIcon} from 'lucide-react';
import React from 'react';

/**
 * App-local copy of sqlrooms' private `ToolCallDetailHover` (FlatAgentRenderer)
 * so the expandable tool list in `ShimmeringActiveStatus` can offer the same
 * hover detail without modifying sqlrooms. Renders a small dotted trigger that
 * reveals a hover card with the tool name, id, state, input and output.
 *
 * `onClick` stops propagation so the trigger can sit inside the clickable
 * status row without toggling the expanded list.
 */
export const ToolCallDetailHover: React.FC<{
  toolCall: AgentToolCall;
}> = ({toolCall}) => (
  <HoverCard openDelay={200} closeDelay={100}>
    <HoverCardTrigger asChild>
      <button
        type="button"
        onClick={(event) => event.stopPropagation()}
        className="text-muted-foreground/40 hover:text-muted-foreground shrink-0 cursor-pointer transition-colors"
      >
        <CircleDotIcon className="h-3 w-3" />
      </button>
    </HoverCardTrigger>
    <HoverCardContent side="top" className="w-72 p-2.5">
      <div className="mb-1 text-xs font-semibold text-gray-700 dark:text-gray-200">
        {toolCall.toolName}
      </div>
      <div className="text-[10px] text-gray-500 dark:text-gray-400">
        ID: {toolCall.toolCallId}
      </div>
      <div className="mt-1 text-[10px] text-gray-500 dark:text-gray-400">
        State:{' '}
        <span
          className={cn(
            toolCall.state === 'success' && 'text-green-600',
            toolCall.state === 'error' && 'text-red-600',
            toolCall.state === 'approval-requested' && 'text-amber-600',
            toolCall.state === 'pending' && 'text-yellow-600',
          )}
        >
          {toolCall.state}
        </span>
      </div>
      {toolCall.input != null && (
        <>
          <div className="my-2 flex h-5 items-center">
            <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400">
              Input
            </span>
          </div>
          <div className="relative">
            <pre className="mt-0.5 max-h-32 overflow-auto rounded bg-gray-50 p-1.5 pr-7 font-mono text-[10px] text-gray-600 dark:bg-gray-900 dark:text-gray-300">
              {typeof toolCall.input === 'string'
                ? toolCall.input
                : JSON.stringify(toolCall.input, null, 2)}
            </pre>
            <div className="absolute top-1 right-1">
              <CopyButton
                text={
                  typeof toolCall.input === 'string'
                    ? toolCall.input
                    : JSON.stringify(toolCall.input, null, 2)
                }
                size="xs"
                className="h-5 w-5"
              />
            </div>
          </div>
        </>
      )}
      {toolCall.output != null && (
        <>
          <div className="my-2 flex h-5 items-center">
            <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400">
              Output
            </span>
          </div>
          <div className="relative">
            <pre className="mt-0.5 max-h-32 overflow-auto rounded bg-gray-50 p-1.5 pr-7 font-mono text-[10px] text-gray-600 dark:bg-gray-900 dark:text-gray-300">
              {typeof toolCall.output === 'string'
                ? toolCall.output
                : JSON.stringify(toolCall.output, null, 2)}
            </pre>
            <div className="absolute top-1 right-1">
              <CopyButton
                text={
                  typeof toolCall.output === 'string'
                    ? toolCall.output
                    : JSON.stringify(toolCall.output, null, 2)
                }
                size="xs"
                className="h-5 w-5"
              />
            </div>
          </div>
        </>
      )}
      {toolCall.errorText && (
        <div className="mt-1.5 text-[10px] text-red-600">
          {toolCall.errorText}
        </div>
      )}
    </HoverCardContent>
  </HoverCard>
);
