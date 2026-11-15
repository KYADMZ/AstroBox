import {
  GIBS_PRECIPITATION_RATE_LAYER,
  GIBS_SEA_SURFACE_TEMPERATURE_ANOMALY_LAYER,
} from '../gibs/gibs-wms';
import type {
  CameraDestination,
  CameraOrientation,
  StoryDefinition,
  StoryScene,
} from './story.models';

/**
 * El Niño guided story for the 2D map (about 90 seconds, five scenes).
 *
 * Scientific notes
 * - Observed data comes from NASA GIBS. Sea surface temperature anomalies use
 *   a date near the peak of the 2023–24 El Niño (NOAA ONI ≈ +2.0 °C in
 *   Nov–Jan), so viewers see a real, well-documented event.
 * - GIBS does not provide a ready-made precipitation ANOMALY layer, so the
 *   precipitation layer is a single-day observed snapshot (NASA GPM IMERG)
 *   and is labeled as such. Wetter/drier regions are drawn as simplified,
 *   illustrative zones following the typical El Niño tendencies published by
 *   NOAA's Climate Prediction Center; they are NOT observations.
 * - Mexico: El Niño winters tend to be wetter in northern and northwestern
 *   Mexico, while summer rainfall in central and southern Mexico tends to be
 *   reduced. These are tendencies (correlations), not guaranteed outcomes,
 *   and no specific weather event is attributed to El Niño.
 */

const TOP_DOWN: CameraOrientation = { heading: 0, pitch: -90, roll: 0 };

const GLOBAL_VIEW: CameraDestination = {
  kind: 'rectangle',
  west: -180,
  south: -58,
  east: 180,
  north: 72,
};

const SEA_SURFACE_TEMPERATURE_OPACITY = 0.8;

const SIMPLIFIED_RAINFALL_CAPTION =
  'Typical El Niño rainfall tendency (simplified, based on NOAA composites)';
const WETTER_COLOR = '#47c9d2';
const DRIER_COLOR = '#e0a458';
const REFERENCE_COLOR = '#ffd166';
const WIND_COLOR = '#e8efeb';
const WARM_WATER_COLOR = '#ff8555';

const sceneOceanWarms: StoryScene = {
  id: 'ocean-begins-to-warm',
  title: 'The Ocean Begins to Warm',
  durationMs: 15_000,
  narration:
    'El Niño is a natural climate phenomenon caused by interactions between the ocean and the atmosphere. It develops when surface waters in the central and eastern equatorial Pacific become warmer than usual.',
  cameraDestination: GLOBAL_VIEW,
  cameraOrientation: TOP_DOWN,
  cameraFlightSeconds: 1.5,
  cameraWaypoints: [
    {
      atMs: 2_500,
      // Centered between the central and eastern Pacific (crosses the antimeridian).
      destination: { kind: 'rectangle', west: 170, south: -25, east: -80, north: 25 },
      orientation: TOP_DOWN,
      flightSeconds: 4,
    },
  ],
  enabledLayers: ['seaSurfaceTemperatureAnomaly'],
  visualElements: [
    {
      id: 'equatorial-pacific-band',
      type: 'highlightArea',
      nature: 'reference',
      color: REFERENCE_COLOR,
      caption: 'Equatorial Pacific',
      west: 160,
      south: -10,
      east: -80,
      north: 10,
      appearAtMs: 3_500,
      pulse: true,
    },
    {
      id: 'equatorial-pacific-label',
      type: 'label',
      nature: 'reference',
      color: REFERENCE_COLOR,
      position: [-140, 13],
      text: 'Equatorial Pacific',
      appearAtMs: 4_000,
    },
    {
      id: 'nino-34-region',
      type: 'highlightArea',
      nature: 'reference',
      color: '#ffffff',
      caption: 'Niño 3.4 monitoring region (5°N–5°S, 170°W–120°W)',
      west: -170,
      south: -5,
      east: -120,
      north: 5,
      appearAtMs: 8_000,
    },
    {
      id: 'nino-34-label',
      type: 'label',
      nature: 'reference',
      color: '#ffffff',
      position: [-145, -8],
      text: 'Niño 3.4 region',
      appearAtMs: 8_500,
    },
  ],
  cues: { audioTrackId: 'el-nino-scene-1', mascotAnimationId: 'intro-wave' },
  onEnter: ({ stage }) =>
    stage.setLayerOpacity('seaSurfaceTemperatureAnomaly', SEA_SURFACE_TEMPERATURE_OPACITY),
};

const sceneCauses: StoryScene = {
  id: 'what-causes-el-nino',
  title: 'What Causes El Niño?',
  durationMs: 17_000,
  narration:
    'Under normal conditions, trade winds push warm surface waters toward the western Pacific. During El Niño, these winds weaken, allowing warm water to spread toward the central and eastern Pacific. This changes atmospheric circulation and affects rainfall and temperature patterns.',
  cameraDestination: { kind: 'rectangle', west: 120, south: -20, east: -75, north: 20 },
  cameraOrientation: TOP_DOWN,
  cameraFlightSeconds: 2,
  enabledLayers: ['seaSurfaceTemperatureAnomaly'],
  visualElements: [
    // Phase 1 (0–8 s): normal conditions.
    ...[6, -6].flatMap((latitude) => [
      {
        id: `strong-trade-wind-east-${latitude}`,
        type: 'arrow' as const,
        nature: 'illustrative' as const,
        color: WIND_COLOR,
        caption: 'Trade winds blowing west (simplified)',
        path: [
          [-88, latitude],
          [-120, latitude],
        ] as const,
        width: 14,
        disappearAtMs: 8_000,
      },
      {
        id: `strong-trade-wind-central-${latitude}`,
        type: 'arrow' as const,
        nature: 'illustrative' as const,
        color: WIND_COLOR,
        caption: 'Trade winds blowing west (simplified)',
        path: [
          [-128, latitude],
          [-162, latitude],
        ] as const,
        width: 14,
        disappearAtMs: 8_000,
      },
      {
        id: `strong-trade-wind-west-${latitude}`,
        type: 'arrow' as const,
        nature: 'illustrative' as const,
        color: WIND_COLOR,
        caption: 'Trade winds blowing west (simplified)',
        path: [
          [177, latitude],
          [148, latitude],
        ] as const,
        width: 14,
        disappearAtMs: 8_000,
      },
    ]),
    {
      id: 'normal-warm-pool',
      type: 'zone',
      nature: 'illustrative',
      color: WARM_WATER_COLOR,
      caption: 'Warm pool in its usual western position (simplified)',
      outline: [
        [125, 0],
        [132, -10],
        [168, -10],
        [178, 0],
        [168, 10],
        [132, 10],
      ],
      disappearAtMs: 8_000,
      pulse: true,
    },
    {
      id: 'normal-conditions-label',
      type: 'label',
      nature: 'illustrative',
      color: WIND_COLOR,
      position: [-150, 14],
      text: 'Normal conditions: strong trade winds',
      disappearAtMs: 8_000,
    },
    // Phase 2 (8–17 s): El Niño conditions.
    ...[6, -6].flatMap((latitude) => [
      {
        id: `weak-trade-wind-east-${latitude}`,
        type: 'arrow' as const,
        nature: 'illustrative' as const,
        color: 'rgba(232, 239, 235, 0.55)',
        caption: 'Weakened trade winds (simplified)',
        path: [
          [-98, latitude],
          [-112, latitude],
        ] as const,
        width: 9,
        appearAtMs: 8_000,
      },
      {
        id: `weak-trade-wind-central-${latitude}`,
        type: 'arrow' as const,
        nature: 'illustrative' as const,
        color: 'rgba(232, 239, 235, 0.55)',
        caption: 'Weakened trade winds (simplified)',
        path: [
          [-140, latitude],
          [-154, latitude],
        ] as const,
        width: 9,
        appearAtMs: 8_000,
      },
    ]),
    {
      id: 'warm-water-west',
      type: 'arrow',
      nature: 'illustrative',
      color: WARM_WATER_COLOR,
      caption: 'Warm water spreading east (simplified)',
      path: [
        [148, 0],
        [176, 0],
      ],
      width: 18,
      appearAtMs: 8_500,
    },
    {
      id: 'warm-water-central',
      type: 'arrow',
      nature: 'illustrative',
      color: WARM_WATER_COLOR,
      caption: 'Warm water spreading east (simplified)',
      path: [
        [-176, 0],
        [-144, 0],
      ],
      width: 18,
      appearAtMs: 10_000,
    },
    {
      id: 'warm-water-east',
      type: 'arrow',
      nature: 'illustrative',
      color: WARM_WATER_COLOR,
      caption: 'Warm water spreading east (simplified)',
      path: [
        [-138, 0],
        [-102, 0],
      ],
      width: 18,
      appearAtMs: 11_500,
    },
    {
      id: 'el-nino-conditions-label',
      type: 'label',
      nature: 'illustrative',
      color: WARM_WATER_COLOR,
      position: [-150, 14],
      text: 'El Niño: winds weaken, warm water moves east',
      appearAtMs: 8_000,
    },
  ],
  cues: { audioTrackId: 'el-nino-scene-2', mascotAnimationId: 'point-east' },
  onEnter: ({ stage }) => stage.setLayerOpacity('seaSurfaceTemperatureAnomaly', 0.55),
  onExit: ({ stage }) =>
    stage.setLayerOpacity('seaSurfaceTemperatureAnomaly', SEA_SURFACE_TEMPERATURE_OPACITY),
};

const sceneGlobalClimate: StoryScene = {
  id: 'climate-changes-around-the-world',
  title: 'Climate Changes Around the World',
  durationMs: 20_000,
  narration:
    'The warming Pacific changes atmospheric circulation and redistributes rainfall. Parts of South America may experience heavier rainfall, while Australia and Indonesia often face drier conditions. These changes influence weather patterns across many parts of the world.',
  cameraDestination: GLOBAL_VIEW,
  cameraOrientation: TOP_DOWN,
  cameraFlightSeconds: 2.5,
  cameraWaypoints: [
    {
      atMs: 3_500,
      destination: { kind: 'rectangle', west: -95, south: -45, east: -30, north: 15 },
      orientation: TOP_DOWN,
      flightSeconds: 3,
    },
    {
      atMs: 10_000,
      destination: { kind: 'rectangle', west: 90, south: -45, east: 160, north: 15 },
      orientation: TOP_DOWN,
      flightSeconds: 3.5,
    },
    {
      atMs: 16_500,
      destination: GLOBAL_VIEW,
      orientation: TOP_DOWN,
      flightSeconds: 3,
    },
  ],
  enabledLayers: ['precipitationRate'],
  visualElements: [
    {
      id: 'wetter-ecuador-peru',
      type: 'zone',
      nature: 'illustrative',
      color: WETTER_COLOR,
      caption: SIMPLIFIED_RAINFALL_CAPTION,
      outline: [
        [-82, 2],
        [-77.5, 2],
        [-78.5, -9],
        [-81.5, -9],
      ],
      appearAtMs: 4_500,
      pulse: true,
    },
    {
      id: 'wetter-ecuador-peru-label',
      type: 'label',
      nature: 'illustrative',
      color: WETTER_COLOR,
      position: [-88, -6],
      text: 'Wetter: coastal Ecuador & northern Peru',
      appearAtMs: 5_000,
    },
    {
      id: 'wetter-southeast-south-america',
      type: 'zone',
      nature: 'illustrative',
      color: WETTER_COLOR,
      caption: SIMPLIFIED_RAINFALL_CAPTION,
      outline: [
        [-62, -24],
        [-48, -24],
        [-50, -33],
        [-58, -36],
        [-64, -31],
      ],
      appearAtMs: 5_500,
      pulse: true,
    },
    {
      id: 'wetter-southeast-south-america-label',
      type: 'label',
      nature: 'illustrative',
      color: WETTER_COLOR,
      position: [-50, -39],
      text: 'Wetter: southeastern South America',
      appearAtMs: 6_000,
    },
    {
      id: 'drier-northern-south-america',
      type: 'zone',
      nature: 'illustrative',
      color: DRIER_COLOR,
      caption: SIMPLIFIED_RAINFALL_CAPTION,
      outline: [
        [-75, 10],
        [-61, 10],
        [-50, 1],
        [-60, -4],
        [-74, 0],
      ],
      appearAtMs: 6_500,
    },
    {
      id: 'drier-northern-south-america-label',
      type: 'label',
      nature: 'illustrative',
      color: DRIER_COLOR,
      position: [-55, 9],
      text: 'Drier: northern South America',
      appearAtMs: 7_000,
    },
    {
      id: 'drier-indonesia',
      type: 'zone',
      nature: 'illustrative',
      color: DRIER_COLOR,
      caption: SIMPLIFIED_RAINFALL_CAPTION,
      outline: [
        [95, 6],
        [128, 5],
        [141, -2],
        [141, -9],
        [106, -9],
        [95, -3],
      ],
      appearAtMs: 11_000,
      pulse: true,
    },
    {
      id: 'drier-indonesia-label',
      type: 'label',
      nature: 'illustrative',
      color: DRIER_COLOR,
      position: [116, 9],
      text: 'Drier: Indonesia',
      appearAtMs: 11_500,
    },
    {
      id: 'drier-eastern-australia',
      type: 'zone',
      nature: 'illustrative',
      color: DRIER_COLOR,
      caption: SIMPLIFIED_RAINFALL_CAPTION,
      outline: [
        [131, -12],
        [143, -11],
        [153, -25],
        [150, -37],
        [141, -38],
        [136, -22],
      ],
      appearAtMs: 12_500,
      pulse: true,
    },
    {
      id: 'drier-eastern-australia-label',
      type: 'label',
      nature: 'illustrative',
      color: DRIER_COLOR,
      position: [142, -41],
      text: 'Drier: northern & eastern Australia',
      appearAtMs: 13_000,
    },
  ],
  cues: { audioTrackId: 'el-nino-scene-3', mascotAnimationId: 'world-tour' },
};

const sceneMexico: StoryScene = {
  id: 'el-nino-and-mexico',
  title: 'El Niño and Mexico',
  durationMs: 20_000,
  narration:
    'In Mexico, El Niño does not produce the same effects everywhere. Its influence depends on its intensity and the season. During some events, northern and northwestern Mexico experience wetter winter conditions, while other regions may face reduced rainfall or drought.',
  // Starts over the eastern Pacific and moves toward Mexico.
  cameraDestination: { kind: 'rectangle', west: -128, south: 6, east: -82, north: 36 },
  cameraOrientation: TOP_DOWN,
  cameraFlightSeconds: 3,
  cameraWaypoints: [
    {
      atMs: 7_000,
      destination: { kind: 'rectangle', west: -119, south: 21, east: -100, north: 34 },
      orientation: TOP_DOWN,
      flightSeconds: 3,
    },
    {
      atMs: 14_500,
      destination: { kind: 'rectangle', west: -119, south: 12, east: -85, north: 34 },
      orientation: TOP_DOWN,
      flightSeconds: 2.5,
    },
  ],
  enabledLayers: ['precipitationRate'],
  visualElements: [
    {
      id: 'mexico-label',
      type: 'label',
      nature: 'reference',
      color: '#ffffff',
      position: [-102, 23.5],
      text: 'Mexico',
      appearAtMs: 2_000,
      disappearAtMs: 7_000,
    },
    {
      id: 'northwest-mexico-wetter-winters',
      type: 'zone',
      nature: 'illustrative',
      color: WETTER_COLOR,
      caption: 'Wetter winters during some El Niño events (simplified tendency)',
      outline: [
        [-117.1, 32.5],
        [-111, 31.3],
        [-108.2, 31.3],
        [-106.5, 31.8],
        [-104.5, 29.6],
        [-103.3, 27.5],
        [-105.5, 25.2],
        [-108.5, 24.2],
        [-110.5, 25.5],
        [-112.5, 26.5],
        [-114.8, 27.8],
        [-116.4, 30.2],
      ],
      appearAtMs: 3_500,
      pulse: true,
    },
    {
      id: 'chihuahua-label',
      type: 'label',
      nature: 'reference',
      color: '#ffffff',
      position: [-106.2, 29.2],
      text: 'Chihuahua',
      appearAtMs: 8_000,
    },
    {
      id: 'chihuahua-city',
      type: 'marker',
      nature: 'reference',
      color: REFERENCE_COLOR,
      position: [-106.09, 28.63],
      text: 'Chihuahua City',
      appearAtMs: 9_000,
      disappearAtMs: 14_500,
    },
    {
      id: 'sonora-label',
      type: 'label',
      nature: 'reference',
      color: '#ffffff',
      position: [-110.8, 29.7],
      text: 'Sonora',
      appearAtMs: 8_500,
    },
    {
      id: 'baja-california-label',
      type: 'label',
      nature: 'reference',
      color: '#ffffff',
      position: [-115.3, 30.4],
      text: 'Baja California',
      appearAtMs: 9_000,
    },
    {
      id: 'northwest-mexico-label',
      type: 'label',
      nature: 'illustrative',
      color: WETTER_COLOR,
      position: [-113, 23.2],
      text: 'Northwestern Mexico: wetter winters in some El Niño events',
      appearAtMs: 10_000,
    },
    {
      id: 'southern-mexico-reduced-rainfall',
      type: 'zone',
      nature: 'illustrative',
      color: DRIER_COLOR,
      caption: 'Reduced summer rainfall or drought possible (simplified tendency)',
      outline: [
        [-105, 20.5],
        [-99, 20.5],
        [-94, 18.5],
        [-90.5, 21.3],
        [-87, 21.2],
        [-88.5, 17.8],
        [-91.5, 15.2],
        [-94.5, 16],
        [-98, 16.2],
        [-103.5, 18.3],
      ],
      appearAtMs: 15_000,
      pulse: true,
    },
    {
      id: 'southern-mexico-label',
      type: 'label',
      nature: 'illustrative',
      color: DRIER_COLOR,
      position: [-96, 14],
      text: 'Central & southern Mexico: reduced rainfall or drought possible',
      appearAtMs: 15_500,
    },
  ],
  cues: { audioTrackId: 'el-nino-scene-4', mascotAnimationId: 'mexico-focus' },
  onEnter: ({ stage }) => stage.setLayerOpacity('precipitationRate', 0.6),
};

const sceneGlobalConsequences: StoryScene = {
  id: 'one-phenomenon-global-consequences',
  title: 'One Phenomenon, Global Consequences',
  durationMs: 18_000,
  narration:
    "El Niño shows how interconnected our planet's climate really is. A change in ocean temperatures can influence rainfall, droughts, and temperatures thousands of kilometers away. Understanding these patterns helps us anticipate risks and prepare for their consequences.",
  cameraDestination: GLOBAL_VIEW,
  cameraOrientation: TOP_DOWN,
  cameraFlightSeconds: 3.5,
  enabledLayers: ['seaSurfaceTemperatureAnomaly'],
  visualElements: [
    {
      id: 'summary-nino-34',
      type: 'highlightArea',
      nature: 'reference',
      color: REFERENCE_COLOR,
      caption: 'Niño 3.4 monitoring region',
      west: -170,
      south: -5,
      east: -120,
      north: 5,
      pulse: true,
      appearAtMs: 2_000,
    },
    ...(
      [
        ['to-mexico', [-128, 6], [-107, 26]],
        ['to-south-america', [-120, -6], [-62, -28]],
        ['to-peru', [-118, -2], [-83, -4]],
        ['to-indonesia', [178, 2], [124, -1]],
        ['to-australia', [178, -7], [146, -24]],
      ] as const
    ).map(([suffix, from, to], index) => ({
      id: `teleconnection-${suffix}`,
      type: 'arrow' as const,
      nature: 'illustrative' as const,
      color: WARM_WATER_COLOR,
      caption: 'Remote influence of the warm Pacific (simplified)',
      path: [from, to] as const,
      width: 12,
      appearAtMs: 4_000 + index * 600,
    })),
  ],
  summarySteps: [
    {
      title: 'Ocean temperatures',
      description: 'The central and eastern equatorial Pacific warms.',
    },
    {
      title: 'Atmospheric circulation',
      description: 'Trade winds weaken and rising air shifts east.',
    },
    {
      title: 'Rainfall & temperature',
      description: 'Wetter and drier patterns appear far away.',
    },
  ],
  cues: { audioTrackId: 'el-nino-scene-5', mascotAnimationId: 'outro-bow' },
  onEnter: ({ stage }) => stage.setLayerOpacity('seaSurfaceTemperatureAnomaly', 0.65),
};

export const EL_NINO_STORY: StoryDefinition = {
  id: 'el-nino',
  title: 'Understanding El Niño',
  layers: {
    seaSurfaceTemperatureAnomaly: {
      id: 'seaSurfaceTemperatureAnomaly',
      gibsLayer: GIBS_SEA_SURFACE_TEMPERATURE_ANOMALY_LAYER,
      date: '2023-12-15',
      opacity: SEA_SURFACE_TEMPERATURE_OPACITY,
      label: 'Sea surface temperature anomaly (GHRSST MUR 0.25°)',
      dateContext: 'Dec 15, 2023 · near the peak of the 2023–24 El Niño',
      credit: 'NASA JPL GHRSST MUR / NASA GIBS',
    },
    precipitationRate: {
      id: 'precipitationRate',
      gibsLayer: GIBS_PRECIPITATION_RATE_LAYER,
      date: '2024-01-15',
      opacity: 0.7,
      label: 'Precipitation rate (NASA GPM IMERG)',
      dateContext:
        'Jan 15, 2024 · a single-day weather snapshot during El Niño, not a seasonal anomaly',
      credit: 'NASA GPM IMERG / NASA GIBS',
    },
  },
  scenes: [
    sceneOceanWarms,
    sceneCauses,
    sceneGlobalClimate,
    sceneMexico,
    sceneGlobalConsequences,
  ],
};
