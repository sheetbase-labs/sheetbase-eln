import { describe, expect, it } from 'vitest'

import {
  boxes,
  checklistChanges,
  isBlocked,
  loadItems,
  staleFiles
  
} from '../../docs/knowledge/roadmap-4/tools/tracker'
import type {Item} from '../../docs/knowledge/roadmap-4/tools/tracker';

const item = (
  id: string,
  status: Item['status'],
  related: string[] = [],
): Item => ({
  id,
  type: 'task',
  title: `${id} title`,
  status,
  priority: 'high',
  related,
  tags: [id],
})

describe('Roadmap 4 tracker', () => {
  it('keeps CHECKLIST.md and NEXT.md in step with .nod (run pnpm roadmap:sync)', async () => {
    expect(await staleFiles()).toEqual([])
  })

  it('has one task file per roadmap task and every task under a stream', () => {
    const items = loadItems()
    const tasks = items.filter((i) => i.type === 'task')
    const epics = new Set(
      items.filter((i) => i.type === 'epic').map((i) => i.id),
    )
    expect(tasks).toHaveLength(86)
    expect(tasks.every((t) => t.parent && epics.has(t.parent))).toBe(true)
  })

  it('reads ticked and unticked boxes by nod id', () => {
    const md = '- [x] **A-01** one `task-1`\n  - [ ] A-01.1 step `subtask-2`\n'
    expect(boxes(md)).toEqual(
      new Map([
        ['task-1', true],
        ['subtask-2', false],
      ]),
    )
  })

  it('applies a newly ticked box and a newly unticked box', () => {
    const items = [item('task-1', 'todo'), item('task-2', 'done')]
    const now = new Map([
      ['task-1', true],
      ['task-2', false],
    ])
    expect(
      checklistChanges(items, now, { 'task-1': false, 'task-2': true }),
    ).toEqual([
      { id: 'task-1', status: 'done' },
      { id: 'task-2', status: 'todo' },
    ])
  })

  it('lets nod win when a box has not changed since the last sync', () => {
    const items = [item('task-1', 'todo')]
    expect(
      checklistChanges(items, new Map([['task-1', true]]), { 'task-1': true }),
    ).toEqual([])
  })

  it('treats a task as blocked until everything it waits on is done', () => {
    const items = [item('task-1', 'todo'), item('task-2', 'todo', ['task-1'])]
    expect(isBlocked(items[1], items)).toBe(true)
    items[0].status = 'done'
    expect(isBlocked(items[1], items)).toBe(false)
  })
})
