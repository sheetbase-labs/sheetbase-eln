/**
 * Submit readiness: what stands between an experiment and its submission, and
 * whether it stops it. Open protocol steps and a missing decision are listed
 * with the other checks (`experiment_readiness`); the workspace chooses
 * whether they only warn or stop the submit, or are not checked at all.
 *
 * The change is sent as `workspace.settings.updated`. The setting is a
 * guardrail, so a person or an admin with Signatures access sets it; tokens
 * can change it too, as for any workspace rule (not pipelines), but the check
 * can never be passed on someone's behalf: submitting and signing stay in the app.
 */
import { defineFeature } from '../define'
import { SUBMIT_READINESS_OPERATIONS } from './operations'

export const feature = defineFeature({
  name: 'submit-readiness',
  operations: SUBMIT_READINESS_OPERATIONS,
})
