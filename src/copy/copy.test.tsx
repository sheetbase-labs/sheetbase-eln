import { afterEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { en } from './en'
import { pseudo } from './format'
import { rich, setLocale, t } from './index'
import type { CatalogueTree } from './types'

afterEach(() => setLocale('en'))

function leaves(tree: CatalogueTree, prefix = ''): Array<[string, unknown]> {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' || 'other' in value
      ? [[`${prefix}${key}`, value] as [string, unknown]]
      : leaves(value, `${prefix}${key}.`),
  )
}

describe('t', () => {
  it('reads a message by key', () => {
    expect(t('common.actions.cancel')).toBe('Cancel')
  })

  it('picks the plural form and formats the count', () => {
    expect(t('common.counts.rows', { count: 1 })).toBe('1 row')
    expect(t('common.counts.rows', { count: 1200 })).toBe('1,200 rows')
  })

  it('rejects unknown keys and missing values at compile time', () => {
    // @ts-expect-error not a key
    expect(t('common.actions.nope')).toBe('common.actions.nope')
    // @ts-expect-error count is required
    t('common.counts.rows')
  })

  it('stretches text in the pseudo language', () => {
    setLocale('pseudo')
    const text = t('common.counts.rows', { count: 2 })
    expect(text.startsWith('⟦2 ŕóŵš')).toBe(true)
    expect(text.endsWith('⟧')).toBe(true)
  })
})

describe('rich', () => {
  it('renders tags and element values', () => {
    const html = renderToStaticMarkup(
      <>
        {rich('common.errors.askAdminForAccess', {
          link: (text) => <a href="/settings/members">{text}</a>,
        })}
      </>,
    )
    expect(html).toBe(
      'You don’t have access. An admin can add you in <a href="/settings/members">Settings → Members</a>.',
    )
  })

  it('requires a renderer for every tag', () => {
    // @ts-expect-error link is required
    rich('common.errors.askAdminForAccess', {})
  })
})

describe('pseudo', () => {
  it('keeps placeholders and tags', () => {
    expect(pseudo('Open <link>{name}</link>')).toBe(
      '⟦Óþéñ <link>{name}</link>··⟧',
    )
  })
})

describe('the English catalogue', () => {
  const all = leaves(en)

  it('has no empty messages', () => {
    for (const [key, value] of all) {
      const texts =
        typeof value === 'string' ? [value] : Object.values(value as object)
      for (const text of texts) expect(text, key).not.toBe('')
    }
  })

  it('uses {count} in every plural form', () => {
    for (const [key, value] of all) {
      if (typeof value === 'string') continue
      for (const text of Object.values(value as object)) {
        expect(text, key).toContain('{count}')
      }
    }
  })

  it('closes every tag it opens', () => {
    for (const [key, value] of all) {
      const texts =
        typeof value === 'string' ? [value] : Object.values(value as object)
      for (const text of texts as Array<string>) {
        const open = [...text.matchAll(/<(\w+)>/g)].map((m) => m[1])
        const close = [...text.matchAll(/<\/(\w+)>/g)].map((m) => m[1])
        expect(close, key).toEqual(open)
      }
    }
  })
})
