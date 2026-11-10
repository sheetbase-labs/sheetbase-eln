/**
 * Home's first-run checklist and its degraded-section reporting, kept out of
 * the route module so the route exports its component and nothing else.
 */
import type { UseQueryResult } from '@tanstack/react-query'

import { t } from '#/copy'

export interface FirstRunProject {
  id: string
  title: string
  accessLevel: string
}

export interface FirstRunInput {
  workspaceName: string
  accountHint?: string
  signatureCertified: boolean
  projects: FirstRunProject[]
  hasOpenedProject: boolean
  hasExperiment: boolean
  /** The person's workspace role. Unset reads as an author. */
  role?: string
  /** How many people are in the workspace; a founder starts alone. */
  memberCount?: number
  /** Whether the first admin finished the short setup; unset hides the step. */
  setupDone?: boolean
}

export interface FirstRunStep {
  label: string
  hint: string
  done: boolean
  actionLabel?: string
  actionTo?: string
}

/**
 * First-run checklist, matching HomeFirstRun: account created, signature,
 * first project and first experiment. Every item reads real state passed in by
 * the caller; nothing is persisted for the checklist itself.
 */
export function firstRunSteps(input: FirstRunInput): FirstRunStep[] {
  const project = input.projects.at(0)
  // An owner or administrator is the one who adds people and starts the first
  // project; nobody is going to add them, so their checklist says to do it.
  const administers = input.role === 'owner' || input.role === 'admin'
  const readOnly = input.role === 'viewer' || input.role === 'client_viewer'
  const reviewOnly = input.role === 'reviewer'

  const steps: FirstRunStep[] = [
    {
      label: t('projects.home.firstRun.accountCreated'),
      hint:
        input.accountHint ??
        t('projects.home.firstRun.joined', { workspace: input.workspaceName }),
      done: true,
    },
    ...(input.role === 'owner' && input.setupDone !== undefined
      ? [
          {
            label: t('projects.home.firstRun.setup'),
            hint: t('projects.home.firstRun.setupHint'),
            done: input.setupDone,
            actionLabel: t('projects.home.firstRun.setupAction'),
            actionTo: '/?setup=1',
          },
        ]
      : []),
    ...(administers
      ? [
          {
            label: t('projects.home.firstRun.invite'),
            hint: t('projects.home.firstRun.inviteHint'),
            done: (input.memberCount ?? 1) > 1,
            actionLabel: t('projects.home.firstRun.invite'),
            actionTo: '/settings/workspace/members?invite=admin',
          },
        ]
      : []),
    {
      label: t('projects.home.firstRun.signature'),
      hint: administers
        ? t('projects.home.firstRun.signatureHintAdmin')
        : t('projects.home.firstRun.signatureHintMember'),
      done: input.signatureCertified,
      actionLabel: 'Set up signature',
      actionTo: '/settings/account/signature',
    },
    {
      label:
        administers && !project
          ? t('projects.home.firstRun.createFirstProject')
          : t('projects.home.firstRun.openFirstProject'),
      hint: project
        ? t('projects.home.firstRun.addedTo', { title: project.title })
        : administers
          ? t('projects.home.firstRun.projectHintAdmin')
          : t('projects.home.firstRun.projectHintMember'),
      done: input.hasOpenedProject,
      actionLabel: project
        ? t('projects.home.firstRun.openProject')
        : administers
          ? t('projects.home.firstRun.createProject')
          : t('projects.home.firstRun.browseProjects'),
      actionTo: project
        ? `/projects/${project.id}`
        : administers
          ? '/projects?new=true'
          : '/projects',
    },
    {
      label: t('projects.home.firstRun.experiment'),
      hint: t('projects.home.firstRun.experimentHint'),
      done: input.hasExperiment,
      actionLabel: t('projects.home.firstRun.browseProtocols'),
      actionTo: '/protocols',
    },
  ]

  // The checklist asks each role only for what that role can do: a viewer
  // cannot sign or author, and a reviewer reviews what others submit rather
  // than creating experiments, so neither is given a step it cannot finish.
  if (readOnly) {
    return steps.filter(
      (step) =>
        step.actionTo !== '/settings/account/signature' &&
        step.actionTo !== '/protocols',
    )
  }

  if (reviewOnly) {
    return steps.flatMap((step) => {
      if (step.actionTo === '/protocols') return []

      return [
        step.actionTo?.startsWith('/projects')
          ? {
              ...step,
              hint: `${step.hint} ${t('projects.home.firstRun.reviewsArrive')}`,
            }
          : step,
      ]
    })
  }

  return steps
}

export function firstRunProgress(steps: FirstRunStep[]) {
  return { done: steps.filter((step) => step.done).length, total: steps.length }
}

/** The part of a query result Home's degradation reads: whether it failed, and how to run it again. */
export type HomeQueryState = Pick<
  UseQueryResult<unknown>,
  'isError' | 'refetch'
>

/** One Home section, with the reads that back it. */
export interface HomeSection {
  label: string
  queries: HomeQueryState[]
}

/** The sections whose reads failed, each with the reads that back it. */
export function unavailableSections(
  sections: readonly HomeSection[],
): HomeSection[] {
  return sections.filter((section) =>
    section.queries.some((query) => query.isError),
  )
}
