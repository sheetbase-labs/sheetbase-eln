import { describe, expect, it } from 'vitest'

import { ASSISTANT_PROPOSE_TOOL_NAMES } from './agent-tool-catalogue'
import {
  PLATE_DESIGN_ARCHIVE_TOOL,
  REPORT_GENERATE_TOOL,
  STUDIES_PROPOSE_TOOL_NAMES,
  STUDY_DELIVERABLE_ADD_TOOL,
  STUDY_TASK_ADD_TOOL,
  STUDY_TASK_UPDATE_TOOL,
  isStudiesAction,
} from './assistant-studies'
import {
  buildStudiesProposal,
  isStudiesProposalTool,
  studiesProposalDefs,
} from './assistant-studies.server'
import type { LabToolContext } from './assistant-lab-tools.server'
import type { DataClient } from './data-client'

const TASK = {
  id: '33333333-3333-4333-8333-333333333333',
  title: 'Submit the stability data',
  status: 'not_started',
  priority: 'medium',
  progress_percent: 0,
  due_at: '2026-12-01T12:00:00Z',
  project_id: '44444444-4444-4444-8444-444444444444',
  metadata_version: 4,
  task_type: 'milestone',
}
const PROJECT = {
  id: TASK.project_id,
  title: 'Stability programme',
  key: 'STAB',
}
const REPORT = {
  id: '55555555-5555-4555-8555-555555555555',
  title: 'Quarterly stability',
  document_identifier: 'RPT-0004',
  status: 'draft',
  version: 3,
}
const DESIGN = {
  id: '66666666-6666-4666-8666-666666666666',
  name: 'Dose response A',
  status: 'draft',
  metadata_version: 2,
}

function context(): LabToolContext {
  const rows: Record<string, unknown[]> = {
    study_tasks: [TASK],
    projects: [PROJECT],
    report_definitions: [REPORT],
    plate_designs: [DESIGN],
  }
  const client = {
    list: (resource: string) => Promise.resolve(rows[resource] ?? []),
  } as unknown as DataClient
  return { client, workspaceId: 'ws-1', userId: 'u', timeZone: 'UTC' }
}

const base = { title: 'Do it', summary: 'What was asked' }

describe('planning and reporting assistant cards', () => {
  it('registers every tool with the agent catalogue and the model', () => {
    for (const name of STUDIES_PROPOSE_TOOL_NAMES) {
      expect(ASSISTANT_PROPOSE_TOOL_NAMES).toContain(name)
      expect(isStudiesProposalTool(name)).toBe(true)
    }
    expect(studiesProposalDefs().map((d) => d.name)).toEqual(
      STUDIES_PROPOSE_TOOL_NAMES.map((n) => n.replaceAll('.', '__')),
    )
  })

  it('proposes a milestone in a named project, due at noon so the day holds', async () => {
    const built = await buildStudiesProposal(
      STUDY_TASK_ADD_TOOL,
      {
        ...base,
        task: 'Sign off the protocol',
        type: 'milestone',
        project: 'stability',
        dueOn: '2026-12-15',
      },
      context(),
    )
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.proposal.action).toMatchObject({
      kind: 'study.task_add',
      workspaceId: 'ws-1',
      title: 'Sign off the protocol',
      taskType: 'milestone',
      projectId: PROJECT.id,
      dueAt: '2026-12-15T12:00:00Z',
    })
    expect(built.proposal.deepLink).toBe(`/projects/${PROJECT.id}/milestones`)
    expect(isStudiesAction(built.proposal.action ?? { kind: '' })).toBe(true)
  })

  it('changes a task and moves its date, with the reason', async () => {
    const built = await buildStudiesProposal(
      STUDY_TASK_UPDATE_TOOL,
      {
        ...base,
        task: 'stability data',
        status: 'in_progress',
        dueOn: '2026-12-08',
        reason: 'The assay was rerun',
      },
      context(),
    )
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.proposal.action).toEqual({
      kind: 'study.task_update',
      taskId: TASK.id,
      expectedMetadataVersion: 4,
      edit: { status: 'in_progress' },
      move: { dueAt: '2026-12-08T12:00:00Z', reason: 'The assay was rerun' },
    })
    expect(built.proposal.changes).toEqual([
      { label: 'Status', before: 'not_started', after: 'in_progress' },
      { label: 'Due', before: '2026-12-01', after: '2026-12-08' },
    ])
  })

  it('will not move a date without a reason, nor change nothing', async () => {
    const noReason = await buildStudiesProposal(
      STUDY_TASK_UPDATE_TOOL,
      { ...base, task: 'stability data', dueOn: '2026-12-08' },
      context(),
    )
    expect(noReason.ok).toBe(false)
    const nothing = await buildStudiesProposal(
      STUDY_TASK_UPDATE_TOOL,
      { ...base, task: 'stability data' },
      context(),
    )
    expect(nothing.ok).toBe(false)
  })

  it('adds a deliverable to the task it finds', async () => {
    const built = await buildStudiesProposal(
      STUDY_DELIVERABLE_ADD_TOOL,
      { ...base, task: 'stability data', name: 'Stability report' },
      context(),
    )
    expect(built.ok && built.proposal.action).toEqual({
      kind: 'study.deliverable_add',
      taskId: TASK.id,
      name: 'Stability report',
      dueAt: null,
    })
  })

  it('generates a report and archives a plate design', async () => {
    const report = await buildStudiesProposal(
      REPORT_GENERATE_TOOL,
      { ...base, report: 'RPT-0004' },
      context(),
    )
    expect(report.ok && report.proposal.action).toEqual({
      kind: 'report.generate',
      workspaceId: 'ws-1',
      reportId: REPORT.id,
    })
    const design = await buildStudiesProposal(
      PLATE_DESIGN_ARCHIVE_TOOL,
      { ...base, design: 'dose response' },
      context(),
    )
    expect(design.ok && design.proposal.action).toEqual({
      kind: 'plate_design.archive',
      designId: DESIGN.id,
      expectedMetadataVersion: 2,
    })
  })

  it('says so when nothing matches, and refuses arguments it does not know', async () => {
    const none = await buildStudiesProposal(
      REPORT_GENERATE_TOOL,
      { ...base, report: 'nothing' },
      {
        ...context(),
        client: { list: () => Promise.resolve([]) } as unknown as DataClient,
      },
    )
    expect(none).toEqual({ ok: false, message: 'No report matches "nothing".' })
    const extra = await buildStudiesProposal(
      PLATE_DESIGN_ARCHIVE_TOOL,
      { ...base, design: 'x', surprise: true },
      context(),
    )
    expect(extra.ok).toBe(false)
  })
})
