// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project

import type {EChartsOption} from 'echarts';
import type {YAXisOption, XAXisOption} from 'echarts/types/dist/shared';

import {numericFormatter} from './histogram-option';

/**
 * Per-variable boxplot summary consumed by the ECharts option builder. Mirrors
 * `@openassistant/plots`'s `BoxplotProps` — whiskers sit at the `boundIQR`
 * fences (`low = q1 - boundIQR*iqr`, `high = q3 + boundIQR*iqr`), with any raw
 * points beyond them rendered as scatter outliers.
 */
export type BoxplotBox = {
  name: string;
  low: number;
  q1: number;
  q2: number;
  q3: number;
  high: number;
  mean: number;
  std: number;
  iqr: number;
};

/**
 * Boxplot series payload, mirroring `@openassistant/plots`'s
 * `BoxplotDataProps` — `meanPoint` is the `[variableName, mean]` pairs for the
 * mean markers.
 */
export type BoxplotDataProps = {
  boxplots: BoxplotBox[];
  meanPoint: [string, number][];
};

export type BoxplotOptionProps = {
  /** Raw values per variable; each value becomes a scatter point. */
  rawData: Record<string, number[]>;
  boxplots: BoxplotBox[];
  meanPoint: [string, number][];
  theme?: string;
};

/**
 * Builds the ECharts option for a boxplot. Ported from
 * `@openassistant/echarts` (`getBoxPlotChartOption`, collapsed layout) so the
 * chart renders identically without depending on the OpenAssistant packages at
 * runtime: one scatter strip per variable (raw values), the box-and-whisker
 * series, and a mean marker per variable. The brush is scoped to the scatter
 * series so brushing a variable surfaces the underlying data points.
 */
export function getBoxplotChartOption({
  rawData,
  boxplots,
  meanPoint,
  theme = 'dark'
}: BoxplotOptionProps): EChartsOption {
  // One scatter strip per variable: each point is [value, dataIndex] so the
  // dots spread vertically down the variable's category slot.
  const pointsData = Object.values(rawData).map((values, dataIndex) =>
    values.map(value => [value, dataIndex] as [number, number])
  );
  const meanPointData = meanPoint.map(
    (mp, dataIndex) => [mp[1], dataIndex] as [number, number]
  );

  const scatterSeries = pointsData.map(data => ({
    type: 'scatter' as const,
    data,
    symbolSize: data.length > 1000 ? 4 : 6,
    symbol: (data.length > 1000 ? 'rect' : 'circle') as 'circle' | 'rect',
    itemStyle: {
      color: 'lightblue',
      borderColor: '#aaa'
    },
    emphasis: {
      focus: 'series' as const,
      symbolSize: 6,
      itemStyle: {
        color: 'red',
        borderWidth: 1
      }
    }
  }));

  const series = [
    ...scatterSeries,
    {
      type: 'boxplot' as const,
      data: boxplots.map(b => [b.low, b.q1, b.q2, b.q3, b.high]),
      itemStyle: {
        borderColor: theme === 'dark' ? 'white' : 'black',
        color: '#DB631C',
        opacity: 1
      },
      emphasis: {
        focus: 'none' as const,
        disabled: true
      }
    },
    {
      type: 'scatter' as const,
      data: meanPointData,
      symbol: 'diamond' as const,
      symbolSize: 8,
      itemStyle: {
        color: '#14C814',
        borderColor: 'black',
        opacity: 1
      }
    }
  ];

  const yAxis = {
    type: 'category' as const,
    boundaryGap: true,
    splitArea: {show: false},
    splitLine: {
      show: false,
      lineStyle: {color: theme === 'dark' ? '#333' : '#f3f3f3'}
    },
    axisLine: {show: false},
    axisTick: {show: true},
    axisLabel: {
      formatter: (d: string, i: number) => boxplots[i]?.name ?? ''
    }
  } as YAXisOption;

  const xAxis = {
    type: 'value' as const,
    axisLabel: {
      formatter: numericFormatter
    },
    splitLine: {
      show: false,
      lineStyle: {color: theme === 'dark' ? '#333' : '#f3f3f3'}
    },
    splitArea: {show: false},
    axisTick: {show: false},
    axisLine: {show: false}
  } as XAXisOption;

  const tooltip = {
    trigger: 'item',
    formatter: (params: any) => {
      if (!params || !params.value) return '';
      if (params.componentSubType === 'boxplot') {
        const [lo, q1, q2, q3, hi] = params.value as number[];
        return [
          params.name ?? '',
          `Min (whisker): ${numericFormatter(lo)}`,
          `Q1: ${numericFormatter(q1)}`,
          `Median: ${numericFormatter(q2)}`,
          `Q3: ${numericFormatter(q3)}`,
          `Max (whisker): ${numericFormatter(hi)}`
        ].join('<br/>');
      }
      if (params.componentSubType === 'scatter') {
        return `${numericFormatter(params.value[0])}`;
      }
      return '';
    }
  };

  const option: EChartsOption = {
    yAxis,
    xAxis,
    series,
    brush: {
      toolbox: ['rect', 'keep', 'clear'],
      xAxisIndex: 0,
      throttleType: 'debounce',
      brushLink: scatterSeries.map((_, index) => index),
      seriesIndex: scatterSeries.map((_, index) => index)
    },
    grid: [
      {
        left: '3%',
        right: '5%',
        top: '20%',
        bottom: '0%',
        containLabel: true,
        height: 'auto'
      }
    ],
    tooltip: tooltip as EChartsOption['tooltip'],
    // avoid flickering when brushing
    progressive: 0,
    animation: false
  };

  return option;
}
