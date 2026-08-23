/**
 * Minimal type declaration for `redux-actions` (the package ships no types).
 * Only the surface the kepler assistant reducer uses is declared.
 */
declare module 'redux-actions' {
  export function handleActions<State, Payload = any>(
    reducerMap: Record<string, (state: State, action: {payload: Payload}) => State>,
    initialState: State
  ): (state: State | undefined, action: {type: string; payload?: Payload}) => State;

  export function createAction<Payload = any>(
    type: string,
    payloadCreator?: (...args: any[]) => Payload
  ): (...args: any[]) => {type: string; payload: Payload};
}
