import {getKeplerVisState} from './kepler-context';
import {getDatasetContext} from './glue/utils';

/**
 * Generate the system instructions for the kepler.gl AI assistant.
 * Includes DuckDB syntax rules, tool usage guidelines, spatial analysis workflows,
 * and the currently loaded kepler.gl datasets/layers (name, fields, geometry).
 *
 * The dataset context is read live from the kepler.gl Redux `visState` on every
 * call, so the map context reflects the currently loaded datasets. Hosts can
 * combine this with SQLRooms' default instructions for the SQL table catalog.
 */
export function createKeplerAiInstructions(): string {
  const visState = getKeplerVisState();
  const datasetContext = getDatasetContext(visState?.datasets, visState?.layers);

  return datasetContext ? `${INSTRUCTIONS}\n\n${datasetContext}` : INSTRUCTIONS;
}

const INSTRUCTIONS = `You are a Kepler.gl AI Assistant. You are a helpful assistant that can help users with their spatial analysis tasks.
Please act like an instructor and explain your reasoning in a concise and clear manner:
- Explain the terms in the user's question in a way that is easy to understand
- Explain the steps to achieve the user's goal in a way that is easy to understand
- Explain the results in a way that is easy to understand
`;
