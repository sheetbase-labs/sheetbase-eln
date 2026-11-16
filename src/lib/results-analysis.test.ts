import { describe, expect, it } from 'vitest'

import {
  analysisSource,
  isAnalysisAction,
  proposeAnalysisAddSchema,
} from './results-analysis'

describe('results analysis', () => {
  it('fills the settings line of the analysis and nothing else', () => {
    const source = analysisSource(
      'import x\nPARAMS = {}  # sheetbase:settings\nprint(PARAMS)\n',
      {
        kind: 'dose_response',
        input: 'data',
        x: 'dose',
        y: 'resp',
        group: undefined,
        unit: '',
      },
    )

    expect(source).toBe(
      'import x\nPARAMS = {"kind": "dose_response", "input": "data", "x": "dose", "y": "resp"}\nprint(PARAMS)\n',
    )
  })

  it('writes the plot labels as a nested setting', () => {
    const source = analysisSource('PARAMS = {}  # sheetbase:settings\n', {
      kind: 'compare_groups',
      input: 'data',
      group: 'arm',
      y: 'v',
      labels: { y: 'Titre (ng/mL)', x: undefined },
    })

    expect(source).toBe(
      'PARAMS = {"kind": "compare_groups", "input": "data", "group": "arm", "y": "v", "labels": {"y": "Titre (ng/mL)"}}\n',
    )
  })

  it('refuses code that has no settings line', () => {
    expect(() =>
      analysisSource('print(1)', { kind: 'compare_groups', input: 'data' }),
    ).toThrow(/settings line/)
  })

  it('knows its own card action', () => {
    expect(isAnalysisAction({ kind: 'analysis.add_to_notebook' })).toBe(true)
    expect(isAnalysisAction({ kind: 'plate.analyse' })).toBe(false)
  })

  it('needs a kind, a response column and a summary', () => {
    const base = {
      title: 'Fit',
      summary: 'Fit the curve',
      experiment: 'EXP-0001',
      dataset: 'Dose plate',
      kind: 'dose_response',
      y: 'signal',
      draftSummary: 'EC50 is 2 nM.',
    }

    expect(proposeAnalysisAddSchema.safeParse(base).success).toBe(true)
    expect(
      proposeAnalysisAddSchema.safeParse({ ...base, kind: 'anova' }).success,
    ).toBe(false)
    expect(
      proposeAnalysisAddSchema.safeParse({ ...base, draftSummary: '' }).success,
    ).toBe(false)
  })
})
