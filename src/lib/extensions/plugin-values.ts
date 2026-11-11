/**
 * The bags a plugin and this app exchange.
 *
 * A plugin declares its own fields — in its manifest, its operation input
 * schema and its screen's context — so no module on this side can name the
 * keys. These aliases are that owner contract: the producer validates the
 * fields it reads (the server against the manifest, the screen against its own
 * declarations), and the transport only carries them.
 */

import { z } from 'zod'

/** The shape every bag has: an object whose keys the plugin itself declares. */
const valueBagSchema = z.record(z.string(), z.unknown())

/** One bag of values a plugin declares or is handed. */
export type PluginValueBag = z.infer<typeof valueBagSchema>

/** One table row handed to, or answered by, a plugin's column or action. */
export type PluginRowBag = PluginValueBag
