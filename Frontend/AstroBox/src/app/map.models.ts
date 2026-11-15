export interface FireObservation {
  id: string;
  title: string;
  date: string;
  longitude: number;
  latitude: number;
}

/** `seaTemperature` is only offered on the 3D globe. */
export type VisualizationId = 'wildfires' | 'precipitation' | 'seaTemperature';
