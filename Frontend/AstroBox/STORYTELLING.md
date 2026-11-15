# El Niño storytelling (2D map) and sea temperature layer (3D globe)

This document describes two additions:

1. A guided, ~90-second **El Niño story** that runs **only on the 2D map**.
2. A **sea surface temperature (SST) anomaly layer** on the **3D globe**, next to
   the existing wildfire and precipitation visualizations.

The two features are kept strictly separate. The 3D globe has no storytelling,
camera automation, narration, mascot or audio code. The 2D map gets the story
but no other changes to how it already works.

---

## Files

### New

| File | Purpose |
| --- | --- |
| `src/app/gibs/gibs-wms.ts` | Shared NASA GIBS WMS helper (WMS 1.1.1, EPSG:4326, `image/png`, transparent, `GeographicTilingScheme`, `TIME`). Used by the 3D SST layer and the story layers. |
| `src/app/storytelling/story.models.ts` | Map-agnostic TypeScript interfaces: scenes, camera, layers, visual elements, lifecycle events, and the `StoryStage` contract. |
| `src/app/storytelling/el-nino-story.ts` | The five El Niño scenes (text, timing, camera path, layers, map annotations). |
| `src/app/storytelling/story-player.service.ts` | `StoryPlayerService`: playback state machine (start, pause, resume, restart, exit), timing and lifecycle events. |
| `src/app/map-2d/story-map-director.ts` | `StoryMapDirector`: draws the story on the **existing** 2D Cesium viewer (camera flights, NASA layers, annotations, input lock, state restore). |
| `src/app/map-2d/story-overlay/story-overlay.{ts,html,scss}` | Story UI: start card, scene title, narration, scene indicator, progress bar, data legend, playback buttons. |

### Modified

| File | Change |
| --- | --- |
| `src/app/map-2d/map-2d.ts` | Provides `StoryPlayerService` (scoped to the 2D map), creates the `StoryMapDirector` after the viewer is ready, postpones regular layer updates while a story plays, adds `storyEvent` and `storyActiveChange` outputs. |
| `src/app/map-2d/map-2d.html` | Adds `<app-story-overlay />`. |
| `src/app/app.ts` | 3D only: new `seaTemperature` visualization with toggle, opacity, month-linked date, error handling and cleanup. Tracks `storyActive` from the 2D map. |
| `src/app/app.html` | SST toggle (3D only), opacity slider, legend entry, error message, credit. Hides the activity card and legend while the 2D story plays. |
| `src/app/app.scss` | Small styles for the SST toggle dot, legend swatch and opacity slider. |
| `src/app/map.models.ts` | `VisualizationId` now includes `'seaTemperature'`. |

No other viewer is created: the story reuses the 2D map's viewer, and the SST
layer is added to the 3D globe's existing viewer.

---

## How to run and test the story

```bash
cd Frontend/AstroBox
npm install
npm start          # ng serve → http://localhost:4200
```

1. Click **2D map** in the top bar.
2. Click **Start story** in the "Guided story" card (top left). It is disabled
   ("Preparing map…") until the 2D viewer is ready.
3. Check that:
   - the camera moves on its own through the 5 scenes (about 90 s);
   - dragging or scrolling on the map does nothing while the story plays;
   - **Pause** freezes the timer and the camera; **Resume** continues from the
     same point;
   - **Restart** goes back to scene 1 without a jump to the original view;
   - **Exit story** (or the **Esc** key) stops at once and restores the camera,
     map controls, wildfire markers and precipitation layer exactly as before;
   - at the end, the map is restored and the card offers **Watch again**.
4. While the story plays, change the month or toggle layers in the timeline
   panel. Nothing changes on the map until the story ends; then the new
   settings are applied.
5. Switch to **3D map** during the story. The story is cancelled cleanly and
   the 3D globe has no storytelling UI.

### Scenes

| # | Title | Duration | Camera | Map content |
| --- | --- | --- | --- | --- |
| 1 | The Ocean Begins to Warm | 15 s | Global → central/eastern equatorial Pacific | Observed SST anomalies; equatorial Pacific highlight; Niño 3.4 box |
| 2 | What Causes El Niño? | 17 s | Close view of the tropical Pacific | Observed SST anomalies; illustrative trade-wind arrows (normal → weakened) and warm water moving east |
| 3 | Climate Changes Around the World | 20 s | Global → South America → Indonesia/Australia → global | Observed precipitation snapshot; illustrative wetter/drier zones |
| 4 | El Niño and Mexico | 20 s | Eastern Pacific → Mexico → northwestern Mexico → Mexico | Observed precipitation snapshot; labels for Chihuahua, Sonora, Baja California; illustrative wetter-winter and reduced-rainfall zones |
| 5 | One Phenomenon, Global Consequences | 18 s | Back to a stable global view | Observed SST anomalies; illustrative teleconnection arrows; ocean → atmosphere → rainfall summary |

### Scientific accuracy

- **Observed data** (shown with an "Observed data" badge):
  - SST anomalies: `GHRSST_L4_MUR25_Sea_Surface_Temperature_Anomalies`,
    **2023-12-15**, near the peak of the 2023–24 El Niño.
  - Precipitation: `IMERG_Precipitation_Rate`, **2024-01-15**. GIBS has no
    ready-made precipitation anomaly layer, so this is labeled as a single-day
    weather snapshot, not a seasonal anomaly.
- **Illustrative elements** (shown with an "Illustrative" badge, dashed
  outlines and italic labels): wind and warm-water arrows, and wetter/drier
  zones. These are simplified versions of the typical El Niño tendencies
  published by NOAA's Climate Prediction Center. They are not observations.
- **Reference elements**: place names and the standard Niño 3.4 region
  (5°N–5°S, 170°W–120°W).
- Mexico: the narration and zones describe *tendencies* ("during some
  events", "possible"). No specific hurricane, snowfall or other event is
  attributed to El Niño.

To change dates or text, edit `el-nino-story.ts`.

---

## The new SST layer on the 3D globe

- **Toggle:** "Sea temperature anomaly" in *Show on map*. It only appears in 3D
  mode and is off by default, so the 3D globe starts exactly as before.
- **Opacity:** a slider appears next to the toggle when the layer is on
  (10–100%, default 70%). It updates `ImageryLayer.alpha` directly.
- **Date:** uses the existing six-month slider and **Play timeline** button.
  The layer is not given its own date picker. For each month, the date sent is
  the 15th. For the current month it is the latest day likely to be published
  (today minus 2 days, as MUR data arrives with about a 1-day delay). The
  legend shows the exact date.
- **Coexistence:** wildfires are entities and always draw above imagery.
  Precipitation is kept above SST (`raiseToTop`) so both layers can be read
  together. Turning SST on or off never touches the wildfire data source or
  the precipitation layer.
- **Errors:** tile failures (e.g. a date without data) show
  "Sea temperature anomaly imagery is unavailable for YYYY-MM-DD." in the
  timeline panel. A request-id guard ignores errors from layers already
  replaced.
- **Removal:** the layer is removed and destroyed when you turn it off,
  change month, switch to the 2D map, or the component is destroyed.

---

## Lifecycle events for mascot and audio

`StoryPlayerService` is provided by `Map2DComponent`, so any component placed
inside the 2D map (for example a future `<app-story-mascot>` in
`map-2d.html`) can inject it. Events are also re-emitted through the 2D map's
`(storyEvent)` output.

| Event | Extra fields | When |
| --- | --- | --- |
| `storyStarted` | — | Playback begins |
| `sceneStarted` | `sceneIndex`, `scene` | A scene begins (camera starts moving) |
| `sceneEnded` | `sceneIndex`, `scene`, `reason`: `completed` \| `cancelled` \| `restarted` | A scene ends |
| `storyPaused` | `sceneIndex`, `scene`, `sceneElapsedMs` | Pause pressed |
| `storyResumed` | `sceneIndex`, `scene`, `sceneElapsedMs` | Resume pressed |
| `storyRestarted` | — | Restart pressed during playback (followed by `sceneStarted` for scene 1) |
| `storyCompleted` | — | Last scene finished (sent after the map is restored) |
| `storyCancelled` | — | Exit, Esc, switching to 3D, or component destroyed (sent after the map is restored) |

Every event also includes `storyId`, `timestamp` (`performance.now()`) and
`storyElapsedMs`.

Each scene has an optional `cues` object (`audioTrackId`,
`mascotAnimationId`) with placeholder ids. Nothing uses them yet.

```ts
// Example: future audio service inside the 2D map
private readonly player = inject(StoryPlayerService);

constructor() {
  this.player.on('sceneStarted')
    .pipe(takeUntilDestroyed())
    .subscribe(({ scene }) => this.play(scene.cues?.audioTrackId));
  this.player.on('storyPaused').pipe(takeUntilDestroyed()).subscribe(() => this.pauseAudio());
  this.player.on('storyResumed').pipe(takeUntilDestroyed()).subscribe(() => this.resumeAudio());
}
```

For fine-grained sync (e.g. lip-sync), use the signals `sceneElapsedMs()`,
`storyElapsedMs()`, `sceneProgress()` and `storyProgress()`.

---

## Architecture notes

- **Separation of concerns:** `story.models.ts`, `el-nino-story.ts` and
  `StoryPlayerService` do not depend on Cesium. Only `StoryMapDirector`
  (in `map-2d/`) knows about Cesium, through the `StoryStage` interface.
- **Timing:** one `requestAnimationFrame` loop. There are no chained
  `setTimeout` calls. Camera waypoints and element timings are worked out from
  the elapsed scene time, so pausing is exact. Frames longer than 250 ms (e.g.
  a background tab) are capped, so the story does not jump ahead.
- **Camera lock:** `screenSpaceCameraController.enableInputs = false` and the
  double-click handler is removed while the story plays. Both are restored
  afterwards.
- **State restore:** camera position, orientation and 2D frustum are saved at
  start and restored exactly. Wildfire and precipitation visibility are saved
  and restored. Story layers and entities are destroyed.
- **Robustness:** errors in stage steps or scene callbacks are logged and do
  not stop playback. If a NASA layer fails, a warning appears in the story
  panel and the story continues.
- **Style budgets:** story styles are in their own component, so `app.scss`
  only grew by a few rules. Its compiled size is close to the 10 kB
  `anyComponentStyle` budget in `angular.json`, so any further additions
  should go into separate components.
