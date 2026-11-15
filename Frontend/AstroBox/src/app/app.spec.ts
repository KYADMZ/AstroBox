import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
    })
      .compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should start with precipitation enabled and render visualization layers in order', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.brand-copy strong')?.textContent).toContain('ASTROBOX');
    const layerButtons = Array.from(
      compiled.querySelectorAll<HTMLButtonElement>('.layer-option'),
    );
    const layerNames = layerButtons.map((button) =>
      button.querySelector('.layer-name')?.textContent?.trim(),
    );
    expect(layerNames.slice(0, 2)).toEqual(['Precipitation', 'Wildfires']);
    expect(layerNames).toContain('Climate Zones');
    expect(layerButtons[0]?.getAttribute('aria-pressed')).toBe('true');
    expect(layerButtons[1]?.getAttribute('aria-pressed')).toBe('false');
  });
});
