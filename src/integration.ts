/**
 * Integration for applications that own their SQLRooms store and chat UI.
 * This entry never imports the standalone store or creates a DuckDB connector.
 * Use this subpath consistently in a host app; the root entry is standalone.
 */
export {AI_SETTINGS} from './chat/config';
export {
  createKeplerAssistantInstructions,
  createKeplerAssistantTools,
  skillStorage
} from './assistant-tools';
export * from './kepler-context';
export {getAllCommands, KEPLER_COMMAND_OWNER} from './commands';
export {getConnector, setStoreConnectorProvider, tableToLLMResult} from './glue/utils';
export {getEchartsToolRenderers} from './tools/echarts-renderers';
export * from './reducer';
export * from './screenshot-actions';
export {default as AiAssistantControlFactory} from './map/ai-assistant-control';
export type {KeplerStateAccessors, KeplerContext} from './mcp';
