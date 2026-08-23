/**
 * Type shim for the `updateDataset` action.
 *
 * `updateDataset` is a new kepler.gl action (3.3.0-alpha.4) that writes a
 * computed column back into a kepler dataset. It is not present in the published
 * `@kepler.gl/actions@^3.2.0` dist that kepler-assistant resolves for its
 * standalone build. The demo-app bundles kepler-assistant against the local
 * kepler.gl source (which has the real action), so this augmentation only fills
 * the type gap for the package's own `tsc`/`tsup` build.
 */
declare module '@kepler.gl/actions' {
  export function updateDataset(
    dataId: string,
    payload: {
      cols: unknown[];
      fields: unknown[];
      arrowTable: unknown;
    }
  ): {type: string; dataId: string; payload: unknown};

  export function layerSetIsValid(layer: unknown, isValid: boolean): {type: string};
}

// Make this a module file so the `declare module` blocks above become module
// augmentations (merging with the real @kepler.gl/actions package) rather than
// ambient module declarations that shadow it.
export {};
