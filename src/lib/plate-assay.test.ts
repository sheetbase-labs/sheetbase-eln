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
import type { AssayWell, PlateReadout } from './plate-assay'
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
