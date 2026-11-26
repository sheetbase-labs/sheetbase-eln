/**
 * Versioned notebook templates from the assistant: start a notebook from the
 * newest published version of a template, and bring a notebook up to a newer
 * version when nothing needs deciding.
 */
import { defineFeature } from '../define'

export const feature = defineFeature({
  name: 'template-versions',
})
