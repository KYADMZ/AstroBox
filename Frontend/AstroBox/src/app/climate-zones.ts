import type * as Cesium from 'cesium';

const IMAGE_SERVICE_URL =
  'https://tiledimageservices.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/Koppen_Geiger_Climate_Classification/ImageServer';
const DATA_MIDPOINT_YEAR = 2005;
const SSP = 245;
const TILE_SIZE = 256;
const FIRST_LEVEL_RESOLUTION_DEGREES = 1.0666624000005;
const MAX_LEVEL = 7;
const TILE_CACHE_LIMIT = 72;

export interface ClimateClass {
  code: string;
  value: number;
  name: string;
  group: string;
  description: string;
  color: string;
}

export interface ClimateZoneSelection {
  code: string;
  name: string;
  description: string;
  longitude: number;
  latitude: number;
}

export const CLIMATE_CLASSES: readonly ClimateClass[] = [
  {
    value: 1,
    code: 'Af',
    name: 'Tropical rainforest',
    group: 'Tropical',
    description: 'Hot year-round with abundant rainfall in every month.',
    color: '#237c50',
  },
  {
    value: 2,
    code: 'Am',
    name: 'Tropical monsoon',
    group: 'Tropical',
    description: 'Hot year-round with a short, pronounced dry season.',
    color: '#328f4d',
  },
  {
    value: 3,
    code: 'Aw',
    name: 'Tropical savanna (dry winter)',
    group: 'Tropical',
    description: 'Hot year-round with a dry winter and a wetter summer.',
    color: '#78b64f',
  },
  {
    value: 4,
    code: 'BWh',
    name: 'Hot desert',
    group: 'Arid',
    description: 'Extremely dry desert climate with hot temperatures.',
    color: '#db9a32',
  },
  {
    value: 5,
    code: 'BWk',
    name: 'Cold desert',
    group: 'Arid',
    description: 'Extremely dry desert climate with cooler winters.',
    color: '#e5b34d',
  },
  {
    value: 6,
    code: 'BSh',
    name: 'Hot semi-arid steppe',
    group: 'Arid',
    description: 'Dry steppe climate with hot temperatures.',
    color: '#c27d35',
  },
  {
    value: 7,
    code: 'BSk',
    name: 'Cold semi-arid steppe',
    group: 'Arid',
    description: 'Dry steppe climate with cool or cold winters.',
    color: '#b99757',
  },
  {
    value: 8,
    code: 'Csa',
    name: 'Hot-summer Mediterranean',
    group: 'Temperate',
    description: 'Dry, hot summers and mild, wetter winters.',
    color: '#c76f54',
  },
  {
    value: 9,
    code: 'Csb',
    name: 'Warm-summer Mediterranean',
    group: 'Temperate',
    description: 'Dry summers are warm but not as hot as Csa; winters are mild and wetter.',
    color: '#cc8864',
  },
  {
    value: 10,
    code: 'Csc',
    name: 'Cool-summer Mediterranean',
    group: 'Temperate',
    description: 'Dry summers are cool, with mild and wetter winters.',
    color: '#b67c73',
  },
  {
    value: 11,
    code: 'Cwa',
    name: 'Dry-winter humid subtropical',
    group: 'Temperate',
    description: 'Hot, rainy summers and a distinct dry winter.',
    color: '#d98260',
  },
  {
    value: 12,
    code: 'Cwb',
    name: 'Dry-winter subtropical highland',
    group: 'Temperate',
    description: 'Mild summers, cool winters, and a distinct dry winter.',
    color: '#cf9a73',
  },
  {
    value: 13,
    code: 'Cwc',
    name: 'Dry-winter cold subtropical highland',
    group: 'Temperate',
    description: 'Short, cool summers with a distinct dry winter.',
    color: '#c1a08a',
  },
  {
    value: 14,
    code: 'Cfa',
    name: 'Humid subtropical',
    group: 'Temperate',
    description: 'Hot, humid summers and mild winters, without a dry season.',
    color: '#43aa93',
  },
  {
    value: 15,
    code: 'Cfb',
    name: 'Oceanic',
    group: 'Temperate',
    description: 'Mild summers and cool winters with precipitation through the year.',
    color: '#4598a1',
  },
  {
    value: 16,
    code: 'Cfc',
    name: 'Subpolar oceanic',
    group: 'Temperate',
    description: 'Short, cool summers and mild-to-cold winters with year-round precipitation.',
    color: '#548992',
  },
  {
    value: 17,
    code: 'Dsa',
    name: 'Hot-summer continental (dry summer)',
    group: 'Continental',
    description: 'Hot summers, cold winters, and a dry summer.',
    color: '#687fc0',
  },
  {
    value: 18,
    code: 'Dsb',
    name: 'Warm-summer continental (dry summer)',
    group: 'Continental',
    description: 'Warm summers, cold winters, and a dry summer.',
    color: '#6488b8',
  },
  {
    value: 19,
    code: 'Dsc',
    name: 'Subarctic (dry summer)',
    group: 'Continental',
    description: 'Short, cool summers, very cold winters, and a dry summer.',
    color: '#5b7fa8',
  },
  {
    value: 20,
    code: 'Dsd',
    name: 'Extremely cold subarctic (dry summer)',
    group: 'Continental',
    description: 'Short, cool summers, extremely cold winters, and a dry summer.',
    color: '#507292',
  },
  {
    value: 21,
    code: 'Dwa',
    name: 'Hot-summer continental (dry winter)',
    group: 'Continental',
    description: 'Hot summers, cold winters, and a dry winter.',
    color: '#617fce',
  },
  {
    value: 22,
    code: 'Dwb',
    name: 'Warm-summer continental (dry winter)',
    group: 'Continental',
    description: 'Warm summers, cold winters, and a dry winter.',
    color: '#5a8ec1',
  },
  {
    value: 23,
    code: 'Dwc',
    name: 'Subarctic (dry winter)',
    group: 'Continental',
    description: 'Short, cool summers, very cold winters, and a dry winter.',
    color: '#4c7da7',
  },
  {
    value: 24,
    code: 'Dwd',
    name: 'Extremely cold subarctic (dry winter)',
    group: 'Continental',
    description: 'Short, cool summers, extremely cold winters, and a dry winter.',
    color: '#426d8e',
  },
  {
    value: 25,
    code: 'Dfa',
    name: 'Hot-summer continental',
    group: 'Continental',
    description: 'Hot summers, cold winters, and precipitation through the year.',
    color: '#4d82b6',
  },
  {
    value: 26,
    code: 'Dfb',
    name: 'Warm-summer continental',
    group: 'Continental',
    description: 'Warm summers, cold winters, and precipitation through the year.',
    color: '#4172a5',
  },
  {
    value: 27,
    code: 'Dfc',
    name: 'Subarctic',
    group: 'Continental',
    description: 'Short, cool summers, very cold winters, and precipitation through the year.',
    color: '#356493',
  },
  {
    value: 28,
    code: 'Dfd',
    name: 'Extremely cold subarctic',
    group: 'Continental',
    description: 'Short, cool summers, extremely cold winters, and precipitation through the year.',
    color: '#2c587f',
  },
  {
    value: 29,
    code: 'ET',
    name: 'Tundra',
    group: 'Polar',
    description: 'Warmest month is above freezing but remains below 10°C.',
    color: '#8e79b8',
  },
  {
    value: 30,
    code: 'EF',
    name: 'Ice cap',
    group: 'Polar',
    description: 'Every month has a mean temperature below 0°C.',
    color: '#bac2cc',
  },
];

const CLASSES_BY_VALUE = new Map(
  CLIMATE_CLASSES.map((climateClass) => [climateClass.value, climateClass]),
);
let decoderReady: Promise<LercDecoder> | undefined;

interface LercRaster {
  width: number;
  height: number;
  pixels: Uint8Array[];
  mask: Uint8Array | null;
}

interface LercDecoder {
  decode(input: ArrayBuffer): LercRaster;
  load(options: { locateFile: () => string }): Promise<void>;
}

interface ClimateRasterTile {
  pixels: Uint8Array;
  mask: Uint8Array | null;
  canvas: HTMLCanvasElement;
}

class ClimateTilingScheme implements Cesium.TilingScheme {
  readonly ellipsoid: Cesium.Ellipsoid;
  readonly rectangle: Cesium.Rectangle;
  readonly projection: Cesium.MapProjection;

  constructor(private readonly cesium: typeof Cesium) {
    this.ellipsoid = cesium.Ellipsoid.WGS84;
    this.rectangle = cesium.Rectangle.MAX_VALUE;
    this.projection = new cesium.GeographicProjection(this.ellipsoid);
  }

  getNumberOfXTilesAtLevel(level: number): number {
    return Math.ceil(360 / this.tileSpanDegrees(level));
  }

  getNumberOfYTilesAtLevel(level: number): number {
    return Math.ceil(180 / this.tileSpanDegrees(level));
  }

  rectangleToNativeRectangle(
    rectangle: Cesium.Rectangle,
    result?: Cesium.Rectangle,
  ): Cesium.Rectangle {
    const target = result ?? new this.cesium.Rectangle(0, 0, 0, 0);
    target.west = this.cesium.Math.toDegrees(rectangle.west);
    target.south = this.cesium.Math.toDegrees(rectangle.south);
    target.east = this.cesium.Math.toDegrees(rectangle.east);
    target.north = this.cesium.Math.toDegrees(rectangle.north);
    return target;
  }

  tileXYToNativeRectangle(
    x: number,
    y: number,
    level: number,
    result?: Cesium.Rectangle,
  ): Cesium.Rectangle {
    const span = this.tileSpanDegrees(level);
    const west = -180 + x * span;
    const north = 90 - y * span;
    const target = result ?? new this.cesium.Rectangle(0, 0, 0, 0);
    target.west = west;
    target.south = north - span;
    target.east = west + span;
    target.north = north;
    return target;
  }

  tileXYToRectangle(
    x: number,
    y: number,
    level: number,
    result?: Cesium.Rectangle,
  ): Cesium.Rectangle {
    const native = this.tileXYToNativeRectangle(x, y, level);
    return this.cesium.Rectangle.fromDegrees(
      native.west,
      native.south,
      native.east,
      native.north,
      result,
    );
  }

  positionToTileXY(
    position: Cesium.Cartographic,
    level: number,
    result?: Cesium.Cartesian2,
  ): Cesium.Cartesian2 {
    const span = this.tileSpanDegrees(level);
    const longitude = this.cesium.Math.toDegrees(position.longitude);
    const latitude = this.cesium.Math.toDegrees(position.latitude);
    const x = Math.floor((longitude + 180) / span);
    const y = Math.floor((90 - latitude) / span);
    const target = result ?? new this.cesium.Cartesian2();
    target.x = Math.min(Math.max(x, 0), this.getNumberOfXTilesAtLevel(level) - 1);
    target.y = Math.min(Math.max(y, 0), this.getNumberOfYTilesAtLevel(level) - 1);
    return target;
  }

  tileSpanDegrees(level: number): number {
    return (FIRST_LEVEL_RESOLUTION_DEGREES * TILE_SIZE) / 2 ** level;
  }
}

function createClimateProvider(
  cesium: typeof Cesium,
  onError: (message: string) => void,
): Cesium.ImageryProvider {
  class Provider extends cesium.UrlTemplateImageryProvider {
    private readonly cache = new Map<string, ClimateRasterTile>();
    private readonly pending = new Map<string, Promise<ClimateRasterTile>>();
    private readonly matrix: ClimateTilingScheme;

    constructor() {
      const matrix = new ClimateTilingScheme(cesium);
      super({
        credit: new cesium.Credit(
          'Köppen-Geiger data: Beck et al. (2023), Scientific Data 10, 724 · CC BY 4.0',
        ),
        enablePickFeatures: true,
        maximumLevel: MAX_LEVEL,
        minimumLevel: 0,
        tilingScheme: matrix,
        tileHeight: TILE_SIZE,
        tileWidth: TILE_SIZE,
        url: `${IMAGE_SERVICE_URL}/tile/{z}/{y}/{x}`,
      });
      this.matrix = matrix;
    }

    override requestImage(
      x: number,
      y: number,
      level: number,
      _request?: Cesium.Request,
    ): Promise<HTMLCanvasElement> | undefined {
      if (level < 0 || level > MAX_LEVEL) {
        return undefined;
      }
      return this.getTile(x, y, level).then((tile) => tile.canvas);
    }

    override pickFeatures(
      x: number,
      y: number,
      level: number,
      longitude: number,
      latitude: number,
    ): Promise<Cesium.ImageryLayerFeatureInfo[]> | undefined {
      if (level < 0 || level > MAX_LEVEL) {
        return undefined;
      }
      return this.getTile(x, y, level).then((tile) => {
        const span = this.matrix.tileSpanDegrees(level);
        const west = -180 + x * span;
        const north = 90 - y * span;
        const pixelX = Math.floor(((cesium.Math.toDegrees(longitude) - west) / span) * TILE_SIZE);
        const pixelY = Math.floor(((north - cesium.Math.toDegrees(latitude)) / span) * TILE_SIZE);
        if (pixelX < 0 || pixelX >= TILE_SIZE || pixelY < 0 || pixelY >= TILE_SIZE) {
          return [];
        }

        const index = pixelY * TILE_SIZE + pixelX;
        const value = tile.pixels[index];
        const climateClass = tile.mask?.[index] === 0 ? undefined : CLASSES_BY_VALUE.get(value);
        if (!climateClass) {
          return [];
        }

        const info = new cesium.ImageryLayerFeatureInfo();
        info.name = `${climateClass.code} · ${climateClass.name}`;
        info.description = climateClass.description;
        info.position = new cesium.Cartographic(longitude, latitude);
        info.data = {
          code: climateClass.code,
          name: climateClass.name,
          description: climateClass.description,
          longitude: cesium.Math.toDegrees(longitude),
          latitude: cesium.Math.toDegrees(latitude),
        } satisfies ClimateZoneSelection;
        return [info];
      });
    }

    private getTile(x: number, y: number, level: number): Promise<ClimateRasterTile> {
      const key = `${level}/${y}/${x}`;
      const cached = this.cache.get(key);
      if (cached) {
        this.cache.delete(key);
        this.cache.set(key, cached);
        return Promise.resolve(cached);
      }
      const requested = this.pending.get(key);
      if (requested) {
        return requested;
      }

      const definition = encodeURIComponent(
        JSON.stringify([
          {
            variableName: 'Koppen Geiger Class',
            dimensionName: 'StdTime',
            values: [Date.UTC(DATA_MIDPOINT_YEAR, 0, 1)],
            isSlice: true,
          },
          {
            variableName: 'Koppen Geiger Class',
            dimensionName: 'SSP',
            values: [SSP],
            isSlice: true,
          },
        ]),
      );
      const url = `${IMAGE_SERVICE_URL}/tile/${level}/${y}/${x}?multidimensionalDefinition=${definition}`;
      const promise = fetch(url)
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`The climate image service returned HTTP ${response.status}.`);
          }
          const bytes = await response.arrayBuffer();
          const decoder = await ensureDecoderReady();
          const raster = decoder.decode(bytes);
          const pixels = raster.pixels[0];
          if (
            !(pixels instanceof Uint8Array) ||
            raster.width !== TILE_SIZE ||
            raster.height !== TILE_SIZE
          ) {
            throw new Error('The climate image service returned an unsupported raster tile.');
          }
          const canvas = document.createElement('canvas');
          canvas.width = TILE_SIZE;
          canvas.height = TILE_SIZE;
          const context = canvas.getContext('2d');
          if (!context) {
            throw new Error('Canvas 2D is not available for climate raster rendering.');
          }
          const image = context.createImageData(TILE_SIZE, TILE_SIZE);
          for (let index = 0; index < pixels.length; index += 1) {
            const climateClass =
              raster.mask?.[index] === 0 ? undefined : CLASSES_BY_VALUE.get(pixels[index]);
            if (!climateClass) {
              continue;
            }
            const color = climateClass.color;
            const output = index * 4;
            image.data[output] = Number.parseInt(color.slice(1, 3), 16);
            image.data[output + 1] = Number.parseInt(color.slice(3, 5), 16);
            image.data[output + 2] = Number.parseInt(color.slice(5, 7), 16);
            image.data[output + 3] = 220;
          }
          context.putImageData(image, 0, 0);
          return { pixels, mask: raster.mask, canvas };
        })
        .then((tile) => {
          this.cache.set(key, tile);
          if (this.cache.size > TILE_CACHE_LIMIT) {
            const oldest = this.cache.keys().next().value;
            if (oldest !== undefined) {
              this.cache.delete(oldest);
            }
          }
          return tile;
        })
        .catch((error: unknown) => {
          console.error('Unable to load a Köppen-Geiger climate tile.', error);
          onError('Climate zone imagery is unavailable.');
          throw error;
        })
        .finally(() => this.pending.delete(key));
      this.pending.set(key, promise);
      return promise;
    }
  }

  return new Provider();
}

export function climateClassForValue(value: number): ClimateClass | undefined {
  return CLASSES_BY_VALUE.get(value);
}

export async function createClimateZoneImageryProvider(
  cesium: typeof Cesium,
  onError: (message: string) => void,
): Promise<Cesium.ImageryProvider> {
  await ensureDecoderReady();
  return createClimateProvider(cesium, onError);
}

export function createClimateZonePickHandler(
  cesium: typeof Cesium,
  viewer: Cesium.Viewer,
  isEnabled: () => boolean,
  onSelection: (selection: ClimateZoneSelection | null) => void,
): Cesium.ScreenSpaceEventHandler {
  const handler = new cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  let latestRequest = 0;
  handler.setInputAction((event: { position: Cesium.Cartesian2 }) => {
    if (!isEnabled()) {
      return;
    }
    const requestId = ++latestRequest;
    const ray = viewer.camera.getPickRay(event.position);
    if (!ray) {
      return;
    }
    const features = viewer.imageryLayers.pickImageryLayerFeatures(ray, viewer.scene);
    if (!features) {
      onSelection(null);
      return;
    }
    void features.then(
      (picked) => {
        if (requestId !== latestRequest || !isEnabled()) {
          return;
        }
        const feature = picked.find(isClimateZoneFeature);
        onSelection(feature ? feature.data : null);
      },
      (error: unknown) => {
        if (requestId === latestRequest) {
          console.error('Unable to identify the climate zone at this location.', error);
        }
      },
    );
  }, cesium.ScreenSpaceEventType.LEFT_CLICK);
  return handler;
}

function isClimateZoneFeature(
  feature: Cesium.ImageryLayerFeatureInfo,
): feature is Cesium.ImageryLayerFeatureInfo & { data: ClimateZoneSelection } {
  const data: unknown = feature.data;
  return (
    typeof data === 'object' &&
    data !== null &&
    'code' in data &&
    typeof data.code === 'string' &&
    'name' in data &&
    typeof data.name === 'string' &&
    'description' in data &&
    typeof data.description === 'string' &&
    'longitude' in data &&
    typeof data.longitude === 'number' &&
    'latitude' in data &&
    typeof data.latitude === 'number'
  );
}

function ensureDecoderReady(): Promise<LercDecoder> {
  if (!decoderReady) {
    decoderReady = new Promise<LercDecoder>((resolve, reject) => {
      const current = (globalThis as typeof globalThis & { Lerc?: LercDecoder }).Lerc;
      if (current) {
        void current
          .load({ locateFile: () => '/assets/lerc/lerc-wasm.wasm' })
          .then(() => resolve(current), reject);
        return;
      }

      const script = document.createElement('script');
      script.async = true;
      script.src = '/assets/lerc/LercDecode.js';
      script.onload = () => {
        const decoder = (globalThis as typeof globalThis & { Lerc?: LercDecoder }).Lerc;
        if (!decoder) {
          reject(new Error('The LERC decoder script did not expose its API.'));
          return;
        }
        void decoder
          .load({ locateFile: () => '/assets/lerc/lerc-wasm.wasm' })
          .then(() => resolve(decoder), reject);
      };
      script.onerror = () => reject(new Error('The LERC decoder script could not be loaded.'));
      document.head.append(script);
    });
  }
  return decoderReady;
}
