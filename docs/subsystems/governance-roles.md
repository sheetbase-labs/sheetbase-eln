# Workspace roles and capabilities (GOV-01)

PostgreSQL `api.has_capability` is authoritative. The TypeScript mirror in
`src/lib/capability.ts` is for UI gating only.

## Viewer is read-only

Workspace role `viewer` cannot:

- `record.create`
- `record.link`
- `instance.upgrade`
- `schema.edit` / `schema.publish` / `schema.retire`
- `workspace.admin`

Existing `viewer` memberships are **not** rewritten to another role. They stay
`viewer` and lose mutate capabilities after migrations `0111_gov_01_viewer_readonly`
and `0112_gov_01_viewer_write_enforcement`.

Write RLS on records, blocks, Datasets and related tables requires
`api.is_workspace_writer` (`record.create`) or `record.link` for
`record_links`. `FOR ALL` membership policies are split so SELECT stays
membership-based. Storage/ops write policies that used
`storage_member_using` now use `is_workspace_writer`; their companion
SELECT policies are unchanged.

Data-plane mutation RPCs that previously authorised any workspace member
now call `is_workspace_writer`. Migration `0112` aborts if any
authenticated write policy or authenticated mutation RPC still uses a
1-arg membership / `storage_member_using` write gate. Inventory functions
`internal.gov01_authenticated_write_policy_violations` and
`internal.gov01_authenticated_mutation_rpc_violations` are the audit
surface. Owner-row write policies (for example analysis views keyed only
by `owner_user_id`) also require `is_workspace_writer`, so a member
demoted to viewer cannot keep mutating their own rows.

Owner-gated administration and `api_client` policies are unchanged.

Project access level `viewer` (per-project ACL) is a separate concept from the
workspace role.

## Unused labels that remain member-class

These invitation labels exist and currently share **Member** data capabilities
(create/link/upgrade). They do **not** receive schema publish or workspace admin:

| Role        | Meaning today                                                                                        |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| `scientist` | Member-class scientific work                                                                         |
| `analyst`   | Member-class scientific work                                                                         |
| `reviewer`  | Member-class scientific work. Review assignment on a revision is independent of this workspace role. |

Do not treat these labels as a custom RBAC language. Splitting them into distinct
capability sets is later GOV work if product requires it.

## Steward vs admin

`schema.edit` and `schema.publish` are both granted to owner, admin and steward.
The database still uses separate capability names (trigger split). That is not a
two-person control.

## Dataset schema publication approval

General settings at `/settings/` expose `publication_approval_required`.
Only an unsuspended owner or admin in the active workspace can change this
policy through `update_workspace_publication_policy`. It defaults to `false`.

When enabled, `publish_dataset_schema_version` requires the latest request to
be approved for the draft's current revision. When disabled, a draft with no
request retains direct publication. Existing requests still gate publication:
pending requests lock field replacement and draft deletion, and returned or
withdrawn requests cannot reuse an older approval. Field replacement increments
the draft revision, so an approval cannot authorise later edits.

`submit_approval_request` validates a dataset schema version's workspace,
draft lifecycle and optional expected revision, then records the current
revision. Approver roles, approval counts, independence and decision history
remain enforced by the existing approval RPCs. Publication still requires
`schema.publish`. Dataset evolution and dataset-targeted promotions call the
same publication RPC and cannot bypass this policy.

This policy governs canonical dataset schema versions, not the legacy
SCI-010 schema system or unrelated sheet, template and pipeline publication.
Workspace Record Models currently have no version-publication RPC. Their
versioned approval workflow remains an unmet MDL requirement; dataset schema
approval does not establish that exit.

## External API

External credentials (`api_client`) do not use workspace `viewer`. Their allowlist
is independent (`docs/api/external-api.md`). Session `viewer` users talking to
`/api/db` with a cookie are bound by `has_capability` like any other member.
