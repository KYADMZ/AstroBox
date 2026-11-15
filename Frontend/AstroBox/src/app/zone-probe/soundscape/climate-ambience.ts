import { SILENT_AMBIENCE, type AmbienceLevels } from './sound-mix';

/** A climate-zone soundscape: what you hear and a short description. */
export interface ClimateAmbienceProfile {
  /** Short name of the soundscape, e.g. "Jungle". */
  label: string;
  levels: AmbienceLevels;
}

function profile(label: string, levels: Partial<AmbienceLevels>): ClimateAmbienceProfile {
  return { label, levels: { ...SILENT_AMBIENCE, ...levels } };
}

const JUNGLE = profile('Jungle', { birds: 0.85, insects: 0.9, frogs: 0.65, leaves: 0.25 });
const MONSOON_FOREST = profile('Monsoon forest', { birds: 0.75, insects: 0.7, frogs: 0.45, leaves: 0.3 });
const SAVANNA = profile('Savanna', { crickets: 0.6, insects: 0.3, birds: 0.35, desert: 0.15 });
const HOT_DESERT = profile('Desert', { desert: 0.85 });
const COLD_DESERT = profile('Cold desert', { desert: 0.7, polar: 0.2 });
const HOT_STEPPE = profile('Dry steppe', { desert: 0.35, crickets: 0.45, cicadas: 0.3 });
const COLD_STEPPE = profile('Cold steppe', { desert: 0.45, crickets: 0.3, polar: 0.1 });
const MEDITERRANEAN = profile('Mediterranean', { cicadas: 0.75, birds: 0.3, leaves: 0.2 });
const HIGHLAND = profile('Highland woods', { birds: 0.55, leaves: 0.35, crickets: 0.25 });
const HUMID_SUBTROPICAL = profile('Humid woodland', {
  birds: 0.55,
  insects: 0.35,
  crickets: 0.45,
  frogs: 0.2,
  leaves: 0.25,
});
const OCEANIC = profile('Temperate forest', { birds: 0.6, leaves: 0.5 });
const CONTINENTAL = profile('Mixed forest', { birds: 0.45, leaves: 0.5, crickets: 0.2 });
const TAIGA = profile('Taiga', { leaves: 0.35, polar: 0.4, birds: 0.15 });
const TUNDRA = profile('Tundra', { polar: 0.65 });
const ICE_CAP = profile('Ice cap', { polar: 1 });

const PROFILES: Record<string, ClimateAmbienceProfile> = {
  Af: JUNGLE,
  Am: MONSOON_FOREST,
  Aw: SAVANNA,
  BWh: HOT_DESERT,
  BWk: COLD_DESERT,
  BSh: HOT_STEPPE,
  BSk: COLD_STEPPE,
  Csa: MEDITERRANEAN,
  Csb: MEDITERRANEAN,
  Csc: OCEANIC,
  Cwa: HUMID_SUBTROPICAL,
  Cwb: HIGHLAND,
  Cwc: HIGHLAND,
  Cfa: HUMID_SUBTROPICAL,
  Cfb: OCEANIC,
  Cfc: OCEANIC,
  Dsa: CONTINENTAL,
  Dsb: CONTINENTAL,
  Dsc: TAIGA,
  Dsd: TAIGA,
  Dwa: CONTINENTAL,
  Dwb: CONTINENTAL,
  Dwc: TAIGA,
  Dwd: TAIGA,
  Dfa: CONTINENTAL,
  Dfb: CONTINENTAL,
  Dfc: TAIGA,
  Dfd: TAIGA,
  ET: TUNDRA,
  EF: ICE_CAP,
};

/** Soundscape for a Köppen-Geiger class code, or undefined (ocean, no data). */
export function ambienceForClimateCode(code: string | null | undefined): ClimateAmbienceProfile | undefined {
  return code ? PROFILES[code] : undefined;
}
