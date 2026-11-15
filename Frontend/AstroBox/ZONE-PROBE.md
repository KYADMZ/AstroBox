# Verny zone probe

Verny, the team mascot, is a draggable marker that scans the zone under it.
It works on the 3D globe and the 2D map. It is hidden while the 2D guided story
plays.

## How it works

1. Drag Verny from its dock (bottom-left of the map) over the map.
   - While dragging, the drawing changes with the area underneath:
     **red** = wildfire within 100 km or hot surface (≥ 30 °C),
     **blue** = very cold surface (≤ 5 °C), **yellow** = neutral.
   - The zone status panel shows live values ("LIVE").
2. Drop it. Verny stays anchored to that place (it follows pans, zooms and
   map switches) and the screen effects start:
   - **Rain**: background streaks (slanted by the wind) plus drops on the
     "screen" glass. Light rain = a few drops. Very heavy rain = many drops
     that slide down and leave trails. The strength eases smoothly, so moving
     Verny between zones makes the change visible.
   - **Wildfire**: flames and embers rise from the bottom of the map.
3. Double-click Verny, press `Esc` on it, or use **Return Verny** to stop.

Keyboard: focus Verny and press `Enter` to drop it at the map center, use the
arrow keys to nudge it 2°, and `Esc` to return it to the dock.

## Data

| Value | Source |
| --- | --- |
| Surface (skin) temperature, air temperature, precipitation, wind speed | NASA POWER daily point API (MERRA-2, ~0.5° grid, global, no API key). The value is the mean over the selected month, up to about 3 days ago. Early in a month, the latest 7 days are used. |
| Wildfires | NASA EONET events of the selected month, already loaded by the app. |
| Surface temperature map layer | NASA GIBS `VIIRS_NOAA20_Land_Surface_Temp_Day` (daily daytime land surface temperature, land only). It is in the layer menu as "Surface temperature". |

Requests are cached per month and grid cell. While dragging, a request is sent
once Verny rests about 0.4 s over a new cell. Wildfire checks are instant.

## Tuning

All thresholds live in `ZONE_THRESHOLDS` (`src/app/zone-probe/zone-probe.models.ts`):
hot/cold temperatures, wildfire radius, and the precipitation levels
(light 0.2, moderate 2.5, heavy 8, very heavy 20 mm/day).

## Files

| File | Purpose |
| --- | --- |
| `zone-probe/zone-probe.models.ts` | Types, thresholds, `MapProbeAdapter` contract |
| `zone-probe/nasa-power.client.ts` | NASA POWER request and monthly summary |
| `zone-probe/zone-probe.store.ts` | Shared state: position, data, mood, effect targets |
| `zone-probe/cesium-probe-adapter.ts` | Screen ↔ lon/lat for either Cesium map |
| `zone-probe/mascot-probe/` | Draggable Verny and its dock |
| `zone-probe/zone-status/` | Right-side status panel |
| `zone-probe/environment-effects/` | Canvas rain, glass drops and flames (`environment-effects.engine.ts`) |
| `public/verny/verny-{cold,neutral,hot}.png` | The three drawings (trimmed and resized from the originals) |

## Soundscape (rain, wind, fire)

The sounds are generated live with the browser's **Web Audio API**. No audio
files are used, so there is nothing to download or license. They follow the same
`effectTargets()` as the visuals, so they change in step with them:

| Sound | How it is made | What changes it |
| --- | --- | --- |
| Rain | Pink noise through high-pass and low-pass filters (the hiss), brown-noise rumble for storms, and single drop "ticks" (short band-passed noise bursts, panned left/right) | Level and brightness of the hiss; drops go from ~2/s (drizzle) to ~80/s (storm); rumble only in heavy rain |
| Wind | Brown noise through a band-pass filter that moves with random gusts; a narrow whistle band above ~13 m/s | Wind speed (NASA POWER WS10M at Verny's spot): silent below 2 m/s, barely audible for a breeze, loud only for strong wind (≥ 12 m/s) |
| Fire | Low brown-noise roar plus random crackles and pops | Fire strength (wildfires near Verny) |

- **When it plays:** browsers only allow audio after a user action, so the
  sound starts with your first click or key press (dragging Verny counts).
  It only plays while Verny is dropped on the map and the story is not running.
- **On/off:** the speaker button in the header or the `M` key. The choice is
  remembered.
- **Idle:** after 3 seconds of silence the audio context is suspended, so it
  uses no CPU.
- **Code:** `zone-probe/soundscape/soundscape.engine.ts` (synthesis) and
  `soundscape.service.ts` (audio context, unlock, mute).

## Wind layer (2D and 3D)

"Wind" in the layer menu shows animated particles that follow the 10 m wind,
colored by speed: blue = calm, green, yellow, orange, red/pink = storm.

- **Data:** one snapshot at 12:00 UTC on the 15th of the selected month (or
  yesterday, in the current month). Recent dates come from the Open-Meteo
  Forecast API, which serves past days with no delay. Older dates come from
  the Open-Meteo Historical Weather API (ECMWF ERA5). If one returns no data,
  the other is tried, and an error is shown if both fail. It is a 12° global
  grid (420 points, 3 batched requests) with bilinear interpolation.
- **Cache:** each date is cached in `localStorage` (`astrobox.wind.v2.*`),
  because every grid point counts against Open-Meteo's free daily quota. Only
  complete fields are cached.
- **Rendering:** a canvas over the map. Particles move in longitude/latitude
  and are projected through the same map adapter as Verny, so it works on the
  3D globe (the far side is hidden) and on the 2D map. Their on-screen speed
  stays constant at any zoom. Each particle is drawn as a short streak (about
  0.3 s of its path), so the flow stays visible while the map moves; fading
  trails build up when the camera is still.
- **Code:** `src/app/wind/` (`wind-field.ts`, `wind-field.store.ts`,
  `wind-particle-renderer.ts`, `wind-layer.ts`).

## Rain strength (visuals and sound)

Mean daily precipitation → strength 0–1 (`rainIntensity` in `zone-probe.store.ts`):
1 mm/day ≈ 0.10, 2.5 ≈ 0.21, 8 ≈ 0.48, 15 ≈ 0.76, ≥ 22 = 1.
The screen effect scales more steeply than that strength. At 1 mm/day there
are ~20 streaks and ~1 drop/s on the glass; only storms fill the screen.

## Base map

Both maps use **Esri World Street Map**, which labels countries in English.
It replaces the standard OpenStreetMap tiles, which label each country in its
own language. Change it in `src/app/basemap.ts`.

## Sources and licenses

| Resource | Used for | Terms |
| --- | --- | --- |
| [Open-Meteo Forecast API](https://open-meteo.com/en/docs) and [Historical Weather API](https://open-meteo.com/en/docs/historical-weather-api) (ERA5) | Wind layer | Free for non-commercial use, no key; data CC BY 4.0, attribution "Weather data by Open-Meteo.com" (shown in the footer) |
| [Esri World Street Map](https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer) | Base map with English labels | Public tile service, no key; attribution "Tiles © Esri" (shown on the map) |
| [NASA POWER daily point API](https://power.larc.nasa.gov/) | Zone temperature, rain, wind | Public NASA data, no key |
| NASA EONET | Wildfires | Public NASA data |
| NASA GIBS (GPM IMERG, GHRSST MUR, VIIRS LST) | Map layers | Public NASA imagery |
| [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API) (browser built-in) | All sounds, synthesized in code | No external audio assets |
| Pink-noise filter by Paul Kellet ("refined method") | Rain and wind noise color | Public-domain DSP technique |

## Ready for more sound

New sound layers (e.g. recorded samples or music) can inject `ZoneProbeStore` and read the signals
`mood()`, `precipitationLevel()`, `fires()`, `climate()` and `effectTargets()`
(rain and fire strength 0–1, wind in m/s). These are the same values that
drive the visuals.
