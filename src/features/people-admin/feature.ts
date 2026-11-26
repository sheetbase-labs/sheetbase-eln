/**
 * People and clients from the assistant: send an invitation again, sign
 * someone out, give a member a username, rename or archive a client, and
 * post to a client's portal. The operations are declared elsewhere; this
 * folder holds the cards.
 */
import { defineFeature } from '../define'

export const feature = defineFeature({
  name: 'people-admin',
})
