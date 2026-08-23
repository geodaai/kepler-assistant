/** A command/tool execution result. */
export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}
