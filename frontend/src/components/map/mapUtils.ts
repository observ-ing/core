/** Approximate meters per degree of latitude at the equator */
export const METERS_PER_DEGREE = 111320;

/** Create a GeoJSON circle polygon from center point and radius in meters */
export function createCircleGeoJSON(
  lng: number,
  lat: number,
  radiusMeters: number,
): GeoJSON.FeatureCollection {
  const points = 64;
  const coords: [number, number][] = [];

  for (let i = 0; i < points; i++) {
    const angle = (i / points) * 2 * Math.PI;
    const dx = radiusMeters * Math.cos(angle);
    const dy = radiusMeters * Math.sin(angle);

    // Convert meters to degrees (approximate)
    const latOffset = dy / METERS_PER_DEGREE;
    const lngOffset = dx / (METERS_PER_DEGREE * Math.cos((lat * Math.PI) / 180));

    coords.push([lng + lngOffset, lat + latOffset]);
  }
  const first = coords[0];
  if (first) coords.push(first); // Close the polygon

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [coords],
        },
      },
    ],
  };
}
