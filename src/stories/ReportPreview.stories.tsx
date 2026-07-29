import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { ReportPreview } from '#/components/report-builder/report-preview'
import type {
  ReportDefinition,
  ReportSection,
  ValidationSummary,
} from '#/lib/report-builder'

const timestamp = '2026-07-29T12:00:00Z'
const report: ReportDefinition = {
  id: 'report',
  workspaceId: 'workspace',
  projectId: null,
  recordId: null,
  templateRecordId: null,
  reviewSubmissionId: null,
  title: 'Protein stability report',
  subtitle: 'Accelerated storage study',
  documentIdentifier: 'RPT-2026-014',
  status: 'draft',
  version: 3,
  lastSavedAt: timestamp,
  createdAt: timestamp,
  updatedAt: timestamp,
  createdByUserId: 'user',
  updatedByUserId: null,
}
const section = (
  id: string,
  title: string,
  position: number,
  validationStatus: ReportSection['validationStatus'],
): ReportSection => ({
  id,
  title,
  position,
  validationStatus,
  workspaceId: 'workspace',
  reportId: 'report',
  description: `Summary of ${title.toLowerCase()}.`,
  sectionType: 'text',
  sourceType: 'revision_block',
  sourceRevisionId:
    validationStatus === 'missing_source' ? null : 'revision-12345678',
  sourceRef: {},
  frozenPayload: { observation: 'No significant change was observed.' },
  validationDetail: {},
  createdAt: timestamp,
  updatedAt: timestamp,
  createdByUserId: 'user',
  updatedByUserId: null,
})
const sections = [
  section('section-1', 'Executive summary', 0, 'valid'),
  section('section-2', 'Results', 1, 'stale'),
]
const validation: ValidationSummary = {
  reportId: 'report',
  sections: 2,
  valid: 1,
  missingSource: 0,
  stale: 1,
  locked: 0,
  ready: false,
}
const meta = {
  title: 'Features/ReportPreview',
  component: ReportPreview,
  tags: ['autodocs'],
  args: { report, sections, validation, generationsChecksum: null },
} satisfies Meta<typeof ReportPreview>
export default meta
type Story = StoryObj<typeof meta>
export const Draft: Story = {}
export const EmptyReport: Story = {
  args: {
    sections: [],
    validation: { ...validation, sections: 0, valid: 0, stale: 0 },
  },
}
export const NoReport: Story = {
  args: { report: null, sections: [], validation: null },
}
