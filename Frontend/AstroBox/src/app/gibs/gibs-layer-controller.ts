import type * as Cesium from 'cesium';
import { createGibsWmsProvider } from './gibs-wms';

export interface GibsLayerControllerOptions {
  /** GIBS layer identifier. */
  layer: string;
  /** Cesium credit text. */
  credit: string;
  /** Human-readable name used in error messages. */
  label: string;
  /** Initial opacity between 0 and 1. */
  opacity: number;
  /** Receives a user-facing error message, or null to clear it. */
  onError: (message: string | null) => void;
  /** Called after the imagery layer is added (e.g. to fix layer ordering). */
  afterAdd?: (layer: Cesium.ImageryLayer) => void;
}

/**
 * Manages one dated NASA GIBS WMS imagery layer on an existing Cesium viewer:
 * enabling, changing date, opacity, error reporting and clean removal.
 *
 * Used by the 3D globe and the 2D map for the sea surface temperature
 * anomaly layer, so both maps behave the same way.
 */
export class GibsImageryLayerController {
  private layer?: Cesium.ImageryLayer;
  private date?: string;
  private requestId = 0;
  private opacity: number;

  constructor(
    private readonly cesium: typeof Cesium,
    private readonly viewer: Cesium.Viewer,
    private readonly options: GibsLayerControllerOptions,
  ) {
    this.opacity = options.opacity;
  }

  /** The current imagery layer, if visible. */
  get imageryLayer(): Cesium.ImageryLayer | undefined {
    return this.layer;
  }

  /** Shows the layer for the given ISO date, replacing any other date. */
  show(date: string): void {
    if (this.viewer.isDestroyed()) {
      return;
    }
    if (this.layer && this.date === date) {
      return;
    }

    this.hide();
    const requestId = this.requestId;

    try {
      const provider = createGibsWmsProvider(this.cesium, {
        layer: this.options.layer,
        time: date,
        credit: this.options.credit,
      });
      provider.errorEvent.addEventListener((error) => {
        if (requestId !== this.requestId) {
          return;
        }
        console.error(`Unable to load ${this.options.label}.`, error);
        this.options.onError(`${this.options.label} imagery is unavailable for ${date}.`);
      });

      this.layer = this.viewer.imageryLayers.addImageryProvider(provider);
      this.layer.alpha = this.opacity;
      this.date = date;
      this.options.afterAdd?.(this.layer);
    } catch (error) {
      console.error(`Unable to create the ${this.options.label} layer.`, error);
      this.date = undefined;
      this.options.onError(`${this.options.label} imagery could not be loaded.`);
    }
  }

  /** Removes and destroys the layer. Pending tile errors are ignored. */
  hide(): void {
    this.requestId += 1;
    if (this.layer && !this.viewer.isDestroyed()) {
      this.viewer.imageryLayers.remove(this.layer, true);
    }
    this.layer = undefined;
    this.date = undefined;
    this.options.onError(null);
  }

  setOpacity(opacity: number): void {
    this.opacity = Math.min(Math.max(opacity, 0), 1);
    if (this.layer) {
      this.layer.alpha = this.opacity;
    }
  }
}
