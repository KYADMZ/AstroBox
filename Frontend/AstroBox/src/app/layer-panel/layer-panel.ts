import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';
import type { VisualizationId } from '../map.models';
import type { ClimateClass, ClimateZoneSelection } from '../climate-zones';

export interface LayerPanelOption {
  id: VisualizationId;
  label: string;
  active: boolean;
  /** Legend text shown under the option while it is active. */
  legend?: string;
  /** CSS background for the legend swatch. */
  legendSwatch?: string;
  /** Error message for this layer, if any. */
  error?: string | null;
  climateClasses?: readonly ClimateClass[];
  climateSelection?: ClimateZoneSelection | null;
}

/**
 * Right-side "Show on map" menu. It can be minimized into a small tab at the
 * bottom edge of the map.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-layer-panel',
  styleUrl: './layer-panel.scss',
  templateUrl: './layer-panel.html',
})
export class LayerPanelComponent {
  @Input() options: LayerPanelOption[] = [];
  @Input() minimized = false;
  @Input() seaTemperatureOpacity = 0.7;
  @Output() toggleLayer = new EventEmitter<VisualizationId>();
  @Output() minimizedChange = new EventEmitter<boolean>();
  @Output() seaTemperatureOpacityChange = new EventEmitter<number>();

  protected get activeCount(): number {
    return this.options.filter((option) => option.active).length;
  }

  protected get opacityPercent(): number {
    return Math.round(this.seaTemperatureOpacity * 100);
  }

  protected coordinate(value: number): string {
    return value.toFixed(2);
  }

  protected setMinimized(minimized: boolean): void {
    this.minimizedChange.emit(minimized);
  }

  protected onOpacityInput(event: Event): void {
    const input = event.target;
    if (input instanceof HTMLInputElement) {
      this.seaTemperatureOpacityChange.emit(Number(input.value));
    }
  }
}
