import { CHART_EMPTY_HEIGHT, resolveChartHeight } from './chartShell';

describe('chartShell', () => {
  it('keeps configured height when there is data', () => {
    expect(resolveChartHeight(320, false)).toBe(320);
  });

  it('shrinks empty chart rows to compact height', () => {
    expect(resolveChartHeight(320, true)).toBe(CHART_EMPTY_HEIGHT);
    expect(resolveChartHeight(640, true)).toBe(CHART_EMPTY_HEIGHT);
  });

  it('does not shrink below requested height for already small charts', () => {
    expect(resolveChartHeight(160, true)).toBe(160);
  });
});
