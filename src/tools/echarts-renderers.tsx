import React from 'react';
import type {ToolRenderer, ToolRendererRegistry} from '@sqlrooms/ai-core';
import type {ExecuteApiOutput} from '../chat';
import {BoxplotComponent} from '../charts/boxplot-component';
import {HistogramComponent} from '../charts/histogram-component';
import type {BoxplotDataProps} from '../charts/boxplot-option';

/**
 * Histogram output types consumed by the renderer. The chart compute itself
 * lives in the shared kepler-assistant engine; these mirror the subset of the
 * engine's `chart.histogram` result the renderer needs (`data.__ui`).
 */
export type HistogramBin = {
  bin: number;
  binStart: number;
  binEnd: number;
};

export type HistogramToolOutput = {
  success: boolean;
  datasetName: string;
  variableName: string;
  numberOfBins?: number;
  totalValues?: number;
  histogramData: (HistogramBin & {count: number})[];
  /**
   * Row indexes per bin (`barDataIndexes[i]` are the rows in bin `i`). Used by
   * the ECharts renderer for brush-selection → map highlighting. Not meant for
   * the LLM to read.
   */
  barDataIndexes?: number[][];
  /**
   * Which data source the values came from. `'kepler'` rows line up with the
   * map so brush-selection highlights features; `'duckdb'` rows don't, so the
   * brush is inert. The renderer uses this to decide whether to wire the
   * selection callback and whether to show the inert-brush note.
   */
  source?: 'kepler' | 'duckdb';
  details?: string;
  error?: string;
};

/**
 * Renderer-only payload for the histogram command, carried under `data.__ui`
 * (not surfaced to the model, stripped by MCP adapters).
 */
export type HistogramUiPayload = {
  histogramData: (HistogramBin & {count: number})[];
  barDataIndexes?: number[][];
  source?: 'kepler' | 'duckdb';
};

export type BoxplotToolOutput = {
  success: boolean;
  datasetName: string;
  variableNames?: string[];
  details?: string;
  error?: string;
};

/**
 * Renderer-only payload for the `chart.boxplot` command, carried under
 * `data.__ui` (not surfaced to the model, stripped by MCP adapters).
 */
export type BoxplotUiPayload = {
  boxplotData: BoxplotDataProps;
  rawData: Record<string, number[]>;
  rawDataIndices?: Record<string, number[]>;
  source?: 'kepler' | 'duckdb';
};

/**
 * Bridge for the chart brush-selection callbacks (histogram + boxplot). The
 * tool renderers are standalone components in the registry and have no access
 * to the kepler context, so the store registers a handler here that highlights
 * the selected rows.
 */
type ChartSelectionHandler = (datasetName: string, selectedIndices: number[]) => void;

let chartSelectionHandler: ChartSelectionHandler | undefined;

export function setChartSelectionHandler(handler: ChartSelectionHandler | undefined) {
  chartSelectionHandler = handler;
}

/**
 * Render the histogram produced by the `chart.histogram` command.
 *
 * Charts are now routed through `executeApi` (`executeCommand` with
 * `commandId: "chart.histogram"`), so the tool name reported to the UI is
 * `executeApi`, not `histogramTool`. This renderer is registered under the
 * `executeApi` key and dispatches on `output.commandId` to decide whether the
 * output is a histogram (draw the ECharts component) or some other command
 * (fall through to the default text rendering).
 */
const HistogramChartRenderer: ToolRenderer<
  ExecuteApiOutput & HistogramToolOutput & {__ui?: HistogramUiPayload}
> = ({output, state, errorText}) => {
  // Only handle the histogram command; non-histogram executeApi output is left
  // for the default renderer by returning null (the registry falls through).
  if (!output || output.commandId !== 'chart.histogram') {
    return null;
  }

  if (state === 'output-error') {
    return (
      <div className="text-destructive text-xs">
        Histogram failed: {errorText ?? output.error ?? 'Unknown error'}
      </div>
    );
  }

  if (!output.success) {
    if (state === 'input-streaming' || state === 'input-available') {
      return <div className="text-xs opacity-60">Building histogram…</div>;
    }
    return (
      <div className="text-destructive text-xs">
        Histogram failed: {output.error ?? 'No data returned'}
      </div>
    );
  }

  const ui = output.__ui;
  if (!ui?.histogramData?.length || !ui?.barDataIndexes?.length) {
    return <div className="text-xs opacity-60">No values to plot.</div>;
  }

  // Only kepler-sourced rows line up with the map, so brush-selection is only
  // wired in that case. DuckDB-only tables have no kepler layer to highlight,
  // so the brush is inert — surface that as a one-line note instead of a
  // silent dead interaction.
  const isKepler = ui.source !== 'duckdb';

  return (
    <div className="my-2 w-full">
      <HistogramComponent
        datasetName={output.datasetName}
        variableName={output.variableName}
        histogramData={ui.histogramData}
        barDataIndexes={ui.barDataIndexes}
        onSelected={
          isKepler
            ? (datasetName, selectedIndices) =>
                chartSelectionHandler?.(datasetName, selectedIndices)
            : undefined
        }
      />
      {!isKepler && (
        <div className="mt-1 text-[10px] opacity-60">
          Data is from a DuckDB-only table; brushing is not linked to the map.
        </div>
      )}
    </div>
  );
};

/**
 * Render the boxplot produced by the `chart.boxplot` command.
 *
 * Mirrors the histogram renderer: dispatch happens in `EchartsToolRenderer` on
 * `output.commandId`, and brush-selection is only wired for kepler-sourced rows
 * (`ui.source !== 'duckdb'`), since DuckDB-only tables have no kepler layer to
 * highlight.
 */
const BoxplotChartRenderer: ToolRenderer<
  ExecuteApiOutput & BoxplotToolOutput & {__ui?: BoxplotUiPayload}
> = ({output, state, errorText}) => {
  if (!output || output.commandId !== 'chart.boxplot') {
    return null;
  }

  if (state === 'output-error') {
    return (
      <div className="text-destructive text-xs">
        Boxplot failed: {errorText ?? output.error ?? 'Unknown error'}
      </div>
    );
  }

  if (!output.success) {
    if (state === 'input-streaming' || state === 'input-available') {
      return <div className="text-xs opacity-60">Building boxplot…</div>;
    }
    return (
      <div className="text-destructive text-xs">
        Boxplot failed: {output.error ?? 'No data returned'}
      </div>
    );
  }

  const ui = output.__ui;
  if (!ui?.boxplotData?.boxplots?.length) {
    return <div className="text-xs opacity-60">No values to plot.</div>;
  }

  // Only kepler-sourced rows line up with the map, so brush-selection is only
  // wired in that case. DuckDB-only tables have no kepler layer to highlight,
  // so the brush is inert — surface that as a one-line note instead of a
  // silent dead interaction.
  const isKepler = ui.source !== 'duckdb';

  return (
    <div className="my-2 w-full">
      <BoxplotComponent
        datasetName={output.datasetName}
        variables={output.variableNames ?? ui.boxplotData.boxplots.map(b => b.name)}
        boxplotData={ui.boxplotData}
        rawData={ui.rawData}
        rawDataIndices={ui.rawDataIndices}
        onSelected={
          isKepler
            ? (datasetName, selectedIndices) =>
                chartSelectionHandler?.(datasetName, selectedIndices)
            : undefined
        }
      />
      {!isKepler && (
        <div className="mt-1 text-[10px] opacity-60">
          Data is from a DuckDB-only table; brushing is not linked to the map.
        </div>
      )}
    </div>
  );
};

/**
 * Dispatcher for the echarts tool renderers, registered under the `executeApi`
 * key. Charts are routed through `executeApi` (the tool name reported to the UI
 * is always `executeApi`), so it dispatches on `output.commandId`: histogram →
 * `HistogramChartRenderer`, boxplot → `BoxplotChartRenderer`. Any other
 * `executeApi` output returns null so the registry falls through to the default
 * text rendering.
 */
const EchartsToolDispatcher: ToolRenderer<any> = props => {
  if (!props.output) return null;
  if (props.output.commandId === 'chart.histogram') {
    return HistogramChartRenderer(props as any);
  }
  if (props.output.commandId === 'chart.boxplot') {
    return BoxplotChartRenderer(props as any);
  }
  return null;
};

/**
 * Renderers for the echarts-style analytical tools, keyed by tool name so they
 * can be spread into the store `toolRenderers` registry.
 */
export function getEchartsToolRenderers(): ToolRendererRegistry {
  return {
    executeApi: EchartsToolDispatcher as ToolRenderer<any>
  };
}

/**
 * Renderer key(s) to hoist via `hoistedRenderers` in `MainView` so the chart
 * draws inline in the chat rather than as a collapsed tool call.
 */
export function getEchartsHoistedRenderers(): string[] {
  return Object.keys(getEchartsToolRenderers());
}