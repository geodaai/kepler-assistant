/**
 * Geo provider clients for the analysis engine's `geo.*` tools — Mapbox
 * (routing/isochrone), Nominatim (geocode), OSM Overpass (roads), and public
 * GitHub datasets (US boundaries, incl. zipcode via `zip3`). Pure network code,
 * kepler-agnostic: the engine supplies the Mapbox token / map boundary through
 * the KeplerBridge and persists results via `bridge.saveResult`.
 *
 * The rate limiters, timeout helper, and fetch-signal combiner were moved
 * verbatim from the kepler.gl demo-app (`examples/demo-app/.../tools/utils.ts`)
 * so the engine preserves the same throttling and abort behavior.
 */

import zips from 'zip3';
import {bbox} from '@turf/bbox';
import type {Feature, FeatureCollection} from 'geojson';

/** Max time a single provider fetch may take before it aborts. */
export const FETCH_TIMEOUT_MS = 5_000;

/** Combine a timeout signal with an optional caller abort signal. */
export function combineSignals(
  timeoutMs: number,
  abortSignal?: AbortSignal | null
): {signal: AbortSignal; cleanup: () => void} {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);
  const signals = [timeoutController.signal];
  if (abortSignal) signals.push(abortSignal);
  const combined = AbortSignal.any(signals.filter((s): s is AbortSignal => !!s));
  return {signal: combined, cleanup: () => clearTimeout(timeoutId)};
}

/** Serialized rate limiter — one call per `minInterval` ms. */
export class RateLimiter {
  private lastCallTime = 0;
  private queue: Promise<void> = Promise.resolve();
  constructor(private minInterval: number = 1000) {}
  async waitForNextCall(): Promise<void> {
    this.queue = this.queue.then(async () => {
      const now = Date.now();
      const elapsed = now - this.lastCallTime;
      const waitTime = this.lastCallTime === 0 ? 0 : Math.max(0, this.minInterval - elapsed);
      if (waitTime > 0) {
        await new Promise(r => setTimeout(r, waitTime));
      }
      this.lastCallTime = Date.now();
    });
    return this.queue;
  }
}

export const mapboxRateLimiter = new RateLimiter(1000);
export const nominatimRateLimiter = new RateLimiter(1000);
export const overpassRateLimiter = new RateLimiter(1000);
export const githubRateLimiter = new RateLimiter(1000);

export interface LatLng {
  longitude: number;
  latitude: number;
}

/** Geographic bounding box (in decimal degrees). */
export interface GeoBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** A Mapbox access token (undefined when not configured). */
export type MapboxToken = string | undefined;

/** GET/POST a URL with the shared timeout + abort semantics, returning JSON. */
async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const {signal, cleanup} = combineSignals(FETCH_TIMEOUT_MS, init?.signal);
  try {
    const response = await fetch(url, {...init, signal});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    cleanup();
  }
}

// --- Mapbox ---

/**
 * Routing directions (Mapbox Directions v5). Returns the route geometry plus
 * distance/duration. Throws when no Mapbox token is available.
 */
export async function mapboxRouting(
  origin: LatLng,
  destination: LatLng,
  mode: 'driving' | 'walking' | 'cycling',
  token: MapboxToken
): Promise<{geojson: FeatureCollection; distance: number; duration: number}> {
  if (!token) {
    throw new Error(
      "geo.routing requires a Mapbox access token — set one in the app's Mapbox token field"
    );
  }
  await mapboxRateLimiter.waitForNextCall();
  const url = `https://api.mapbox.com/directions/v5/mapbox/${mode}/${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}?geometries=geojson&access_token=${token}`;
  const data = await fetchJson(url);
  if (!data.routes || data.routes.length === 0) throw new Error('No routes found');
  const route = data.routes[0];
  return {
    geojson: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {type: 'LineString', coordinates: route.geometry.coordinates},
          properties: {}
        }
      ]
    },
    distance: route.distance,
    duration: route.duration
  };
}

/** Isochrone polygons (Mapbox Isochrone API) for a time or distance limit. */
export async function mapboxIsochrone(
  origin: LatLng,
  limits: {timeLimit?: number; distanceLimit?: number; profile: 'driving' | 'walking' | 'cycling'},
  token: MapboxToken
): Promise<FeatureCollection> {
  if (!token) {
    throw new Error(
      "geo.isochrone requires a Mapbox access token — set one in the app's Mapbox token field"
    );
  }
  await mapboxRateLimiter.waitForNextCall();
  const {timeLimit, distanceLimit, profile} = limits;
  let url = `https://api.mapbox.com/isochrone/v1/mapbox/${profile}/${origin.longitude},${origin.latitude}?`;
  url += distanceLimit != null ? `contours_meters=${distanceLimit}` : `contours_minutes=${timeLimit ?? 10}`;
  url += `&polygons=true&access_token=${token}`;
  const data = await fetchJson(url);
  if (!data.features || data.features.length === 0) throw new Error('No isochrone data returned');
  return {
    type: 'FeatureCollection',
    features: data.features.map((f: any) => ({
      type: 'Feature',
      geometry: f.geometry,
      properties: {}
    }))
  };
}

// --- Nominatim geocoding ---

/** Forward geocode an address via OpenStreetMap's Nominatim. */
export async function nominatimGeocode(address: string): Promise<FeatureCollection> {
  await nominatimRateLimiter.waitForNextCall();
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json`;
  const data = await fetchJson(url, {
    headers: {Accept: 'application/json', 'User-Agent': 'kepler-gl-ai-assistant/1.0'}
  });
  if (!Array.isArray(data) || data.length === 0) throw new Error('No geocoding results found');
  return {
    type: 'FeatureCollection',
    features: data.slice(0, 5).map((r: any) => ({
      type: 'Feature',
      geometry: {type: 'Point', coordinates: [Number(r.lon), Number(r.lat)]},
      properties: {name: r.display_name}
    }))
  };
}

// --- OSM Overpass (roads) ---

/** Fetch road networks from the OSM Overpass API within a bounding box. */
export async function overpassRoads(bounds: GeoBounds): Promise<FeatureCollection> {
  const {south, west, north, east} = bounds;
  const query = `[out:json][timeout:25];(way[highway~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|living_street|path|track|road)$"](${south},${west},${north},${east}););out body;>;out skel qt;`;
  await overpassRateLimiter.waitForNextCall();
  const {signal, cleanup} = combineSignals(FETCH_TIMEOUT_MS);
  try {
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: query,
      signal
    });
    if (!response.ok) throw new Error(`Overpass API request failed: ${response.statusText}`);
    const data = await response.json();

    const nodeMap = new Map<number, {lon: number; lat: number}>();
    const ways: {id: number; nodes: number[]; tags: {highway?: string; name?: string}}[] = [];
    data.elements.forEach((element: any) => {
      if (element.type === 'node') nodeMap.set(element.id, element);
      else if (element.type === 'way') ways.push(element);
    });

    const features: Feature[] = [];
    for (const way of ways) {
      const coordinates = way.nodes.map(nodeId => {
        const node = nodeMap.get(nodeId);
        if (!node) throw new Error(`Node ${nodeId} not found`);
        return [node.lon, node.lat];
      });
      features.push({
        type: 'Feature',
        geometry: {type: 'LineString', coordinates},
        properties: {
          id: way.id,
          highway: way.tags.highway,
          name: way.tags.name || 'Unnamed Road'
        }
      });
    }
    return {type: 'FeatureCollection', features};
  } finally {
    cleanup();
  }
}

// --- US boundaries (GitHub public datasets) ---

/** Fetch US state, county, or zipcode boundary features from GitHub datasets. */
export async function usBoundaries(
  type: 'state' | 'county' | 'zipcode',
  ids: string[]
): Promise<Feature[]> {
  const features: Feature[] = [];
  for (const id of ids) {
    await githubRateLimiter.waitForNextCall();
    let url: string;
    if (type === 'state') {
      url = `https://raw.githubusercontent.com/glynnbird/usstatesgeojson/master/${id}.geojson`;
    } else if (type === 'county') {
      const stateCode = id.slice(0, 2);
      url = `https://raw.githubusercontent.com/hyperknot/country-levels-export/master/geojson/medium/fips/${stateCode}/${id}.geojson`;
    } else {
      const stateCode = zips[id.slice(0, 3)]?.state;
      if (!stateCode) throw new Error(`Unknown zipcode prefix for ${id}`);
      url = `https://raw.githubusercontent.com/greencoder/us-zipcode-to-geojson/refs/heads/master/data/${stateCode}/${id}.geojson`;
    }

    const geojson: any = await fetchJson(url);
    if (type === 'zipcode' && geojson && 'features' in geojson) {
      // drop the first centroid feature
      geojson.features.shift();
      features.push(...geojson.features);
    } else if (geojson && 'features' in geojson) {
      features.push(...geojson.features);
    } else if (geojson) {
      features.push(geojson);
    }
  }
  return features;
}

/** Bounding box of a feature array, in the {south,west,north,east} shape. */
export function featuresBbox(features: unknown[]): GeoBounds {
  const [minX, minY, maxX, maxY] = bbox({type: 'FeatureCollection', features} as FeatureCollection);
  return {south: minY, west: minX, north: maxY, east: maxX};
}
