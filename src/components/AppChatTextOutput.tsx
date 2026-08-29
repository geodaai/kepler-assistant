import {MessageContent, type ChatTextOutputProps} from '@sqlrooms/ai-core';
import React from 'react';

/**
 * Library-local `TextOutput` slot. sqlrooms' `MessageContent` always wraps
 * markdown in an internal `MessageContainer` whose root is
 * `group relative w-full min-w-0 py-2 text-xs`, and that wrapper is not a
 * `Chat.Rendering` slot. This keeps `MessageContent` and zeros the baked-in
 * vertical padding on its root child.
 */
export const AppChatTextOutput: React.FC<ChatTextOutputProps> = ({
  text,
  isAnswer,
  searchBlockId,
  customMarkdownComponents,
}) => (
  <div className="[&>div]:!py-0">
    <MessageContent
      content={text}
      isAnswer={isAnswer}
      searchBlockId={searchBlockId}
      customMarkdownComponents={customMarkdownComponents}
    />
  </div>
);
