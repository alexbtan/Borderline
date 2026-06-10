import { geoMercator, geoPath } from "d3-geo";

import type { CountryFeature, FeatureCollection } from "@/lib/country-geo";
import { getCountryName } from "@/lib/country-geo";

export type GeoProjection = ReturnType<typeof geoMercator>;

export type WorldCountryPath = {
  id: string;
  name: string;
  path: string;
};

const MAP_PADDING = 24;

/**
 * Padding around the actual birth/death spread before applying the zoom floor.
 */
const SPREAD_PADDING = 0.55;

/** Dots in the same city — pull back to a broad regional view for orientation. */
const CLOSE_LON_THRESHOLD_DEG = 2;
const CLOSE_LAT_THRESHOLD_DEG = 1.5;
const CLOSE_MIN_LON_SPAN_DEG = 22;
const CLOSE_MIN_LAT_SPAN_DEG = 14;

/** Nearby but distinct places — moderate floor so the map is not city-level tight. */
const NEAR_MIN_LON_SPAN_DEG = 14;
const NEAR_MIN_LAT_SPAN_DEG = 9;

/**
 * When both dots sit inside a vast country, zoom out further so players can
 * orient within the region instead of seeing a tight local crop.
 */
type LargeRegion = {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
  minLonSpan: number;
  minLatSpan: number;
};

const LARGE_COUNTRY_REGIONS: LargeRegion[] = [
  { minLat: 18, maxLat: 54, minLon: 73, maxLon: 135, minLonSpan: 38, minLatSpan: 24 },
  { minLat: 41, maxLat: 72, minLon: 28, maxLon: 145, minLonSpan: 44, minLatSpan: 26 },
  { minLat: 24, maxLat: 50, minLon: -125, maxLon: -66, minLonSpan: 32, minLatSpan: 20 },
  { minLat: 42, maxLat: 70, minLon: -141, maxLon: -52, minLonSpan: 36, minLatSpan: 22 },
  { minLat: -34, maxLat: 5, minLon: -74, maxLon: -34, minLonSpan: 30, minLatSpan: 22 },
  { minLat: -44, maxLat: -10, minLon: 113, maxLon: 154, minLonSpan: 28, minLatSpan: 18 },
  { minLat: 8, maxLat: 36, minLon: 68, maxLon: 98, minLonSpan: 28, minLatSpan: 18 },
];

function pointInRegion(lat: number, lon: number, region: LargeRegion) {
  return (
    lat >= region.minLat &&
    lat <= region.maxLat &&
    lon >= region.minLon &&
    lon <= region.maxLon
  );
}

function getLargeCountryMinSpans(
  birth: { lat: number; lon: number },
  death: { lat: number; lon: number },
) {
  for (const region of LARGE_COUNTRY_REGIONS) {
    if (
      pointInRegion(birth.lat, birth.lon, region) &&
      pointInRegion(death.lat, death.lon, region)
    ) {
      return { minLon: region.minLonSpan, minLat: region.minLatSpan };
    }
  }
  return null;
}

function getMinSpans(
  rawLonSpan: number,
  rawLatSpan: number,
  birth: { lat: number; lon: number },
  death: { lat: number; lon: number },
) {
  const isVeryClose =
    rawLonSpan < CLOSE_LON_THRESHOLD_DEG && rawLatSpan < CLOSE_LAT_THRESHOLD_DEG;
  const base = isVeryClose
    ? { minLon: CLOSE_MIN_LON_SPAN_DEG, minLat: CLOSE_MIN_LAT_SPAN_DEG }
    : { minLon: NEAR_MIN_LON_SPAN_DEG, minLat: NEAR_MIN_LAT_SPAN_DEG };

  const largeCountry = getLargeCountryMinSpans(birth, death);
  if (!largeCountry) {
    return base;
  }

  return {
    minLon: Math.max(base.minLon, largeCountry.minLon),
    minLat: Math.max(base.minLat, largeCountry.minLat),
  };
}

function computeViewSpan(
  birth: { lat: number; lon: number },
  death: { lat: number; lon: number },
) {
  const centerLon = (birth.lon + death.lon) / 2;
  const centerLat = (birth.lat + death.lat) / 2;
  const rawLonSpan = Math.abs(birth.lon - death.lon);
  const rawLatSpan = Math.abs(birth.lat - death.lat);
  const { minLon, minLat } = getMinSpans(rawLonSpan, rawLatSpan, birth, death);

  const lonSpan = Math.max(rawLonSpan * (1 + SPREAD_PADDING), minLon);
  const latSpan = Math.max(rawLatSpan * (1 + SPREAD_PADDING), minLat);

  return { centerLon, centerLat, lonSpan, latSpan };
}

/**
 * d3's fitExtent on a lat/lon bounding polygon severely under-zooms on Mercator,
 * so scale is derived explicitly from the desired degree span instead.
 */
export function buildLifeMapProjection(
  birth: { lat: number; lon: number },
  death: { lat: number; lon: number },
  innerSize: number,
): GeoProjection {
  const { centerLon, centerLat, lonSpan, latSpan } = computeViewSpan(birth, death);
  const available = innerSize - MAP_PADDING * 2;
  const centerLatRad = (centerLat * Math.PI) / 180;
  const lonRad = (lonSpan * Math.PI) / 180;
  const latRad = (latSpan * Math.PI) / 180;

  const scaleForLon = available / (lonRad * Math.max(Math.cos(centerLatRad), 0.25));
  const scaleForLat = available / latRad;
  const scale = Math.min(scaleForLon, scaleForLat);

  return geoMercator()
    .center([centerLon, centerLat])
    .scale(scale)
    .translate([innerSize / 2, innerSize / 2]);
}

export function buildWorldCountryPaths(
  geojson: FeatureCollection,
  projection: GeoProjection,
): WorldCountryPath[] {
  const pathBuilder = geoPath(projection);
  return geojson.features
    .map((feature: CountryFeature) => {
      const path = pathBuilder(feature as never);
      if (!path) {
        return null;
      }
      return {
        id: String(feature.id ?? feature.properties?.ADM0_A3 ?? getCountryName(feature)),
        name: getCountryName(feature),
        path,
      };
    })
    .filter((entry): entry is WorldCountryPath => entry !== null);
}

export function projectLatLon(
  projection: GeoProjection,
  lat: number,
  lon: number,
): [number, number] | null {
  const point = projection([lon, lat]);
  if (!point) {
    return null;
  }
  return [point[0], point[1]];
}
