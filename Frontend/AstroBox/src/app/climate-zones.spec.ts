import { CLIMATE_CLASSES, climateClassForValue } from './climate-zones';

describe('Köppen-Geiger climate classes', () => {
  it('maps source raster values to their documented class names', () => {
    expect(CLIMATE_CLASSES).toHaveLength(30);
    expect(CLIMATE_CLASSES.map(({ value }) => value)).toEqual(
      Array.from({ length: 30 }, (_, index) => index + 1),
    );
    expect(climateClassForValue(1)?.code).toBe('Af');
    expect(climateClassForValue(4)?.code).toBe('BWh');
    expect(climateClassForValue(15)?.code).toBe('Cfb');
    expect(climateClassForValue(26)?.code).toBe('Dfb');
    expect(climateClassForValue(29)?.code).toBe('ET');
    expect(climateClassForValue(30)?.code).toBe('EF');
  });

  it('does not assign a climate class to raster no-data values', () => {
    expect(climateClassForValue(0)).toBeUndefined();
    expect(climateClassForValue(31)).toBeUndefined();
  });
});
