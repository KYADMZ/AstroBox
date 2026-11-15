import type * as Cesium from 'cesium';

/**
 * Base map shared by the 3D globe and the 2D map.
 *
 * Esri World Street Map labels countries and places in English by default.
 * It replaces the standard OpenStreetMap tiles, whose labels use each
 * country's local language (e.g. "México", "Deutschland", "日本").
 * The tiles are public (no API key) and need the Esri attribution below.
 */
export const BASEMAP_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}';
export const BASEMAP_ATTRIBUTION = 'Tiles © Esri — Sources: Esri and its data partners';

export function createBasemapProvider(cesium: typeof Cesium): Cesium.UrlTemplateImageryProvider {
  return new cesium.UrlTemplateImageryProvider({
    url: BASEMAP_URL,
    credit: BASEMAP_ATTRIBUTION,
    maximumLevel: 19,
  });
}
