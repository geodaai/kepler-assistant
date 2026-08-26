/**
 * Ambient declarations for the @geoda/* packages.
 *
 * The packages ship `.d.ts` under `dist/src/` but their `package.json` `exports`
 * don't map types correctly for Node ESM resolution, so TS can't resolve the
 * module. Declare them loosely here (the exact result shapes are JSON returned
 * by the WASM bindings).
 */
declare module '@geoda/core' {
  export function initWASM(url?: string): Promise<unknown>;
  export function resetWASM(): Promise<void>;
  export function setDeliveryWASM(url: string): void;
  export function quantileBreaks(k: number, values: number[]): Promise<number[]>;
  export function naturalBreaks(k: number, values: number[]): Promise<number[]>;
  export function equalIntervalBreaks(k: number, values: number[]): Promise<number[]>;
  export function percentileBreaks(values: number[]): Promise<number[]>;
  export function standardDeviationBreaks(values: number[]): Promise<number[]>;
  export function hinge15Breaks(values: number[]): Promise<number[]>;
  export function hinge30Breaks(values: number[]): Promise<number[]>;
  export function createWeights(props: any): Promise<any>;
  export function standardize(values: number[]): Promise<number[]>;
  export function standardizeMAD(values: number[]): Promise<number[]>;
  export function deviationFromMean(values: number[]): Promise<number[]>;
  export function rangeAdjust(values: number[]): Promise<number[]>;
  export function rangeStandardize(values: number[]): Promise<number[]>;
  export function rawRates(event: number[], base: number[]): Promise<number[]>;
  export function excessRisk(event: number[], base: number[]): Promise<number[]>;
  export function empiricalBayes(event: number[], base: number[]): Promise<number[]>;
  export function getThiessenPolygons(props: {geoms: any[]}): Promise<any[]>;
  export function getMinimumSpanningTree(props: {geoms: any[]}): Promise<any[]>;
  export function getCartogram(geometries: any[], values: number[], iterations: number): Promise<any[]>;
}

declare module '@geoda/lisa' {
  export function localMoran(props: any): Promise<any>;
  export function localGeary(props: any): Promise<any>;
  export function spatialLag(values: any, weights: any): Promise<any>;
  // Local Join Count — univariate colocation (`data: number[]`) and bivariate
  // no-colocation (`data: number[][]`). Result carries `clusters`, `pValues`,
  // `labels`, `colors`, `lisaValues`.
  export function localJoinCount(props: {data: number[]; neighbors: number[][]; permutation?: number; significanceCutoff?: number; seed?: number}): Promise<any>;
  export function localBiJoinCount(props: {data: number[][]; neighbors: number[][]; permutation?: number; significanceCutoff?: number; seed?: number}): Promise<any>;
}

declare module '@geoda/regression' {
  export function linearRegression(props: any): Promise<any>;
  export function spatialLagRegression(props: any): Promise<any>;
  export function spatialError(props: any): Promise<any>;
}
