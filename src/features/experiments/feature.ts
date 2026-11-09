/**
 * Experiments, reviews, record aliases, formulas and label templates, on the
 * API, MCP, the assistant, pipelines and
 * webhooks. Actions fall into the built-in Experiments, Compliance and other
 * groups on the agent permissions page.
 */
import { EXPERIMENT_LAB_TABLES } from './api-tables'
import { EXPERIMENT_OPERATIONS } from './operations'
import { defineFeature } from '../define'

export const feature = defineFeature({
  name: 'experiments',
  operations: EXPERIMENT_OPERATIONS,
  labTables: EXPERIMENT_LAB_TABLES,
  notExposed: {
    submit_record_revision:
      'Runs only in a signed-in person’s session: the submission records the session it was made in, and may carry the author’s signature. The database refuses a call without a session, which a token never has. Read the result on review_submissions.',
    run_revision_checks:
      'Runs only in a signed-in person’s session, which the check result records; the database refuses a call without one, which a token never has. Read the results on review_check_results.',
    create_amendment:
      'Reopens a signed record in a signed-in person’s session, which the new revision records; the database refuses a call without one, which a token never has.',
    next_record_identifier:
      'Hands out the next identifier of a kind of record and uses it up; record creation calls it, so a caller asking for one would leave gaps in the numbering.',
  },
  // A draft that was never submitted may be deleted behind a confirmation.
  agentMayDelete: ['delete_experiment_draft'],
})
