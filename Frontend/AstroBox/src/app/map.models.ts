export interface FireObservation {
  id: string;
  title: string;
  date: string;
  longitude: number;
  latitude: number;
}

export type VisualizationId =
  | 'wildfires'
  | 'precipitation'
  | 'surfaceTemperature'
  | 'seaTemperature'
  | 'wind';

/** A geographic position in degrees. */
export interface GeoPoint {
  longitude: number;
  latitude: number;
}
