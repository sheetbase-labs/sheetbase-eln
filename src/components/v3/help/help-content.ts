/**
 * Help-centre content. Static copy that ships with the release; the release
 * card and support desk are the only parts read per deployment (`#/lib/help`).
 */
import type { LinkProps } from '@tanstack/react-router'

import type { Tone } from '#/components/v3/ui/status'

export const helpFlow: { tone: Tone; label: string }[] = [
  { tone: 'draft', label: 'Draft' },
  { tone: 'progress', label: 'In progress' },
  { tone: 'review', label: 'In review' },
  { tone: 'ok', label: 'Approved · signed' },
]

export const helpTopics: { label: string; hash?: string; text: string }[] = [
  {
    label: 'Records and their states',
    text: 'What you can change in draft, in review and once signed.',
  },
  {
    label: 'Reviews',
    hash: 'reviews',
    text: 'What reviewers see, and returning with comments.',
  },
  {
    label: 'Signatures',
    hash: 'signatures',
    text: 'Meanings, password at signing, amendments.',
  },
]

export type Guide = {
  id: string
  title: string
  time: string
  steps: string[]
  link: LinkProps
  linkLabel: string
}

export const guides: Guide[] = [
  {
    id: 'signature',
    title: 'Set up your signature',
    time: '2 min',
    steps: [
      'Confirm your printed name',
      'Read the signature statement',
      'Enter your password to certify',
    ],
    link: { to: '/settings/signatures' },
    linkLabel: 'Set up signature',
  },
  {
    id: 'experiment',
    title: 'Start your first experiment',
    time: '5 min',
    steps: [
      'Choose a project and an effective protocol',
      'Pick your reviewer',
      'Write in the notebook; it saves as you go',
    ],
    link: { to: '/experiments/new' },
    linkLabel: 'New experiment',
  },
  {
    id: 'import',
    title: 'Import instrument data',
    time: '4 min',
    steps: [
      'Drop the export file',
      'Match columns to the model’s fields',
      'Check units, then save a snapshot',
    ],
    link: { to: '/import' },
    linkLabel: 'Import data',
  },
]

export type HelpArticle = {
  id: string
  title: string
  section: string
  summary: string
  link: LinkProps
  terms: string
}

export const helpArticles: HelpArticle[] = [
  {
    id: 'records',
    title: 'How records, reviews and signatures work',
    section: 'How records work',
    summary:
      'States, what you can change in each, and what a signature binds to.',
    link: { to: '/help/records' },
    terms:
      'record review signature sign approve return amendment state draft locked revision history',
  },
  {
    id: 'shortcuts',
    title: 'Keyboard shortcuts',
    section: 'Keyboard shortcuts',
    summary: 'Search, lists, notebook and sheets, review.',
    link: { to: '/help/shortcuts' },
    terms: 'keyboard shortcut keys command',
  },
  {
    id: 'signature',
    title: 'Set up your signature',
    section: 'Getting started',
    summary: 'Certify your electronic signature before you can sign records.',
    link: { to: '/settings/signatures' },
    terms: 'signature certify password setup',
  },
  {
    id: 'experiment',
    title: 'Start your first experiment',
    section: 'Getting started',
    summary: 'Project, protocol, reviewer, notebook.',
    link: { to: '/experiments/new' },
    terms: 'experiment new notebook protocol start',
  },
  {
    id: 'import',
    title: 'Import instrument data',
    section: 'Getting started',
    summary: 'Upload, map columns, check units, save a snapshot.',
    link: { to: '/import' },
    terms: 'import upload csv instrument data map columns units',
  },
]
