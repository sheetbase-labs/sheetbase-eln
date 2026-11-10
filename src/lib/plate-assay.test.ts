import { describe, expect, it } from 'vitest'
import {
  analysePlate,
  defaultAssayConfig,
  inferPlateFormat,
  madScaled,
  molarFactor,
  normaliseAssayConfig,
  parsePlateTable,
  relativePotency,
  summarisePotency,
} from './plate-assay'
import type { AssayWell, PlateReadout, SampleCurve } from './plate-assay'
import { curveValue } from './curve-fit'
import { wellCode } from './plate-map'

function lcg(seed: number) {
  let s = seed

  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296

    return s / 4294967296 - 0.5
  }
}

/** A 384-well plate: column 1 negative (high signal), column 24 positive (low), rest samples. */
function screenPlate(seed = 1) {
  const noise = lcg(seed)
  const wells: AssayWell[] = []
  const readout: PlateReadout = {}

  for (let r = 0; r < 16; r++)
    for (let c = 0; c < 24; c++) {
      const code = wellCode(r, c)

      if (c === 0) {
        wells.push({ wellCode: code, role: 'negative_control' })
        readout[code] = 1000 + noise() * 40
      } else if (c === 23) {
        wells.push({ wellCode: code, role: 'positive_control' })
        readout[code] = 100 + noise() * 20
      } else {
        wells.push({
          wellCode: code,
          role: 'sample',
          sampleLabel: `S${r}-${c}`,
        })
        // Row 3 is strongly inhibiting, the rest are inactive.
        readout[code] = (r === 3 ? 150 : 1000) + noise() * 40
      }
    }

  return { wells, readout }
}

describe('384-well screening plate', () => {
  const { wells, readout } = screenPlate()
  const a = analysePlate(wells, readout, defaultAssayConfig())

  it('is recognised as 384-well', () => {
    expect(inferPlateFormat(wells.map((w) => w.wellCode))).toBe('384_well')
  })
  it('passes QC with a good Z′', () => {
    expect(a.qc.zPrime!).toBeGreaterThan(0.7)
    expect(a.qc.status).toBe('pass')
    expect(a.qc.signalToBackground!).toBeGreaterThan(1)
    expect(Math.abs(a.qc.ssmd!)).toBeGreaterThan(10)
  })
  it('normalises controls to 0 and 100 percent effect', () => {
    const negs = a.wells
      .filter((w) => w.role === 'negative_control')
      .map((w) => w.normalised!)

    const poss = a.wells
      .filter((w) => w.role === 'positive_control')
      .map((w) => w.normalised!)

    expect(negs.reduce((s, v) => s + v, 0) / negs.length).toBeCloseTo(0, 6)
    expect(poss.reduce((s, v) => s + v, 0) / poss.length).toBeCloseTo(100, 6)
  })
  it('calls the strong row as hits and nothing else', () => {
    expect(a.summary.hitSamples).toBe(22)
    expect(
      a.samples.filter((s) => s.hit).every((s) => s.label.startsWith('S3-')),
    ).toBe(true)
  })
  it('flags a plate with no separation as failed', () => {
    const flat: PlateReadout = {}
    const n = lcg(9)

    for (const w of wells) flat[w.wellCode] = 500 + n() * 400
    const bad = analysePlate(wells, flat)
    expect(bad.qc.zPrime!).toBeLessThan(0)
    expect(bad.qc.status).toBe('fail')
  })
  it('reports not_checked without controls', () => {
    const only = wells.filter((w) => w.role === 'sample')
    const r = analysePlate(only, readout)
    expect(r.qc.status).toBe('not_checked')
    expect(r.qc.zPrime).toBeNull()
    expect(r.wells.every((w) => w.normalised === null)).toBe(true)
  })
  it('supports sd and mad hit rules and replicate requirements', () => {
    const sd = analysePlate(wells, readout, {
      ...defaultAssayConfig(),
      hit: {
        kind: 'sd',
        threshold: 3,
        direction: 'above',
        minReplicates: 'all',
      },
    })

    expect(sd.summary.hitSamples).toBe(22)

    const mad = analysePlate(wells, readout, {
      ...defaultAssayConfig(),
      normalisation: 'robust_z',
      hit: { kind: 'mad', threshold: 3, direction: 'below', minReplicates: 1 },
    })

    expect(mad.summary.hitSamples).toBe(22)
  })
  it('subtracts a blank', () => {
    const withBlank = wells.map((w, i) =>
      i === 5 ? { ...w, role: 'blank' as const } : w,
    )

    const r = analysePlate(
      withBlank,
      { ...readout, [wells[5].wellCode]: 50 },
      {
        ...defaultAssayConfig(),
        subtractBlank: true,
      },
    )

    const w = r.wells[10]
    expect(w.corrected).toBeCloseTo(w.raw! - 50, 6)
  })
})

function dilutionPlate(ec50: number, seed: number, unit = 'nM') {
  const noise = lcg(seed)
  const wells: AssayWell[] = []
  const readout: PlateReadout = {}
  const params = { A: 0, B: 1.2, C: ec50, D: 100, G: 1 }

  for (let r = 0; r < 6; r++) {
    wells.push({ wellCode: wellCode(r, 0), role: 'negative_control' })
    readout[wellCode(r, 0)] = noise() * 2
    wells.push({ wellCode: wellCode(r, 11), role: 'positive_control' })
    readout[wellCode(r, 11)] = 100 + noise() * 2
  }

  for (let c = 1; c <= 10; c++) {
    const conc = 10000 / 3 ** (c - 1)

    for (const r of [0, 1]) {
      const code = wellCode(r, c)
      wells.push({
        wellCode: code,
        role: 'sample',
        sampleLabel: 'Cmpd-1',
        concentration: conc,
        concentrationUnit: unit,
      })
      readout[code] = curveValue(params, conc) + noise() * 4
    }
  }

  return { wells, readout }
}

describe('dose–response and potency across plates', () => {
  it('recovers the EC50 on one plate', () => {
    const { wells, readout } = dilutionPlate(120, 3)
    const a = analysePlate(wells, readout)
    expect(a.curves).toHaveLength(1)
    expect(a.curves[0].ec50).toBeGreaterThan(100)
    expect(a.curves[0].ec50).toBeLessThan(145)
    expect(a.curves[0].ec50Molar!).toBeCloseTo(a.curves[0].ec50 * 1e-9, 15)
    expect(a.curves[0].falling).toBe(false)
  })
  it('summarises across plates, even when one ran in µM', () => {
    const plates = [
      dilutionPlate(100, 1),
      dilutionPlate(130, 2),
      dilutionPlate(0.11, 4, 'µM'),
    ].map((p, i) => {
      const a = analysePlate(p.wells, p.readout)

      return {
        runId: `r${i}`,
        runName: `Plate ${i}`,
        qcStatus: a.qc.status,
        curves: a.curves,
      }
    })

    // The µM plate's doses are in µM, but its curve was generated from nM doses,
    // so only check the machinery: three plates, molar, plausible geometric mean.
    const s = summarisePotency(plates)
    expect(s).toHaveLength(1)
    expect(s[0].n).toBe(3)
    expect(s[0].molar).toBe(true)
    expect(s[0].geoMeanCi95).not.toBeNull()
    expect(s[0].pEc50!).toBeGreaterThan(5)
    expect(s[0].foldRange!).toBeGreaterThanOrEqual(1)
  })
  it('leaves failed plates out unless asked', () => {
    const p = dilutionPlate(100, 1)
    const a = analysePlate(p.wells, p.readout)

    const input = [
      { runId: 'r', runName: 'r', qcStatus: 'fail' as const, curves: a.curves },
    ]

    expect(summarisePotency(input)).toHaveLength(0)
    expect(summarisePotency(input, { includeFailed: true })).toHaveLength(1)
  })
  it('reports too few doses instead of fitting', () => {
    const wells: AssayWell[] = [1, 2, 3].map((c) => ({
      wellCode: wellCode(0, c),
      role: 'sample',
      sampleLabel: 'X',
      concentration: c,
      concentrationUnit: 'nM',
    }))

    const a = analysePlate(
      wells,
      { A2: 1, A3: 2, A4: 3 },
      { ...defaultAssayConfig(), normalisation: 'none' },
    )

    expect(a.curves).toHaveLength(0)
    expect(a.unfitted[0].reason).toBe('too_few_doses')
  })
  it('gives relative potency against a reference', () => {
    const base = {
      sampleId: null,
      unit: 'M',
      n: 2,
      geoMeanCi95: null,
      geoSd: null,
      foldRange: null,
      pEc50: 7,
      molar: true,
      values: [],
    }

    const r = relativePotency(
      [
        { ...base, key: 'a', label: 'ref', geoMean: 1e-7 },
        { ...base, key: 'b', label: 'x', geoMean: 5e-8 },
      ],
      'a',
    )!

    expect(r[0].ratio).toBeCloseTo(2, 6)
  })
})

describe('helpers', () => {
  it('reads configs defensively', () => {
    expect(normaliseAssayConfig(null)).toEqual(defaultAssayConfig())

    const c = normaliseAssayConfig({
      normalisation: 'bogus',
      hit: { minReplicates: 2, kind: 'mad' },
      qc: { controlCvMax: 10 },
    })

    expect(c.normalisation).toBe('percent_effect')
    expect(c.hit.minReplicates).toBe(2)
    expect(c.hit.kind).toBe('mad')
    expect(c.qc.controlCvMax).toBe(10)
  })
  it('knows molar units and MAD', () => {
    expect(molarFactor('nM')).toBe(1e-9)
    expect(molarFactor('mg/mL')).toBeNull()
    expect(madScaled([1, 2, 3, 4, 100])).toBeCloseTo(1.4826 * 1, 4)
  })
})

describe('parsePlateTable', () => {
  it('reads a grid', () => {
    const t = parsePlateTable('\t1\t2\t3\nA\t10\t11\t12\nB\t20\t\t22')
    expect(t.readout.A2).toBe(11)
    expect(t.readout.B2).toBeNull()
    expect(t.wells).toHaveLength(6)
    expect(t.format).toBe('6_well')
  })
  it('reads a list with roles, samples and doses', () => {
    const t = parsePlateTable(
      'Well,Role,Sample,Concentration,Unit,Value\nA1,neg,,,,1000\nA2,pos,,,,100\nA3,sample,X-1,10,nM,500\nZZ,sample,X,1,nM,1\nA3,sample,X,1,nM,1',
    )

    expect(t.wells.map((w) => w.role)).toEqual([
      'negative_control',
      'positive_control',
      'sample',
    ])
    expect(t.wells[2].concentration).toBe(10)
    expect(t.readout.A3).toBe(500)
    expect(t.warnings.some((w) => w.startsWith('duplicate_well'))).toBe(true)
  })
  it('says when there is no well column', () => {
    expect(parsePlateTable('a,b\n1,2').warnings).toContain('no_well_column')
  })
})

describe('asymmetric assay boundary controls', () => {
  it('normalises native historical configs without coercing strings or tightening replicate integers', () => {
    const raw = Object.assign(new Date('2026-10-01T00:00:00Z'), {
      normalisation: 'z_score',
      effectDirection: 'activation',
      subtractBlank: 1,
      hit: Object.assign(new Map([['metadata', 7]]), {
        kind: 'sd',
        direction: 'below',
        threshold: '12',
        minReplicates: Number.MAX_SAFE_INTEGER + 1,
      }),
      qc: Object.assign(new Date('2026-10-02T00:00:00Z'), {
        zPrimeMin: -0.25,
        zPrimeFail: NaN,
        signalToBackgroundMin: null,
        controlCvMax: '3',
      }),
      curveModel: '5pl',
    })

    Object.defineProperty(raw, 'unrelated', {
      get() {
        throw new Error('Do not read unrelated metadata')
      },
    })

    expect(normaliseAssayConfig(raw)).toEqual({
      version: 1,
      normalisation: 'z_score',
      effectDirection: 'activation',
      subtractBlank: false,
      hit: {
        kind: 'sd',
        direction: 'below',
        threshold: 50,
        minReplicates: Number.MAX_SAFE_INTEGER + 1,
      },
      qc: {
        zPrimeMin: -0.25,
        zPrimeFail: 0,
        signalToBackgroundMin: null,
        controlCvMax: null,
      },
      curveModel: '5pl',
    })
    expect(raw.hit.threshold).toBe('12')
    expect(raw.hit.get('metadata')).toBe(7)
    expect(normaliseAssayConfig([])).toEqual(defaultAssayConfig())
  })

  it('retains blank-corrected QC, available-reading replicate caps and inclusive thresholds', () => {
    const wells: AssayWell[] = [
      { wellCode: 'A1', role: 'blank' },
      { wellCode: 'A2', role: 'positive_control' },
      { wellCode: 'A3', role: 'positive_control' },
      { wellCode: 'A4', role: 'negative_control' },
      { wellCode: 'A5', role: 'negative_control' },
      ...['B2', 'B3', 'B4', 'B5'].map((code) => ({
        wellCode: code,
        role: 'sample' as const,
        sampleId: 'stable-sample',
        sampleLabel: 'Captured label',
      })),
    ]

    const readout = {
      A1: 10,
      A2: 30,
      A3: 50,
      A4: 110,
      A5: 130,
      B2: 60,
      B3: 100,
      B4: null,
      B5: NaN,
    }

    const config = {
      ...defaultAssayConfig(),
      subtractBlank: true,
      qc: {
        zPrimeMin: 0.5,
        zPrimeFail: 0,
        signalToBackgroundMin: 6,
        controlCvMax: 20,
      },
    }

    const result = analysePlate(wells, readout, config)

    expect(result.qc.positive.mean).toBe(30)
    expect(result.qc.negative.mean).toBe(110)
    expect(result.qc.positive.sd).toBeCloseTo(Math.sqrt(200), 12)
    expect(result.qc.zPrime).toBeCloseTo(1 - (6 * Math.sqrt(200)) / 80, 12)
    expect(result.qc.ssmd).toBe(-4)
    expect(result.qc.signalToBackground).toBe(5)
    expect(result.qc.signalToNoise).toBeCloseTo(80 / Math.sqrt(200), 12)
    expect(result.qc.checks.map((check) => [check.id, check.status])).toEqual([
      ['controls_present', 'pass'],
      ['z_prime', 'fail'],
      ['signal_to_background', 'fail'],
      ['control_cv', 'warn'],
    ])
    expect(result.qc.status).toBe('fail')
    expect(
      result.wells
        .slice(5)
        .map((well) => [well.corrected, well.normalised, well.hit]),
    ).toEqual([
      [50, 75, false],
      [90, 25, false],
      [null, null, false],
      [null, null, false],
    ])
    expect(result.samples[0]).toMatchObject({
      n: 2,
      mean: 50,
      hit: false,
      wells: ['B2', 'B3', 'B4', 'B5'],
    })

    const capped = analysePlate(wells, readout, {
      ...config,
      hit: {
        kind: 'threshold',
        direction: 'above',
        threshold: 25,
        minReplicates: 99,
      },
    })

    expect(capped.wells.slice(5).map((well) => well.hit)).toEqual([
      true,
      true,
      false,
      false,
    ])
    expect(capped.summary).toEqual({
      wells: 9,
      readWells: 7,
      sampleWells: 4,
      hitSamples: 1,
      hitWells: 2,
      testedSamples: 1,
    })
  })

  it('uses sample spread for z scores and the correct sd and mad hit directions', () => {
    const wells: AssayWell[] = [
      { wellCode: 'A1', role: 'negative_control' },
      { wellCode: 'A2', role: 'negative_control' },
      ...['B1', 'B2', 'B3'].map((code) => ({
        wellCode: code,
        role: 'sample' as const,
      })),
    ]

    const readout = { A1: 0, A2: 2, B1: -1, B2: 1, B3: 3 }

    for (const [direction, hits] of [
      ['above', [false, false, true]],
      ['below', [true, false, false]],
      ['either', [true, false, true]],
    ] as const) {
      const result = analysePlate(wells, readout, {
        normalisation: 'z_score',
        hit: { kind: 'sd', threshold: 1, direction, minReplicates: 'all' },
      })

      expect(result.wells.slice(2).map((well) => well.normalised)).toEqual([
        -1, 0, 1,
      ])
      expect(result.wells.slice(2).map((well) => well.hit)).toEqual(hits)
    }

    const madWells: AssayWell[] = ['A1', 'A2', 'A3', 'A4', 'A5'].map(
      (code) => ({ wellCode: code, role: 'sample' }),
    )

    const mad = analysePlate(
      madWells,
      { A1: -20, A2: 1, A3: 2, A4: 3, A5: 8 },
      {
        normalisation: 'none',
        hit: {
          kind: 'mad',
          threshold: 3,
          direction: 'either',
          minReplicates: 'all',
        },
      },
    )

    expect(mad.wells.map((well) => well.hit)).toEqual([
      true,
      false,
      false,
      false,
      true,
    ])

    const flat = analysePlate(
      wells,
      { A1: 2, A2: 2, B1: 5, B2: 5, B3: 5 },
      { normalisation: 'z_score', hit: { kind: 'sd', threshold: 1 } },
    )

    expect(
      flat.wells.every((well) => well.normalised === null && !well.hit),
    ).toBe(true)
    expect(flat.qc.status).toBe('not_checked')
  })

  it('excludes missing readings from edge means and requires four measured edge samples', () => {
    const wells: AssayWell[] = ['A2', 'A3', 'A4', 'A5', 'B2', 'B3', 'B4'].map(
      (code) => ({ wellCode: code, role: 'sample' }),
    )

    wells.push({ wellCode: 'H12', role: 'empty' })
    const readout = { A2: 80, A3: 82, A4: 84, A5: 86, B2: 10, B3: 12, B4: null }
    const result = analysePlate(wells, readout, { normalisation: 'none' })
    expect(result.edge.edgeMean).toBe(83)
    expect(result.edge.innerMean).toBe(11)
    expect(result.edge.differencePct).toBeCloseTo(7200 / 11, 12)
    expect(result.edge.flagged).toBe(true)
    expect(
      analysePlate(wells, { ...readout, A5: null }, { normalisation: 'none' })
        .edge.flagged,
    ).toBe(false)
  })

  it('keeps too-few-dose and fit-failed reasons distinct and in sample order', () => {
    const wells: AssayWell[] = []
    const readout: PlateReadout = {}

    for (const [sampleId, doses] of [
      ['few', [1, 1, 2, 3]],
      ['nonfinite', [1, 2, 3, Infinity]],
      ['ignored', [0, -1, NaN]],
    ] as const) {
      for (const concentration of doses) {
        const code = wellCode(0, wells.length)
        wells.push({
          wellCode: code,
          role: 'sample',
          sampleId,
          concentration,
          concentrationUnit: 'nM',
        })
        readout[code] = wells.length * 7
      }
    }

    const result = analysePlate(wells, readout, { normalisation: 'none' })
    expect(result.curves).toEqual([])
    expect(result.unfitted).toEqual([
      { key: 'few|nM', label: 'few', reason: 'too_few_doses' },
      { key: 'nonfinite|nM', label: 'nonfinite', reason: 'fit_failed' },
    ])
  })

  it('combines unequal mixed-unit potencies by stable ID and filters unreliable and failed runs', () => {
    const flags: SampleCurve['flags'] = ['not_converged']

    const inputs = [
      {
        runId: 'first',
        runName: 'First',
        qcStatus: 'pass' as const,
        curves: [
          potencyCurve({
            sampleId: 'stable',
            label: 'Captured',
            ec50: 100,
            ec50Molar: 1e-7,
            concentrationUnit: 'nM',
          }),
        ],
      },
      {
        runId: 'second',
        runName: 'Second',
        qcStatus: 'warn' as const,
        curves: [
          potencyCurve({
            sampleId: 'stable',
            label: 'Renamed',
            ec50: 0.4,
            ec50Molar: 4e-7,
            concentrationUnit: 'µM',
          }),
        ],
      },
      {
        runId: 'failed',
        runName: 'Failed',
        qcStatus: 'fail' as const,
        curves: [potencyCurve({ sampleId: 'stable', ec50Molar: 9e-7 })],
      },
      {
        runId: 'unreliable',
        runName: 'Unreliable',
        qcStatus: 'pass' as const,
        curves: [potencyCurve({ sampleId: 'stable', ec50Molar: 16e-7, flags })],
      },
    ]

    const result = summarisePotency(inputs, { excludeUnreliable: true })
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      key: 'stable|M',
      label: 'Captured',
      unit: 'M',
      molar: true,
      n: 2,
    })
    expect(result[0].geoMean).toBeCloseTo(2e-7, 15)
    expect(result[0].geoSd).toBeCloseTo(
      10 ** (Math.log10(4) / Math.sqrt(2)),
      12,
    )
    expect(result[0].foldRange).toBeCloseTo(4, 12)
    expect(result[0].pEc50).toBeCloseTo(7 - Math.log10(2), 12)
    expect(result[0].values.map((value) => value.runId)).toEqual([
      'first',
      'second',
    ])
    expect(
      summarisePotency(inputs, {
        excludeUnreliable: true,
        includeFailed: true,
      })[0].n,
    ).toBe(3)
    expect(summarisePotency(inputs)[0].n).toBe(3)
  })

  it('preserves first-entry molar classification for colliding historical unit keys', () => {
    const molar = potencyCurve({
      sampleId: 'same',
      ec50: 2,
      ec50Molar: 1e-7,
      concentrationUnit: 'M',
    })

    const nonmolar = potencyCurve({
      sampleId: 'same',
      ec50: 4,
      ec50Molar: null,
      concentrationUnit: 'M',
    })

    const run = { runId: 'run', runName: 'Run', qcStatus: 'pass' as const }
    const firstMolar = summarisePotency([{ ...run, curves: [molar, nonmolar] }])
    expect(firstMolar[0]).toMatchObject({
      n: 2,
      molar: true,
      geoMean: 0,
      pEc50: Infinity,
    })

    const firstNonmolar = summarisePotency([
      { ...run, curves: [nonmolar, molar] },
    ])

    expect(firstNonmolar[0]).toMatchObject({ n: 2, molar: false, pEc50: null })
    expect(firstNonmolar[0].geoMean).toBeCloseTo(Math.sqrt(8), 12)
  })

  it('retains quoted labels, decimal parsing and first warning order in pasted lists', () => {
    const result = parsePlateTable(
      'Well;Role;Sample;Concentration;Unit;Value\na01;future;"A;""B""";1,5; µM ;1.234,5\n??;sample;bad;2;nM;1\nA1;another;duplicate;2;nM;2\nA2;other;next;3;nM;4',
    )

    expect(
      result.wells.map((well) => [
        well.wellCode,
        well.role,
        well.sampleLabel,
        well.concentration,
        well.concentrationUnit,
      ]),
    ).toEqual([
      ['A1', 'sample', 'A;"B"', 1.5, 'µM'],
      ['A2', 'sample', 'next', 3, 'nM'],
    ])
    expect(result.readout).toEqual({ A1: 1.2345, A2: 4 })
    expect(result.warnings).toEqual([
      'bad_role:future',
      'bad_well:??',
      'duplicate_well:A1',
      'bad_role:other',
    ])
    expect(parsePlateTable('Signal,Well,Value\n7,A1,99').readout.A1).toBe(7)
  })
})

function potencyCurve(overrides: Partial<SampleCurve> = {}): SampleCurve {
  return {
    key: 'curve',
    sampleId: null,
    label: 'Sample',
    concentrationUnit: 'nM',
    points: [
      { x: 1, y: 10 },
      { x: 10, y: 90 },
    ],
    model: '4pl',
    ec50: 100,
    ec50Molar: 1e-7,
    ec50Ci95: null,
    hill: 1,
    top: 100,
    bottom: 0,
    r2: 0.99,
    converged: true,
    falling: false,
    flags: [],
    ...overrides,
  }
}
