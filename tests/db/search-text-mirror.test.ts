/**
 * `extractAllStrings` (src/lib/search.ts) is the app's copy of
 * `internal.extract_jsonb_text`, which builds the text the search index is
 * made from. The database is the authority; the app copy feeds previews and
 * tests. Search only sees words, so the two must produce the same words, not
 * the same spacing or key order (jsonb sorts keys by length, objects in
 * JavaScript keep insertion order).
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { extractAllStrings } from '#/lib/search'

import { prepareTestDatabase } from './helpers'

let migrator: Client

const words = (text: string) => text.split(/\s+/).filter(Boolean).sort()

const CASES: [string, unknown][] = [
  ['a plain string', 'hello world'],
  ['null', null],
  ['a number', 42],
  ['a boolean', true],
  ['an empty object', {}],
  ['an object of strings', { a: 'alpha', b: 'beta' }],
  [
    'numbers, booleans and nulls beside strings',
    { n: 1, b: true, z: null, s: 'kept' },
  ],
  [
    'nested objects and arrays',
    { a: { b: ['one', { c: 'two' }] }, d: 'three' },
  ],
  ['an array with scalars', ['x', 1, false, null, 'y']],
  ['empty strings', { a: '', b: 'only' }],
  ['unicode', { a: 'naïve café', b: ['µL', '°C'] }],
]

beforeAll(async () => {
  ;({ migrator } = await prepareTestDatabase())
})

afterAll(async () => {
  await migrator.end()
})

describe('extractAllStrings and internal.extract_jsonb_text', () => {
  it.each(CASES)('find the same words in %s', async (_name, value) => {
    const result = await migrator.query<{ text: string }>(
      'select internal.extract_jsonb_text($1::jsonb) as text',
      [JSON.stringify(value)],
    )

    expect(
      words(extractAllStrings(value)),
      'src/lib/search.ts extractAllStrings and internal.extract_jsonb_text disagree on which words are searchable. Change one to match the other.',
    ).toEqual(words(result.rows[0]?.text ?? ''))
  })
})
