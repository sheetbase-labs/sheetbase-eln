/**
 * Gaps with an owner: objects that are still to be opened to the API, MCP,
 * assistant, webhooks, pipelines and the SDKs, one area at a time.
 *
 * Each list belongs to one build thread. The thread that opens an area takes
 * its names out of here in the same PR (the guard fails if a name here is on
 * the allowlist). A list that is empty is deleted. Nothing is added to these
 * lists: a new object ships with its integration or with a real reason in
 * `integration-exemptions.ts`.
 */

/** Every pending name with the reason the guard shows for it. Every area is open now. */
export const PENDING_EXPOSURE: Readonly<Record<string, string>> = {}
