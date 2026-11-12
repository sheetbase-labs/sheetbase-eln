import { describe, expect, it } from 'vitest'

import { readFileFacts } from './version-file-facts'

const FILE = `# Titre trend
pipeline: PL-0021
version: 5
include: [titre_limits]
starts:
  window: 1h
  min_new_rows: 5
parameters:
  titre_floor: { type: number }
inputs:
  previous: { required: true }
steps:
  - id: fit
    remote_job: { queue: hpc-short }
    secret: HPC_SUBMIT_KEY
outputs:
  - { mode: append, dataset_id: DS-0405 }
  - { mode: create, dataset_name: Batches at risk }

`

describe('readFileFacts', () => {
  it('finds what only the file holds, with its lines', () => {
    const facts = readFileFacts(FILE)

    expect(facts.outputs).toEqual({ from: 16, to: 18, count: 2 })
    expect(facts.parameters).toEqual({ from: 8, to: 9, count: 1 })
    expect(facts.include).toMatchObject({
      from: 4,
      to: 4,
      names: ['titre_limits'],
    })
    expect(facts.starts).toEqual({ from: 5, to: 7, count: 2 })
    expect(facts.secrets).toEqual(['HPC_SUBMIT_KEY'])
    expect(facts.headerLines).toBe(11)
    expect(facts.headerKeys).toEqual([
      'pipeline',
      'version',
      'include',
      'starts',
      'parameters',
      'inputs',
    ])
  })

  it('answers for a file with none of it', () => {
    expect(readFileFacts('pipeline: PL-1\nsteps: []\n')).toEqual({
      outputs: undefined,
      parameters: undefined,
      include: undefined,
      starts: undefined,
      secrets: [],
      headerLines: 1,
      headerKeys: ['pipeline'],
    })
  })
})
