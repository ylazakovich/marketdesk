import { normalizeWorkspacePatch } from '../workspaceSettingsValidation';

describe('normalizeWorkspacePatch', () => {
  it('normalizes names and accepts valid partial settings', () => {
    expect(
      normalizeWorkspacePatch({
        name: '  Operations  ',
        timezone: 'Europe/Warsaw',
        guardrails: { autoRelist: true },
      })
    ).toEqual({
      name: 'Operations',
      timezone: 'Europe/Warsaw',
      guardrails: { autoRelist: true },
    });
  });

  const invalidCases: Array<[unknown, RegExp]> = [
    [{ name: '   ' }, /Workspace name is required/],
    [{ currency: 'pln' }, /Invalid currency code/],
    [{ timezone: 'Mars\/Olympus' }, /Invalid timezone/],
    [{ guardrails: { maxAutoPriceChangePct: 101 } }, /within \[0, 100\]/],
    [{ guardrails: { autoRelist: 'yes' } }, /must be a boolean/],
    [{ creativityPreset: 'random' }, /Invalid Hermes creativity preset/],
    [{ listingSeoEnabled: 'yes' }, /listingSeoEnabled must be a boolean/],
  ];

  it.each(invalidCases)(
    'rejects invalid repository patch %#',
    (patch: unknown, expected: RegExp) => {
      expect(() => normalizeWorkspacePatch(patch as never)).toThrow(expected);
    }
  );
});
