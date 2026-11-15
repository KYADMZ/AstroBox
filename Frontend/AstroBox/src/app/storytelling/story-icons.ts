/**
 * Small line pictograms shown next to story labels on the map, so each box
 * says at a glance which phenomenon it describes. 24×24 stroke paths drawn in
 * the label's neon color.
 */
export type StoryIconId =
  | 'flood'
  | 'rain'
  | 'storm'
  | 'drought'
  | 'wind'
  | 'wave'
  | 'warmWater'
  | 'thermometer'
  | 'pin'
  | 'mountain'
  | 'desert'
  | 'cloud'
  | 'sinkingAir';

const WAVES_LOW =
  'M2 17c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5M2 21c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5';

export const STORY_ICON_PATHS: Readonly<Record<StoryIconId, string>> = {
  // House roof over rising water.
  flood: `M4 11.5 12 5l8 6.5M6.5 9.8V14M17.5 9.8V14M10 14v-3h4v3${' '}${WAVES_LOW}`,
  // Cloud with falling drops.
  rain: 'M7 13.5a4 4 0 0 1-.4-8A5 5 0 0 1 16 5a3.5 3.5 0 0 1 1 8.5H7ZM8.5 16.5l-1 3M12.5 16.5l-1 3M16.5 16.5l-1 3',
  // Cloud with a lightning bolt.
  storm: 'M7 13.5a4 4 0 0 1-.4-8A5 5 0 0 1 16 5a3.5 3.5 0 0 1 1 8.5H7ZM12.5 14l-2 3.5h3l-2 3.5',
  // Hot sun over cracked ground.
  drought:
    'M12 2.5v2M5.3 5.3l1.4 1.4M18.7 5.3l-1.4 1.4M2.5 12h2M19.5 12h2M8 12a4 4 0 0 1 8 0M3 15.5h18M7.5 15.5l1.5 2.5-1.5 3M14 15.5l-1 2.2 2 3.3',
  // Gusts.
  wind: 'M3 8h10.5a3 3 0 1 0-3-3M3 12h15.5a3 3 0 1 1-3 3M3 16h7',
  // Ocean swell.
  wave: 'M2 9c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2M2 14c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2M2 19c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2',
  // Sun warming the sea.
  warmWater: `M12 3v2M6.4 6.4l1.4 1.4M17.6 6.4l-1.4 1.4M8.5 12.5a3.5 3.5 0 0 1 7 0${' '}${WAVES_LOW}`,
  thermometer: 'M10 13.5V5a2 2 0 1 1 4 0v8.5a4 4 0 1 1-4 0ZM12 8.5V16',
  pin: 'M12 21s-6-5.5-6-10.5a6 6 0 1 1 12 0C18 15.5 12 21 12 21ZM12 12.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  mountain: 'M2 20 9 7l4 6.5 2-3L22 20H2ZM7.3 10.2 9 11.6l1.6-1.4',
  // Saguaro-style cactus on the ground.
  desert: 'M10 21V6a2 2 0 1 1 4 0v15M10 13H8a2 2 0 0 1-2-2V8.5M14 11h2a2 2 0 0 0 2-2V6.5M4 21h16',
  // Moist air mass.
  cloud: 'M7 18a4.5 4.5 0 0 1-.6-9A5.5 5.5 0 0 1 17 8a4 4 0 0 1 0 10H7Z',
  // Dry air descending a slope.
  sinkingAir: 'M7 3.5v11M3.8 11.3 7 14.5l3.2-3.2M17 3.5v11M13.8 11.3l3.2 3.2 3.2-3.2M3 19.5h18',
};

/** Builds the inline SVG element for an icon (no innerHTML, so nothing is parsed). */
export function createStoryIcon(icon: StoryIconId): SVGSVGElement {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(namespace, 'path');
  path.setAttribute('d', STORY_ICON_PATHS[icon]);
  svg.append(path);
  return svg;
}
