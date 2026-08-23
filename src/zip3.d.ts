/**
 * zip3 ships no TypeScript types. It exposes a map of 3-digit ZIP prefixes to
 * {state, city, ...}. Declared as `any` so the geo.us-boundary provider can
 * resolve a zipcode prefix to its state code.
 */
declare module 'zip3';
