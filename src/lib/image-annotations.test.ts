import { describe, expect, it } from 'vitest'

import {
  annotationsAreValid,
  readAnnotations,
  sortedLanes,
  withAnnotations,
} from './image-annotations'
import { validateBlock } from './blocks'

const file = {
  fileRecordId: 'r1',
  fileIdentifier: 'FILE-1',
  displayName: 'gel.png',
  mediaType: 'image/png',
  byteSize: 10,
}

describe('image annotations', () => {
  it('keeps well-formed marks and drops malformed ones', () => {
    const marks = readAnnotations({
      annotations: [
        {
          id: 'a',
          kind: 'arrow',
          x1: 0.1,
          y1: 0.2,
          x2: 0.5,
          y2: 0.6,
          color: 'red',
        },
        {
          id: 'b',
          kind: 'label',
          x: 0.5,
          y: 0.5,
          text: '  50 kDa  ',
          color: 'nope',
        },
        { id: 'c', kind: 'lane', x: 2, text: 'out of range' },
        { id: 'd', kind: 'label', x: 0.1, y: 0.1, text: '   ' },
      ],
    })

    expect(marks.map((m) => m.id)).toEqual(['a', 'b'])
    expect(marks[1]).toMatchObject({ text: '50 kDa', color: 'yellow' })
  })

  it('treats a missing list as no marks and a broken list as invalid', () => {
    expect(readAnnotations(file)).toEqual([])
    expect(annotationsAreValid(file)).toBe(true)
    expect(annotationsAreValid({ ...file, annotations: 'x' })).toBe(false)
    expect(
      annotationsAreValid({
        ...file,
        annotations: [{ id: 'z', kind: 'lane', x: 5, text: 'bad' }],
      }),
    ).toBe(false)
  })

  it('sets and clears annotations without touching the file reference', () => {
    const lane = {
      id: 'l',
      kind: 'lane',
      x: 0.3,
      text: 'Ladder',
      color: 'white',
    } as const

    const withMark = withAnnotations(file, [lane])
    expect(withMark).toMatchObject({ ...file, annotations: [lane] })
    expect(withAnnotations(withMark, [])).toEqual(file)
  })

  it('orders lanes left to right', () => {
    const lanes = sortedLanes([
      { id: '2', kind: 'lane', x: 0.7, text: 'B', color: 'white' },
      { id: '1', kind: 'lane', x: 0.2, text: 'A', color: 'white' },
    ])

    expect(lanes.map((l) => l.text)).toEqual(['A', 'B'])
  })

  it('lets a file block carry valid annotations and rejects bad ones', () => {
    const ok = validateBlock({
      type: 'file',
      payload: {
        ...file,
        annotations: [
          { id: 'l', kind: 'lane', x: 0.3, text: 'Ladder', color: 'white' },
        ],
      },
    })

    expect(ok.ok).toBe(true)

    const bad = validateBlock({
      type: 'file',
      payload: { ...file, annotations: [{ id: 'q' }] },
    })

    expect(bad.ok).toBe(false)
    expect(JSON.stringify(bad)).toContain('annotations')
  })
})
