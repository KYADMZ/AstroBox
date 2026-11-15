import { TestBed } from '@angular/core/testing';
import { ZoneProbeStore } from './zone-probe.store';

describe('ZoneProbeStore · Verny animation', () => {
  beforeEach(() => {
    // Keep the test offline: NASA POWER and the climate-zone lookup fail fast.
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it('waves from the dock and burns its feet next to a wildfire', () => {
    const store = TestBed.inject(ZoneProbeStore);
    expect(store.animation()).toBeNull();

    const point = { longitude: -106, latitude: 28.6 };
    store.setContext('2026-11', [
      { id: 'fire', title: 'Test fire', date: '2026-11-03', longitude: -106.2, latitude: 28.7 },
    ]);
    store.place(point);
    expect(store.animation()).toBe('burning');
    expect(store.effectTargets().fire).toBeGreaterThan(0);
  });

  it('has no snow or rain effects while docked', () => {
    const store = TestBed.inject(ZoneProbeStore);
    expect(store.effectTargets()).toEqual({ rain: 0, snow: 0, fire: 0, windSpeedMs: 0 });
  });
});
