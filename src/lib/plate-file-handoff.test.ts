import { describe, expect, it } from 'vitest'

import { stashPlateFile, takePlateFile } from './plate-file-handoff'

describe('plate file hand-off', () => {
  it('gives a stashed file once', () => {
    const file = new File(['a'], 'plate.csv')

    stashPlateFile(file)

    expect(takePlateFile()).toBe(file)
    expect(takePlateFile()).toBeNull()
  })
})
