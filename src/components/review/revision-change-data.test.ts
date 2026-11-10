import { describe, expect, it } from 'vitest'

import { exactText } from './revision-change-data'
import { focusChange } from './review-focus'

describe('frozen change values', () => {
  it('keeps primitive spellings, missing values and native JSON formatting', () => {
    expect(exactText('  1.2300E+06  ')).toBe('  1.2300E+06  ')
    expect(exactText(null)).toBe('null')
    expect(exactText(undefined)).toBe('Not present')
    expect(exactText(NaN)).toBe('NaN')
    expect(exactText(Infinity)).toBe('Infinity')
    expect(exactText(-Infinity)).toBe('-Infinity')
    expect(exactText(17n)).toBe('17')
    expect(exactText(Symbol('source'))).toBe('Symbol(source)')
    expect(exactText(false)).toBe('false')
    expect(exactText([0, 'TU/mL', null])).toBe('[\n  0,\n  "TU/mL",\n  null\n]')
  })

  it('reads native JSON hooks and getters once, retaining native failures', () => {
    const trace: string[] = []

    const value = {
      get toJSON() {
        trace.push('toJSON')

        return () => {
          trace.push('call')

          return {
            get titre() {
              trace.push('titre')

              return '9.5000E+05'
            },
          }
        }
      },
      get unread() {
        throw new Error('must not read substituted fields')
      },
    }

    expect(exactText(value)).toBe('{\n  "titre": "9.5000E+05"\n}')
    expect(trace).toEqual(['toJSON', 'call', 'titre'])
    expect(() => exactText({ value: 1n })).toThrow(TypeError)
    expect(() =>
      exactText({
        toJSON: () => {
          throw new Error('refused')
        },
      }),
    ).toThrow('refused')
    expect(exactText({ toJSON: () => undefined })).toBeUndefined()
  })
})

describe('review location focus', () => {
  it('focuses before the once-only capability read and retains its receiver', () => {
    const target = document.createElement('div')
    target.tabIndex = -1
    document.body.append(target)
    const trace: string[] = []
    target.addEventListener('focus', () => trace.push('focus'))
    Object.defineProperty(target, 'scrollIntoView', {
      configurable: true,
      get() {
        trace.push('capture')

        return function (this: HTMLElement, options: ScrollIntoViewOptions) {
          expect(this).toBe(target)
          expect(options).toEqual({ behavior: 'auto', block: 'nearest' })
          trace.push('scroll')
        }
      },
    })

    try {
      focusChange(target)
      expect(document.activeElement).toBe(target)
      expect(trace).toEqual(['focus', 'capture', 'scroll'])
      Object.defineProperty(target, 'scrollIntoView', { value: false })
      expect(() => focusChange(target)).not.toThrow()
      expect(() => focusChange(undefined)).not.toThrow()
    } finally {
      target.remove()
    }
  })
})
