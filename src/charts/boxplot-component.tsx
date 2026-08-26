// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project

import React, {useMemo, useRef} from 'react';
// Use the ESM build (`esm/core`, the package's `module` entry) rather than
// `lib/core`. The CJS `lib/core` exports both `__esModule` and
// `exports.default`; when this ESM package is bundled by esbuild the import is
// treated with Node-style interop (`__toESM(mod, 1)`), so a bare default import
// resolves to the whole `module.exports` object instead of the component and
// React throws "Element type is invalid … got: object".
import ReactEChartsCore from 'echarts-for-react/esm/core';

import * as echarts from 'echarts/core';
import {use as echartsUse, registerTheme as echartsRegisterTheme} from 'echarts/core';
import {BoxplotChart, ScatterChart} from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  ToolboxComponent,
  BrushComponent
} from 'echarts/components';
import {CanvasRenderer} from 'echarts/renderers';

import {ECHARTS_DARK_THEME} from './echarts-theme';
import {getBoxplotChartOption, type BoxplotDataProps} from './boxplot-option';

echartsUse([
  BoxplotChart,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  ToolboxComponent,
  BrushComponent,
  CanvasRenderer
]);

echartsRegisterTheme('dark', ECHARTS_DARK_THEME);

/**
 * Props for the boxplot chart. Mirrors `@openassistant/echarts`'s
 * `BoxplotOutputData`. `rawDataIndices[var][i]` holds the kepler dataset row
 * index for raw value `rawData[var][i]`, which powers the brush-selection
 * callback (brushed raw points → their original rows → map highlighting).
 */
export type BoxplotOutputData = {
  datasetName: string;
  /** Variable names, in the same order as `boxplotData.boxplots`. */
  variables: string[];
  boxplotData: BoxplotDataProps;
  /** Raw values per variable; each value becomes a scatter point. */
  rawData: Record<string, number[]>;
  /** Dataset row index per raw value; absent for non-kepler sources. */
  rawDataIndices?: Record<string, number[]>;
  onSelected?: (datasetName: string, selectedIndices: number[]) => void;
  theme?: string;
  /** Fixed chart height in px. Defaults to 260. */
  height?: number;
};

/**
 * ECharts box plot, copied from `@openassistant/echarts` (`BoxplotComponent`)
 * and adapted to plain Tailwind styling. Draws a box-and-whisker per variable
 * (whiskers at the `boundIQR` fences), the raw values as scatter strips, and a
 * green mean marker. Brushing a variable's raw points calls `onSelected` with
 * the matching dataset row indexes (see `rawDataIndices`).
 */
export function BoxplotComponent({
  datasetName,
  variables,
  boxplotData,
  rawData,
  rawDataIndices,
  onSelected,
  theme,
  height = 260
}: BoxplotOutputData): React.JSX.Element | null {
  const option = useMemo(() => {
    try {
      return getBoxplotChartOption({
        rawData,
        boxplots: boxplotData.boxplots,
        meanPoint: boxplotData.meanPoint,
        theme: theme || 'dark'
      });
    } catch {
      return {};
    }
  }, [rawData, boxplotData, theme]);

  const eChartsRef = useRef<ReactEChartsCore>(null);

  const bindEvents = useMemo(() => {
    return {
      brushSelected: function (params: {
        batch: Array<{
          selected: Array<{
            seriesIndex: number;
            dataIndex: number[];
          }>;
        }>;
      }) {
        const brushed: number[] = [];
        const brushComponent = params.batch[0];
        if (brushComponent) {
          for (const entry of brushComponent.selected) {
            // Only the raw-value scatter series are brushable; map each series
            // back to its variable, then each data index to its dataset row.
            const variableName = variables[entry.seriesIndex];
            const indices = variableName ? rawDataIndices?.[variableName] : undefined;
            if (!indices) continue;
            for (const dataIndex of entry.dataIndex as number[]) {
              const rowIndex = indices[dataIndex];
              if (rowIndex !== undefined) brushed.push(rowIndex);
            }
          }
        }

        if (brushed.length === 0) {
          const chart = eChartsRef.current;
          chart?.getEchartsInstance().dispatchAction({type: 'downplay'});
        }

        onSelected?.(datasetName ?? '', brushed);
      }
    };
  }, [datasetName, onSelected, variables, rawDataIndices]);

  if (!boxplotData?.boxplots?.length) {
    return null;
  }

  return (
    <div
      style={{height}}
      className="flex w-full flex-col rounded-lg bg-gray-950 p-4 text-gray-100 shadow"
    >
      <div className="flex-col items-start p-1">
        <p className="text-[10px] font-bold uppercase">{variables.join(', ')}</p>
      </div>
      <div className="min-h-0 grow py-2">
        <ReactEChartsCore
          echarts={echarts}
          option={option}
          notMerge={true}
          lazyUpdate={true}
          style={{height: '100%', width: '100%'}}
          ref={eChartsRef}
          theme={theme || 'dark'}
          onEvents={bindEvents}
        />
      </div>
    </div>
  );
}
