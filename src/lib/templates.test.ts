/**
 * SCI-006 unit tests: template kind/status helpers, lifecycle transition
 * rules, instantiable-status checks, and target-kind compatibility.
 */
import { describe, expect, it } from 'vitest'

import {
  allowedTemplateTransitions,
  INSTANTIABLE_STATUSES,
  INSTANTIABLE_TARGET_KINDS,
  isAllowedTemplateTransition,
  isInstantiable,
  isTemplateKind,
  TEMPLATE_KIND_LABEL,
  TEMPLATE_KIND_PREFIX,
  TEMPLATE_KINDS,
  TEMPLATE_TRANSITIONS,
} from './templates'

describe('SCI-006 template domain helpers', () => {
  describe('isTemplateKind', () => {
    it.each(['protocol_template', 'notebook_template'])(
      'recognises %s as a template kind',
      (kind) => {
        expect(isTemplateKind(kind)).toBe(true)
      },
    )

    it.each(['experiment', 'sample', 'reagent', 'report', 'file', ''])(
      'rejects %s as a template kind',
      (kind) => {
        expect(isTemplateKind(kind)).toBe(false)
      },
    )
  })

  describe('TEMPLATE constants', () => {
    it('exposes exactly two template kinds', () => {
      expect(TEMPLATE_KINDS).toEqual(['protocol_template', 'notebook_template'])
    })

    it('maps each kind to a stable prefix and label', () => {
      expect(TEMPLATE_KIND_PREFIX.protocol_template).toBe('PRT')
      expect(TEMPLATE_KIND_PREFIX.notebook_template).toBe('NBK')
      expect(TEMPLATE_KIND_LABEL.protocol_template).toBe('Protocol')
      expect(TEMPLATE_KIND_LABEL.notebook_template).toBe('Notebook')
    })
  })

  describe('isInstantiable', () => {
    it('allows active protocol templates that are not archived', () => {
      expect(isInstantiable('protocol_template', 'active', null)).toBe(true)
    })

    it('allows validated notebook templates that are not archived', () => {
      expect(isInstantiable('notebook_template', 'validated', null)).toBe(true)
    })

    it('rejects draft templates', () => {
      expect(isInstantiable('protocol_template', 'draft', null)).toBe(false)
      expect(isInstantiable('notebook_template', 'draft', null)).toBe(false)
    })

    it('rejects archived templates regardless of status', () => {
      expect(
        isInstantiable('protocol_template', 'active', '2026-01-01T00:00:00Z'),
      ).toBe(false)
      expect(
        isInstantiable(
          'notebook_template',
          'validated',
          '2026-01-01T00:00:00Z',
        ),
      ).toBe(false)
    })

    it('rejects under_review protocol templates', () => {
      expect(isInstantiable('protocol_template', 'under_review', null)).toBe(
        false,
      )
    })
  })

  describe('lifecycle transitions', () => {
    it('allows notebook_template draft → validated', () => {
      expect(
        isAllowedTemplateTransition('notebook_template', 'draft', 'validated'),
      ).toBe(true)
    })

    it('allows notebook_template validated → draft', () => {
      expect(
        isAllowedTemplateTransition('notebook_template', 'validated', 'draft'),
      ).toBe(true)
    })

    it('allows protocol_template draft → active and draft → under_review', () => {
      expect(
        isAllowedTemplateTransition('protocol_template', 'draft', 'active'),
      ).toBe(true)
      expect(
        isAllowedTemplateTransition(
          'protocol_template',
          'draft',
          'under_review',
        ),
      ).toBe(true)
    })

    it('rejects notebook_template draft → active (not a notebook status)', () => {
      expect(
        isAllowedTemplateTransition('notebook_template', 'draft', 'active'),
      ).toBe(false)
    })

    it('rejects protocol_template draft → validated (not a protocol status)', () => {
      expect(
        isAllowedTemplateTransition('protocol_template', 'draft', 'validated'),
      ).toBe(false)
    })

    it('returns an empty array for an unknown source status', () => {
      expect(
        allowedTemplateTransitions('notebook_template', 'archived'),
      ).toEqual([])
    })

    it('defines a complete transition matrix for both kinds', () => {
      expect(TEMPLATE_TRANSITIONS.notebook_template).toEqual({
        draft: ['validated'],
        validated: ['draft'],
      })
      expect(TEMPLATE_TRANSITIONS.protocol_template.draft).toContain('active')
    })
  })

  describe('instantiable statuses and target kinds', () => {
    it('only allows active for protocol templates', () => {
      expect(INSTANTIABLE_STATUSES.protocol_template).toEqual(['active'])
    })

    it('only allows validated for notebook templates', () => {
      expect(INSTANTIABLE_STATUSES.notebook_template).toEqual(['validated'])
    })

    it('allows protocol templates to target experiments and protocol templates', () => {
      expect(INSTANTIABLE_TARGET_KINDS.protocol_template).toEqual([
        'experiment',
        'protocol_template',
      ])
    })

    it('allows notebook templates to target only experiments', () => {
      expect(INSTANTIABLE_TARGET_KINDS.notebook_template).toEqual([
        'experiment',
      ])
    })
  })
})
