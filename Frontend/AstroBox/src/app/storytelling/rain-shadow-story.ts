import type {
  CameraDestination,
  CameraOrientation,
  StoryDefinition,
  StoryScene,
} from './story.models';

/**
 * Short guided story (about 38 seconds, three scenes) on the double rain
 * shadow (sombra orográfica doble) of northern Mexico.
 *
 * Scientific notes
 * - The Mexican Plateau (Altiplano) lies between the Sierra Madre Occidental
 *   and the Sierra Madre Oriental. Moist air from the Gulf of Mexico and from
 *   the Pacific is forced up the outer slopes (orographic lift), cools and
 *   drops much of its moisture there; the air that descends into the
 *   interior warms and dries. With rain shadows on both sides, the plateau
 *   is much drier than the outer slopes.
 * - This "double rain shadow", together with the subtropical high-pressure
 *   belt (sinking, dry air near 30°N), helps explain the Chihuahuan Desert,
 *   the largest desert in North America, where many areas receive roughly
 *   150–400 mm of rain a year, mostly in summer.
 * - The observed layer is the Köppen-Geiger classification (Beck et al.,
 *   2023, 1991–2020 normals): arid classes (BW, BS) fill the plateau, while
 *   humid classes appear on the outer slopes. Arrows and zones are simplified
 *   teaching aids, not observations.
 */

const TOP_DOWN: CameraOrientation = { heading: 0, pitch: -90, roll: 0 };

const NORTHERN_MEXICO: CameraDestination = {
  kind: 'rectangle',
  west: -115,
  south: 18.5,
  east: -91,
  north: 33.5,
};

const MOIST_COLOR = '#3ef0ff';
const DRY_COLOR = '#ff9b42';
const MOUNTAIN_COLOR = '#fff6c2';
const KOPPEN_OPACITY = 0.6;

/** Simplified outline of the Sierra Madre Occidental (NW–SE band). */
const SIERRA_MADRE_OCCIDENTAL = [
  [-109.4, 30.9],
  [-108.1, 31.2],
  [-106.6, 28.5],
  [-105.0, 25.4],
  [-103.9, 22.5],
  [-104.7, 21.5],
  [-105.8, 22.6],
  [-107.0, 25.0],
  [-108.4, 27.8],
  [-109.6, 29.8],
] as const;

/** Simplified outline of the Sierra Madre Oriental. */
const SIERRA_MADRE_ORIENTAL = [
  [-101.3, 26.0],
  [-100.0, 25.9],
  [-99.2, 24.2],
  [-98.5, 22.0],
  [-97.7, 20.2],
  [-98.6, 19.9],
  [-99.6, 21.6],
  [-100.3, 23.5],
  [-101.1, 25.0],
] as const;

const sceneTwoWalls: StoryScene = {
  id: 'two-mountain-walls',
  title: 'Two Mountain Walls',
  durationMs: 12_000,
  narration:
    'Northern Mexico is framed by two great mountain ranges: the Sierra Madre Occidental to the west and the Sierra Madre Oriental to the east. Between them lies the high, wide Mexican Plateau.',
  cameraDestination: NORTHERN_MEXICO,
  cameraOrientation: TOP_DOWN,
  cameraFlightSeconds: 2.5,
  enabledLayers: ['climateZones'],
  visualElements: [
    {
      id: 'sierra-madre-occidental',
      type: 'zone',
      nature: 'reference',
      color: MOUNTAIN_COLOR,
      caption: 'Sierra Madre Occidental (simplified outline)',
      outline: SIERRA_MADRE_OCCIDENTAL,
      appearAtMs: 2_000,
    },
    {
      id: 'sierra-madre-occidental-label',
      type: 'label',
      nature: 'reference',
      color: MOUNTAIN_COLOR,
      position: [-110.6, 27.2],
      text: 'Sierra Madre Occidental',
      icon: 'mountain',
      appearAtMs: 2_500,
    },
    {
      id: 'sierra-madre-oriental',
      type: 'zone',
      nature: 'reference',
      color: MOUNTAIN_COLOR,
      caption: 'Sierra Madre Oriental (simplified outline)',
      outline: SIERRA_MADRE_ORIENTAL,
      appearAtMs: 4_500,
    },
    {
      id: 'sierra-madre-oriental-label',
      type: 'label',
      nature: 'reference',
      color: MOUNTAIN_COLOR,
      position: [-96.6, 24.6],
      text: 'Sierra Madre Oriental',
      icon: 'mountain',
      appearAtMs: 5_000,
    },
    {
      id: 'mexican-plateau-label',
      type: 'label',
      nature: 'reference',
      color: MOUNTAIN_COLOR,
      position: [-103.2, 26.4],
      text: 'Mexican Plateau',
      icon: 'pin',
      appearAtMs: 7_500,
    },
  ],
  audio: [
    // High mountain wind.
    { channel: 'wind', level: 0.4 },
    { channel: 'desert', level: 0.2, fromMs: 7_000 },
  ],
  onEnter: ({ stage }) => stage.setLayerOpacity('climateZones', 0.45),
};

const sceneHowItForms: StoryScene = {
  id: 'how-a-rain-shadow-forms',
  title: 'How the Double Rain Shadow Forms',
  durationMs: 14_000,
  narration:
    'Moist air from the Gulf of Mexico and the Pacific is pushed up the outer slopes. As it rises it cools and drops its rain there. When the air crosses the peaks and sinks into the plateau, it warms and dries out — a rain shadow on each side.',
  cameraDestination: NORTHERN_MEXICO,
  cameraOrientation: TOP_DOWN,
  cameraFlightSeconds: 1.5,
  enabledLayers: ['climateZones'],
  visualElements: [
    // Phase 1 (0–7 s): moist air rises and rains on the outer slopes.
    {
      id: 'gulf-moist-air',
      type: 'arrow',
      nature: 'illustrative',
      color: MOIST_COLOR,
      caption: 'Moist air pushed up the outer slopes (simplified)',
      path: [
        [-93.5, 23.4],
        [-97.9, 23.0],
      ],
      width: 16,
      appearAtMs: 500,
    },
    {
      id: 'pacific-moist-air',
      type: 'arrow',
      nature: 'illustrative',
      color: MOIST_COLOR,
      caption: 'Moist air pushed up the outer slopes (simplified)',
      path: [
        [-112.6, 24.6],
        [-108.3, 26.0],
      ],
      width: 16,
      appearAtMs: 1_200,
    },
    {
      id: 'gulf-moist-air-label',
      type: 'label',
      nature: 'illustrative',
      color: MOIST_COLOR,
      position: [-94.2, 25.2],
      text: 'Moist air from the Gulf',
      icon: 'cloud',
      appearAtMs: 1_000,
      disappearAtMs: 7_000,
    },
    {
      id: 'pacific-moist-air-label',
      type: 'label',
      nature: 'illustrative',
      color: MOIST_COLOR,
      position: [-112.3, 22.8],
      text: 'Moist air from the Pacific',
      icon: 'cloud',
      appearAtMs: 1_700,
      disappearAtMs: 7_000,
    },
    {
      id: 'gulf-windward-rain',
      type: 'zone',
      nature: 'illustrative',
      color: MOIST_COLOR,
      caption: 'Rainy windward slopes (simplified)',
      outline: [
        [-99.0, 24.6],
        [-98.0, 24.1],
        [-97.2, 21.6],
        [-96.8, 20.0],
        [-97.6, 19.8],
        [-98.3, 21.5],
        [-98.9, 23.0],
      ],
      appearAtMs: 3_000,
      pulse: true,
    },
    {
      id: 'pacific-windward-rain',
      type: 'zone',
      nature: 'illustrative',
      color: MOIST_COLOR,
      caption: 'Rainy windward slopes (simplified)',
      outline: [
        [-109.4, 28.6],
        [-108.7, 27.0],
        [-106.6, 24.0],
        [-105.3, 22.0],
        [-105.8, 21.3],
        [-107.1, 23.2],
        [-108.9, 25.8],
        [-110.0, 27.9],
      ],
      appearAtMs: 3_400,
      pulse: true,
    },
    {
      id: 'windward-rain-label',
      type: 'label',
      nature: 'illustrative',
      color: MOIST_COLOR,
      position: [-95.0, 20.4],
      text: 'Rain falls on the outer slopes',
      icon: 'rain',
      appearAtMs: 3_800,
    },
    // Phase 2 (7–14 s): dry air sinks into the plateau.
    {
      id: 'gulf-dry-air',
      type: 'arrow',
      nature: 'illustrative',
      color: DRY_COLOR,
      caption: 'Dry air sinking into the plateau (simplified)',
      path: [
        [-100.7, 24.4],
        [-102.6, 25.2],
      ],
      width: 14,
      appearAtMs: 7_000,
    },
    {
      id: 'pacific-dry-air',
      type: 'arrow',
      nature: 'illustrative',
      color: DRY_COLOR,
      caption: 'Dry air sinking into the plateau (simplified)',
      path: [
        [-105.4, 27.4],
        [-103.6, 27.9],
      ],
      width: 14,
      appearAtMs: 7_500,
    },
    {
      id: 'dry-air-label',
      type: 'label',
      nature: 'illustrative',
      color: DRY_COLOR,
      position: [-103.4, 30.0],
      text: 'Warm, dry air sinks inland',
      icon: 'sinkingAir',
      appearAtMs: 8_000,
    },
  ],
  audio: [
    // Moist air rises: wind, rain and distant thunder on the slopes.
    { channel: 'wind', level: 0.45, untilMs: 7_000 },
    { channel: 'waves', level: 0.3, untilMs: 3_000 },
    { channel: 'rain', level: 0.65, fromMs: 2_500, untilMs: 7_000 },
    { channel: 'thunder', level: 0.4, fromMs: 3_000, untilMs: 7_000 },
    // Dry descending wind over the plateau.
    { channel: 'wind', level: 0.35, fromMs: 7_000 },
    { channel: 'whistle', level: 0.4, fromMs: 7_000 },
    { channel: 'desert', level: 0.65, fromMs: 7_000 },
  ],
  onEnter: ({ stage }) => stage.setLayerOpacity('climateZones', 0.35),
};

const sceneDesert: StoryScene = {
  id: 'a-desert-between-mountains',
  title: 'A Desert Between Mountains',
  durationMs: 12_000,
  narration:
    'Shielded on both sides, and under the dry, sinking air of the subtropics, the plateau gets little rain. The result is the Chihuahuan Desert: scarce water, large day–night temperature swings, and plants like agaves and cacti adapted to drought.',
  cameraDestination: {
    kind: 'rectangle',
    west: -111,
    south: 21,
    east: -96,
    north: 32.5,
  },
  cameraOrientation: TOP_DOWN,
  cameraFlightSeconds: 2.5,
  enabledLayers: ['climateZones'],
  visualElements: [
    {
      id: 'chihuahuan-desert',
      type: 'zone',
      nature: 'illustrative',
      color: DRY_COLOR,
      caption: 'Chihuahuan Desert (simplified extent)',
      outline: [
        [-108.0, 31.6],
        [-104.0, 31.4],
        [-102.0, 29.8],
        [-101.0, 28.0],
        [-100.8, 25.6],
        [-100.6, 23.6],
        [-101.6, 22.2],
        [-102.6, 22.7],
        [-103.6, 24.6],
        [-105.1, 26.6],
        [-106.6, 28.6],
        [-108.0, 30.5],
      ],
      appearAtMs: 1_500,
      pulse: true,
    },
    {
      id: 'chihuahuan-desert-label',
      type: 'label',
      nature: 'illustrative',
      color: DRY_COLOR,
      position: [-104.0, 27.3],
      text: 'Chihuahuan Desert',
      icon: 'desert',
      appearAtMs: 2_000,
    },
    {
      id: 'chihuahuan-rainfall-label',
      type: 'label',
      nature: 'illustrative',
      color: DRY_COLOR,
      position: [-104.0, 22.3],
      text: 'Often only ~150–400 mm of rain a year',
      icon: 'drought',
      appearAtMs: 4_500,
    },
  ],
  summarySteps: [
    { title: 'Moist air rises', description: 'Gulf and Pacific air climbs both Sierras.' },
    { title: 'Rain on the slopes', description: 'It cools and rains on the outer sides.' },
    { title: 'Dry plateau', description: 'Sinking, dry air leaves the interior arid.' },
  ],
  audio: [
    { channel: 'desert', level: 0.8 },
    { channel: 'crickets', level: 0.25, fromMs: 4_000 },
  ],
  onEnter: ({ stage }) => stage.setLayerOpacity('climateZones', KOPPEN_OPACITY),
};

export const RAIN_SHADOW_STORY: StoryDefinition = {
  id: 'double-rain-shadow',
  title: 'Northern Mexico’s Double Rain Shadow',
  description:
    'A quick look at how two mountain ranges squeeze the rain out of the air and help create the Chihuahuan Desert.',
  layers: {
    climateZones: {
      id: 'climateZones',
      source: 'koppen',
      gibsLayer: '',
      date: '1991–2020',
      opacity: KOPPEN_OPACITY,
      label: 'Köppen-Geiger climate zones (Beck et al., 2023)',
      dateContext: '1991–2020 climate normals · arid classes in tan and orange',
      credit: 'Köppen-Geiger data: Beck et al. (2023), Scientific Data 10, 724 · CC BY 4.0',
    },
  },
  scenes: [sceneTwoWalls, sceneHowItForms, sceneDesert],
};
