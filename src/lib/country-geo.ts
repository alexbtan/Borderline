import { geoArea, geoCentroid, geoMercator, geoPath } from "d3-geo";

export type FeatureCollection = {
  type: "FeatureCollection";
  features: CountryFeature[];
};

export type CountryFeature = {
  type: "Feature";
  id?: string;
  properties?: {
    name?: string;
    NAME?: string;
    ADMIN?: string;
    ADM0_A3?: string;
  };
  geometry: GeoJSON.Geometry;
};

export const DATASET_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson";

export function getCountryName(country: CountryFeature) {
  return country.properties?.name ?? country.properties?.ADMIN ?? country.properties?.NAME ?? "";
}

/** Natural Earth admin code; stable key for the allowlist file. */
export function getCountryCode(country: CountryFeature) {
  return String(country.properties?.ADM0_A3 ?? "").trim();
}

function featureArea(geometry: GeoJSON.Geometry) {
  return geoArea({
    type: "Feature",
    geometry,
    properties: {},
  } as GeoJSON.Feature);
}

type PolygonPart = {
  polygon: GeoJSON.Position[][]; // Polygon coordinates
  area: number;
  bounds: {
    minLon: number;
    maxLon: number;
    minLat: number;
    maxLat: number;
  };
};

const LOCAL_CLUSTER_MAX_DISTANCE_DEGREES = 6;

function polygonBounds(polygon: GeoJSON.Position[][]): PolygonPart["bounds"] {
  let minLon = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;

  for (const ring of polygon) {
    for (const [lon, lat] of ring) {
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }
  }

  return { minLon, maxLon, minLat, maxLat };
}

function intervalGap(a0: number, a1: number, b0: number, b1: number) {
  if (a1 < b0) {
    return b0 - a1;
  }
  if (b1 < a0) {
    return a0 - b1;
  }
  return 0;
}

function longitudeGap(a: PolygonPart["bounds"], b: PolygonPart["bounds"]) {
  return Math.min(
    intervalGap(a.minLon, a.maxLon, b.minLon, b.maxLon),
    intervalGap(a.minLon, a.maxLon, b.minLon - 360, b.maxLon - 360),
    intervalGap(a.minLon, a.maxLon, b.minLon + 360, b.maxLon + 360),
  );
}

function polygonPartDistance(a: PolygonPart, b: PolygonPart) {
  const dx = longitudeGap(a.bounds, b.bounds);
  const dy = intervalGap(
    a.bounds.minLat,
    a.bounds.maxLat,
    b.bounds.minLat,
    b.bounds.maxLat,
  );
  return Math.hypot(dx, dy);
}

export function getDisplayGeometry(country: CountryFeature): GeoJSON.Geometry {
  const { geometry } = country;

  if (geometry.type !== "MultiPolygon") {
    return geometry;
  }

  const polygons: PolygonPart[] = geometry.coordinates.map((polygon) => ({
    polygon,
    area: featureArea({
      type: "Polygon",
      coordinates: polygon,
    }),
    bounds: polygonBounds(polygon),
  }));

  if (!polygons.length) {
    return geometry;
  }

  const largestPolygon = polygons.reduce((largest, item) =>
    item.area > largest.area ? item : largest,
  );
  const keptParts = [largestPolygon];
  const remaining = polygons.filter((item) => item !== largestPolygon);

  // Keep nearby detached parts as one local outline (e.g. Istanbul side of Turkey,
  // Corsica for France), but drop far-away overseas territories (e.g. French Guiana).
  let addedPart = true;
  while (addedPart) {
    addedPart = false;
    for (let i = remaining.length - 1; i >= 0; i -= 1) {
      const candidate = remaining[i];
      const closeToCluster = keptParts.some(
        (part) =>
          polygonPartDistance(part, candidate) <= LOCAL_CLUSTER_MAX_DISTANCE_DEGREES,
      );
      if (closeToCluster) {
        keptParts.push(candidate);
        remaining.splice(i, 1);
        addedPart = true;
      }
    }
  }

  const keptPolygons = keptParts.map((item) => item.polygon);

  if (!keptPolygons.length) {
    return {
      type: "Polygon",
      coordinates: largestPolygon.polygon,
    };
  }

  if (keptPolygons.length === 1) {
    return {
      type: "Polygon",
      coordinates: keptPolygons[0],
    };
  }

  return {
    type: "MultiPolygon",
    coordinates: keptPolygons,
  };
}

export type BuildCountryMapPathOptions = {
  innerSize: number;
  minCountryMinEdgePx: number;
  maxSmallCountryZoom: number;
};

/** Path in coordinates 0..innerSize (place inside a translate(pad, pad) group). */
export function buildCountryMapPath(
  country: CountryFeature,
  options: BuildCountryMapPathOptions,
): { path: string; bounds: [[number, number], [number, number]] } {
  const { innerSize, minCountryMinEdgePx, maxSmallCountryZoom } = options;
  const displayGeometry = getDisplayGeometry(country);
  const [centerLon] = geoCentroid(displayGeometry as never);
  const projection = geoMercator()
    .rotate(Number.isFinite(centerLon) ? [-centerLon, 0] : [0, 0])
    .fitSize([innerSize, innerSize], displayGeometry as never);
  const pathBuilder = geoPath(projection);
  const [[x0, y0], [x1, y1]] = pathBuilder.bounds(displayGeometry as never) as [
    [number, number],
    [number, number],
  ];
  const bw = Math.max(0, x1 - x0);
  const bh = Math.max(0, y1 - y0);
  const minEdge = bw > 0 && bh > 0 ? Math.min(bw, bh) : 0;
  if (minEdge > 0 && minEdge < minCountryMinEdgePx) {
    const zoom = Math.min(minCountryMinEdgePx / minEdge, maxSmallCountryZoom);
    const centroid = geoCentroid(displayGeometry as never);
    const t = projection.translate();
    projection.scale(projection.scale() * zoom);
    const p = projection(centroid);
    if (p) {
      projection.translate([
        t[0] + innerSize / 2 - p[0],
        t[1] + innerSize / 2 - p[1],
      ]);
    }
  }
  const path = pathBuilder(displayGeometry as never) ?? "";
  const bounds = pathBuilder.bounds(displayGeometry as never) as [[number, number], [number, number]];
  return { path, bounds };
}
