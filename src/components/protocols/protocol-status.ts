/**
 * The status vocabulary the protocols registry and the protocol page render
 * (ADR-0011's component). Data rather than markup, so both screens paint a
 * protocol status the same way.
 */
import { t } from '#/copy'

import type { Tone } from '#/components/ui/status'

/** How a protocol status is painted and named. */
export interface ProtocolStatus {
  tone: Tone
  label: string
}

export function protocolStatus(status: string): ProtocolStatus {
  switch (status) {
    case 'active':
      return {
        tone: 'ok',
        label: t('library.protocols.protocolsRegistryGrid.active'),
      }
    case 'under_review':
      return {
        tone: 'review',
        label: t('library.protocols.protocolsRegistryGrid.inReview'),
      }
    case 'draft':
      return {
        tone: 'draft',
        label: t('library.protocols.protocolsRegistryGrid.draft'),
      }
    case 'archived':
      return {
        tone: 'stored',
        label: t('library.protocols.protocolsRegistryGrid.archived'),
      }
    default:
      return {
        tone: 'none',
        label:
          status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' '),
      }
  }
}
