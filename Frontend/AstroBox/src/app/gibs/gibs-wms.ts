import type * as Cesium from 'cesium';

/** NASA GIBS "best available" WMS endpoint in geographic projection (EPSG:4326). */
export const GIBS_WMS_EPSG4326_URL =
  'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';

/** GIBS layer with daily GHRSST MUR 0.25° sea surface temperature anomalies. */
export const GIBS_SEA_SURFACE_TEMPERATURE_ANOMALY_LAYER =
  'GHRSST_L4_MUR25_Sea_Surface_Temperature_Anomalies';

/** GIBS layer with NASA GPM IMERG precipitation rate (already used by the app). */
export const GIBS_PRECIPITATION_RATE_LAYER = 'IMERG_Precipitation_Rate';

export interface GibsWmsLayerOptions {
  /** GIBS layer identifier, e.g. GHRSST_L4_MUR25_Sea_Surface_Temperature_Anomalies. */
  layer: string;
  /** ISO 8601 date (YYYY-MM-DD) sent as the WMS TIME parameter. */
  time: string;
  /** Attribution shown in the Cesium credit display. */
  credit: string;
}

/**
 * Creates a Cesium imagery provider for a NASA GIBS WMS layer using
 * WMS 1.1.1, EPSG:4326, transparent PNG tiles and a geographic tiling scheme.
 */
export function createGibsWmsProvider(
  cesium: typeof Cesium,
  options: GibsWmsLayerOptions,
): Cesium.WebMapServiceImageryProvider {
  return new cesium.WebMapServiceImageryProvider({
    url: GIBS_WMS_EPSG4326_URL,
    layers: options.layer,
    parameters: {
      service: 'WMS',
      version: '1.1.1',
      request: 'GetMap',
      styles: '',
      format: 'image/png',
      transparent: true,
      time: options.time,
    },
    tilingScheme: new cesium.GeographicTilingScheme(),
    enablePickFeatures: false,
    credit: options.credit,
  });
}

/** Formats a Date as an ISO calendar date (YYYY-MM-DD) in UTC. */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
