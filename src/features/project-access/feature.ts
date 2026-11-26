/**
 * Who can reach a project, from the assistant: add or remove a person, set a
 * person's or group's permissions, choose the quality group that can view
 * every project, set a project's review rules, and ask for edit access. The
 * operations themselves are declared elsewhere; this folder holds the cards.
 */
import { defineFeature } from '../define'

export const feature = defineFeature({
  name: 'project-access',
})
