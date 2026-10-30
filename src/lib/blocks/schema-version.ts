/**
 * The payload schema version blocks are written with. Kept apart from
 * `./index` so code that only stamps a version does not load every block
 * type's validation and picker text.
 */
export const PAYLOAD_SCHEMA_VERSION = 1 as const
