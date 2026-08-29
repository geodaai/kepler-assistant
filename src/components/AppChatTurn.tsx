import type {ChatTurnSlotProps} from '@sqlrooms/ai-core';
import React from 'react';
import {TurnIdContext} from './TurnIdContext';

/**
 * Library-local `Turn` slot that renders sqlrooms' default turn layout
 * unchanged while exposing the turn's id through {@link TurnIdContext}. The
 * `Actions` slot is bound per turn but receives no turn identity, so
 * `AppChatActions` reads the id here to scope its "Agent Thoughts" box to the
 * turn the action row belongs to.
 *
 * The markup below mirrors sqlrooms' `DefaultChatTurn` exactly; if the layout
 * drifts, the library keeps its own copy so nothing upstream needs changing.
 */
export const AppChatTurn: React.FC<ChatTurnSlotProps> = ({turn}) => {
  const Prompt = turn.prompt.Content;
  const Timeline = turn.timeline.Content;
  const Error = turn.error?.Content;
  const Actions = turn.actions.Content;
  return (
    <TurnIdContext.Provider value={turn.id}>
      <div className="group mb-4 flex w-full flex-col gap-2 pb-2 text-sm">
        <div className="bg-background sticky top-0 z-10 mb-2 flex items-center gap-2 text-gray-700 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.15)] dark:text-gray-100 dark:shadow-[0_4px_6px_-1px_rgba(0,0,0,0.4)]">
          <Prompt />
        </div>
        <div className="flex w-full flex-col gap-2">
          <Timeline />
          {Error && <Error />}
          <Actions />
        </div>
      </div>
    </TurnIdContext.Provider>
  );
};
