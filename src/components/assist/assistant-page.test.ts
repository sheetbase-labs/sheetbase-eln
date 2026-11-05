import { describe, expect, it } from 'vitest'

import { pageFromPathname, pageSuggestions } from './assistant-page'

describe('pageFromPathname', () => {
  it('names list pages the way the sidebar does', () => {
    expect(pageFromPathname('/schedule', '?view=week')).toEqual({
      path: '/schedule?view=week',
      title: 'Schedule',
    })
    expect(pageFromPathname('/requests')?.title).toBe('Requests')
    expect(pageFromPathname('/settings/lab/retention')?.title).toBe('Settings')
    expect(pageFromPathname('/')?.title).toBe('Home')
  })

  it('knows nothing of pages it has no name for', () => {
    expect(pageFromPathname('/nowhere')).toBeNull()
  })

  it('suggests booking questions on the schedule', () => {
    expect(pageSuggestions({ path: '/schedule', title: 'Schedule' })).toContain(
      'Book an instrument for me',
    )
  })
})
