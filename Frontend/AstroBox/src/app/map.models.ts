export interface FireObservation {
  id: string;
  title: string;
  date: string;
  longitude: number;
  latitude: number;
}

export type VisualizationId = 'wildfires' | 'precipitation';
