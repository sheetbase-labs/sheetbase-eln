/**
 * What a regulated lab asks of Sheetbase, as plain requirements, each traced to
 * the automated tests that exercise it and to the checks run on a live install.
 *
 * These are statements about what the product does. They are not a claim that
 * the product satisfies any regulation or guideline: that judgement belongs to
 * the lab's own validation team, who use this as an input.
 */
export interface Requirement {
  id: string
  area: string
  statement: string
  /** Checks in checks.server.ts that look at a live install for this. */
  checks: string[]
}

export const REQUIREMENTS: readonly Requirement[] = [
  {
    id: 'VAL-ID-01',
    area: 'Identity',
    statement:
      'Every person signs in with their own account, and sessions end after a period of inactivity that is shorter in a regulated lab.',
    checks: ['oq.session_idle'],
  },
  {
    id: 'VAL-ACC-01',
    area: 'Access',
    statement:
      'A person sees only the workspaces, projects and records their role and project access allow. Another workspace’s data is never readable.',
    checks: ['oq.workspace_isolation'],
  },
  {
    id: 'VAL-AUD-01',
    area: 'Audit trail',
    statement:
      'Changes are recorded in an audit trail that says who changed what and when, and entries cannot be edited or deleted.',
    checks: ['oq.audit_immutable'],
  },
  {
    id: 'VAL-AUD-02',
    area: 'Audit trail',
    statement:
      'Audit entries are chained so that any alteration or removal is detected, and the chain is checked on a schedule.',
    checks: ['oq.audit_chain'],
  },
  {
    id: 'VAL-SIG-01',
    area: 'Signatures',
    statement:
      'A signature is bound to one frozen revision and records the signer, the meaning of the signature, the method of authentication and the time.',
    checks: ['oq.signed_revisions'],
  },
  {
    id: 'VAL-SIG-02',
    area: 'Signatures',
    statement:
      'In a regulated lab a signer’s identity is verified by a different administrator before they can sign, and reviewers cannot sign their own work.',
    checks: ['oq.regulated_settings'],
  },
  {
    id: 'VAL-SIG-03',
    area: 'Signatures',
    statement:
      'A signature cannot be edited or deleted, and an approving signature locks the record so that later changes need an amendment.',
    checks: ['oq.signature_immutable', 'oq.regulated_settings'],
  },
  {
    id: 'VAL-REV-01',
    area: 'Review',
    statement:
      'A submitted revision is immutable evidence, and review decisions and check results are recorded against it.',
    checks: ['oq.signed_revisions'],
  },
  {
    id: 'VAL-CHG-01',
    area: 'Change control',
    statement:
      'In a regulated lab a change to a saved value needs a reason, which is kept in the history.',
    checks: ['oq.regulated_settings'],
  },
  {
    id: 'VAL-EXP-01',
    area: 'Records',
    statement:
      'Records can be exported in a readable form together with checksums that show the export is complete and unchanged.',
    checks: ['oq.export_key'],
  },
  {
    id: 'VAL-EXP-02',
    area: 'Records',
    statement:
      'The whole workspace can be backed up and restored, and a restore is checked against the audit chain.',
    checks: ['iq.migrations'],
  },
  {
    id: 'VAL-TS-01',
    area: 'Time',
    statement:
      'When a time-stamping service is chosen, each signature gets an independent RFC 3161 timestamp that can be checked without Sheetbase.',
    checks: ['oq.timestamps'],
  },
  {
    id: 'VAL-TS-02',
    area: 'Time',
    statement:
      'A signed export bundle can be verified offline with the scripts inside it.',
    checks: ['oq.export_key'],
  },
  {
    id: 'VAL-PRT-01',
    area: 'Procedures',
    statement:
      'Controlled protocols track who is trained on which version and who has acknowledged a change.',
    checks: [],
  },
  {
    id: 'VAL-IQ-01',
    area: 'Installation',
    statement:
      'The installed application, database schema and supporting services are the ones the release was built for, and the server clock agrees with the database.',
    checks: [
      'iq.migrations',
      'iq.database',
      'iq.roles',
      'iq.postgrest',
      'iq.clock',
      'iq.address',
    ],
  },
]

export function requirementById(id: string): Requirement | undefined {
  return REQUIREMENTS.find((r) => r.id === id)
}
