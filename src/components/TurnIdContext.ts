import React from 'react';

/**
 * Supplies the id of the chat turn an action row belongs to. sqlrooms' `Actions`
 * slot is bound per turn but receives no turn identity, so the library's thin
 * `Turn` wrapper (`AppChatTurn`) provides it here and `AppChatActions` uses it
 * to scope the "Agent Thoughts" box to its own turn.
 */
export const TurnIdContext = React.createContext<string | undefined>(undefined);
