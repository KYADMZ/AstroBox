import { Injectable, signal } from '@angular/core';
import { loadWindField, type WindField } from './wind-field';

type WindStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Loads and shares the wind field used by the wind layer on both maps. */
@Injectable({ providedIn: 'root' })
export class WindFieldStore {
  private readonly fieldState = signal<WindField | null>(null);
  private readonly statusState = signal<WindStatus>('idle');
  private readonly errorState = signal<string | null>(null);
  private requestedDate?: string;
  private controller?: AbortController;

  readonly field = this.fieldState.asReadonly();
  readonly status = this.statusState.asReadonly();
  readonly error = this.errorState.asReadonly();

  /** Requests the field for an ISO date. Repeated calls for the same date are ignored. */
  load(date: string): void {
    if (date === this.requestedDate && this.statusState() !== 'error') {
      return;
    }
    this.requestedDate = date;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    this.statusState.set('loading');
    this.errorState.set(null);

    loadWindField(date, controller.signal).then(
      (field) => {
        if (controller === this.controller) {
          this.fieldState.set(field);
          this.statusState.set('ready');
        }
      },
      (error: unknown) => {
        if (controller !== this.controller || controller.signal.aborted) {
          return;
        }
        console.error('Unable to load the Open-Meteo wind field.', error);
        this.statusState.set('error');
        this.errorState.set(`Wind data is unavailable for ${date}.`);
      },
    );
  }
}
