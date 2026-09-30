import { describe, expect, it } from 'vitest'

import {
  buildTemplateRows,
  latestTemplateVersion,
  publishedTemplateVersion,
  templateLifecycle,
} from './templates-data'
import type {
  NotebookTemplate,
  NotebookTemplateVersion,
} from '#/lib/notebook-template-data'
import type { NotebookTemplateConfiguration } from '#/lib/notebook-template'

function config(placements: number): NotebookTemplateConfiguration {
  return {
    formatVersion: 1,
    parameters: [],
    placements: Array.from({ length: placements }, (_, i) => ({
      id: `00000000-0000-4000-8000-00000000000${i}`,
      kind: 'section_placeholder' as const,
      order: i + 1,
      key: `section_${i}`,
      label: `Section ${i}`,
    })),
  }
}

function template(overrides: Partial<NotebookTemplate> = {}): NotebookTemplate {
  return {
    id: 'tpl-1',
    workspaceId: 'ws-1',
    key: 'clarification',
    name: 'Clarification notebook',
    description: null,
    lifecycle: 'active',
    revision: 1,
    displayId: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    createdByUserId: null,
    ...overrides,
  }
}

function version(
  overrides: Partial<NotebookTemplateVersion> = {},
): NotebookTemplateVersion {
  return {
    id: 'v-1',
    templateId: 'tpl-1',
    version: 1,
    lifecycle: 'published',
    configuration: config(2),
    revision: 1,
    publishedAt: '2026-01-02T00:00:00Z',
    publishedByUserId: null,
    reason: null,
    signedByUserId: null,
    signedMeaning: null,
    signedAt: null,
    retiredAt: null,
    ...overrides,
  }
}

describe('buildTemplateRows', () => {
  it('chooses the latest version, counts sections and in-use records', () => {
    const rows = buildTemplateRows(
      [template()],
      [
        version({ id: 'v-1', version: 1, configuration: config(2) }),
        version({
          id: 'v-2',
          version: 2,
          lifecycle: 'draft',
          publishedAt: null,
          configuration: config(5),
        }),
      ],
      ['v-1', 'v-1', 'v-2'],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].latest?.id).toBe('v-2')
    expect(rows[0].published?.id).toBe('v-1')
    // Sections read from the published version when one exists.
    expect(rows[0].sectionCount).toBe(2)
    expect(rows[0].inUse).toBe(3)
  })

  it('ignores record pins that name another template', () => {
    const rows = buildTemplateRows(
      [template()],
      [version({ id: 'v-1' })],
      ['v-from-another-template'],
    )
    expect(rows[0].inUse).toBe(0)
  })
})

describe('latestTemplateVersion and publishedTemplateVersion', () => {
  it('picks the highest version number', () => {
    const versions = [
      version({ id: 'a', version: 1 }),
      version({ id: 'c', version: 3, lifecycle: 'draft' }),
      version({ id: 'b', version: 2 }),
    ]
    expect(latestTemplateVersion(versions)?.id).toBe('c')
    expect(publishedTemplateVersion(versions)?.id).toBe('b')
  })
})

describe('templateLifecycle', () => {
  it('maps lifecycles to tone and label', () => {
    expect(templateLifecycle('active')).toEqual({ tone: 'ok', label: 'Active' })
    expect(templateLifecycle('draft')).toEqual({
      tone: 'draft',
      label: 'Draft',
    })
    expect(templateLifecycle('retired')).toEqual({
      tone: 'stored',
      label: 'Retired',
    })
  })
})
