# Journeys: settings, access, auth, shell and cross-cutting

Domain: sign-in and session, members and invitations, roles and capabilities,
project access, API credentials, notifications, signatures, audit, usage,
diagnostics, client portal, search, help, shell, offline and sync, comments.

All paths and line numbers are from the working tree on branch
`GWP/instrument-parser-journey` (rooted at `src/`). Every finding comes from
reading the code. Nothing was run in a browser. Where a claim depends on a
database function, the migration is cited.

Role facts used throughout:

- `hasCapability(role, 'workspace.admin')` is true for `owner` only
  (`lib/capability.ts:56-58`). The `admin` role is not an owner.
- `WORKSPACE_ADMIN_ROLES = ['owner', 'admin']` (`lib/nav-visibility.ts:29`)
  decides which settings pages the nav shows (`components/v3/settings/settings-nav.ts:25-85`).
- Invite, role change, suspend and remove are owner-only in SQL
  (`drizzle/0054_admin_001_workspace_admin.sql:136,186,204`).

---

### J-SET-01 Invited person tries to join a workspace

- **Persona / goal:** Owner invites a colleague. The colleague must end up as a member of the owner's workspace.
- **Entry:** Members and roles, "Invite people" button, "Send invitation" (`routes/settings/members.tsx:538-543`, `834-846`).
- **Path:**
  1. Owner submits the invite. `createInvitation` returns `{ invitation, token }` (`lib/workspace-admin.ts:313-333`).
  2. `onSuccess` ignores the result: it invalidates, closes the dialog and toasts "Invitation sent" (`members.tsx:243-247`). The token is discarded. It is never shown, copied or emailed.
  3. No email is sent: `invitation` appears in no email template or delivery code (grep of `lib/email-*.ts`: no match).
  4. The dialog promises "They get a sign-in link from your company sign-in" (`members.tsx:781-784`). No such link exists.
  5. `acceptInvitation` (`lib/workspace-admin.ts:346-351`) has no caller in `src/` outside tests. The only caller of `api.accept_invitation` is the seed (`db/seed/design.ts:6431`).
  6. The invitee signs in with GitHub. The sign-up hook creates a personal workspace with the invitee as owner (`lib/auth.ts:84-96`, `lib/bootstrap.ts:28-74`). They never join the inviter's workspace.
- **Blockers hit:** "Invitation sent" (false), "They get a sign-in link from your company sign-in." The pending row stays on the Members page until it expires (`members.tsx:497`). The invitee lands in an empty workspace where Home says "You joined <their own workspace>" (`routes/index.tsx:586-591`).
- **Verdict:** `dead-end` at step 2. The invitation can never be redeemed from the product. **Fixed in c1d28a44.**
- **Fix:** Show the one-time invite link (token) in the success state with a Copy control, as the credential panel does for secrets. Add an `/accept-invitation?token=` route that calls `accept_invitation` after sign-in. Change the toast and dialog copy to match what is delivered.
- **Severity:** S1. Every multi-person workspace, and every client-portal account (see J-SET-14), depends on it.

### J-SET-02 Sole owner needs to certify an electronic signature

- **Persona / goal:** First user of a fresh workspace wants to sign a record. Home tells them to "Set up your electronic signature" and says it takes about 2 minutes.
- **Entry:** Home first-run checklist, step 2 (`routes/index.tsx:142-147`). Also the sign dialog and review page link to `/settings/signatures` (`components/notebook/sign-notebook-dialog.tsx:212`, `routes/review/$revisionId.tsx:2564`).
- **Path:**
  1. Settings, Electronic signatures: "Confirm your identity" says "Ask a different active owner or administrator to independently confirm your identity and email. A workspace owner cannot verify their own identity." (`routes/settings/signatures.tsx:264`).
  2. "Certify signature" stays disabled until identity is verified. The reason text is "Independent identity verification is required first" (`signatures.tsx:380-394`).
  3. Docs say: "An initial workspace owner receives no self-verification exemption: invite another administrator first." (`docs/operations/authentication.md:76`).
  4. "Invite another administrator" runs into J-SET-01: the invitation cannot be redeemed.
- **Blockers hit:** Home says "about 2 minutes". The page names the requirement but not a way to meet it. The owner is the only member of their personal workspace (`lib/bootstrap.ts:28-74`).
- **Verdict:** `dead-end`. A normal first-run owner can never reach "Certified", so cannot author, review or approve a record. **Fixed in 11eba5f6.**
- **Fix:** Fix J-SET-01. Until then, link "Ask a different active owner or administrator" to Members and roles with the invite dialog preselected to Admin, and change the Home hint to say a second admin is needed first.
- **Severity:** S1 (blocks regulated work).

### J-SET-03 User with no workspace membership opens Home

- **Persona / goal:** A member the owner removed, or a user whose membership was never created, signs in and opens the app.
- **Entry:** Any signed-in page.
- **Path:**
  1. `getCurrentContext` returns `workspace: null` when there are no memberships (`lib/current-user.ts:40-60`). Bootstrap runs only at user creation (`lib/auth.ts:84-96`), so removal is permanent. `api.remove_member` deletes the row (`drizzle/0054_admin_001_workspace_admin.sql:200-211`).
  2. The shell renders normally: the workspace switcher says "No workspace" (`components/v3/shell/app-shell.tsx:66`).
  3. Home reads `workspaceId = undefined`. Every home query has `enabled: Boolean(workspaceId)` (`routes/index.tsx:293-304`, 315, ...).
  4. A disabled React Query v5 query stays `isPending`. The page returns `Loading your home…` forever (`routes/index.tsx:667-671`). The error branch (`651`) is never reached.
- **Blockers hit:** `Loading your home…` with no timeout, no cause and no action. Other routes use `context.workspace?.id ?? ''` and show empty lists.
- **Verdict:** `dead-end` at step 4. **Fixed in a4142585.**
- **Fix:** In the root or Home, when `auth` is set and `auth.workspace === null`, render an explicit state: "You are not a member of any workspace. Ask an owner to invite you, or sign out", with a Sign out button.
- **Severity:** S1 (user cannot do anything and is not told why).

### J-SET-04 Suspended member keeps using the app

- **Persona / goal:** A scientist whose membership an owner suspended opens a record.
- **Entry:** Any page.
- **Path:**
  1. Suspension sets `suspended_at` (`routes/settings/members.tsx:731`: "They lose access to this workspace immediately").
  2. `getCurrentContext` ignores `suspendedAt`. It still returns the workspace and the old role (`lib/current-user.ts:40-60`). The shell, nav and write controls render as before.
  3. The database treats suspended members as non-members (`api.is_workspace_member` excludes `suspended_at`, `drizzle/0054_admin_001_workspace_admin.sql:12-20`). Every read fails.
  4. Home shows "Home could not be loaded / Some workspace information is unavailable. Try again…" with Try again (`routes/index.tsx:649-664`). Other screens show their own generic load errors.
  5. Grep of `src/` for `suspended` in UI code finds only the Members page and server credential checks. No user-facing message names it.
- **Blockers hit:** "Home could not be loaded", "Try again". Retrying never succeeds. Nothing says the account is suspended or who can reinstate it.
- **Verdict:** `dead-end` at step 4. **Fixed in a4142585.**
- **Fix:** Return `suspendedAt` in `CurrentContext` and render a full-page "Your access to <workspace> is suspended. Contact <owner names> to be reinstated" state with Sign out and a workspace switcher.
- **Severity:** S1 for a regulated tool (user cannot tell a suspension from an outage).

### J-SET-05 Session expires while working

- **Persona / goal:** A scientist leaves a notebook open. The session ends. They come back and keep editing.
- **Entry:** Any authenticated page.
- **Path:**
  1. The live stream sends `bye: session_expired`. The client sets status `offline` and stops (`lib/live-events.ts:679-682`).
  2. In the notebook, `OfflineBanner` shows "You're offline. Keep working: edits are saved on this device and sync when you reconnect." with "Retry now" (`components/offline/offline-banner.tsx:58-60`, `67-82`).
  3. `lastResetReason` is recorded (`live-events.ts:523`) but no component reads it (grep of `src/`: only `lib/live-events.ts` and tests).
  4. Data calls throw `DataClientError` on 401. The client has no 401 handling (`lib/data-client.ts:108-123`). Each screen shows its own generic error, for example "Could not load comments." (`components/comments/comment-panel.tsx:220`).
  5. Retry cannot work: the session is gone. No screen links to sign-in. Only the signing dialog handles `session_expired` (`lib/signatures.ts:392-416`, `routes/sign-in.tsx:222-227`).
- **Blockers hit:** A false "offline, keep working" message. The user keeps typing. Edits are queued, but replay needs a session.
- **Verdict:** `dead-end` at step 2. The banner misdiagnoses the cause and offers a Retry that cannot succeed. **Fixed in f72287ce.**
- **Fix:** Pass `lastResetReason === 'session_expired'` into the banner and show "Your session ended. Sign in to sync N changes" with a sign-in link carrying `next=<current path>` (see J-SET-06). Add a global 401 handler in the data client.
- **Severity:** S1 (data-loss risk and wrong guidance).

### J-SET-06 Signed-out visitor deep-links in, or GitHub sign-in fails

- **Persona / goal:** Someone opens a link to `/records/...` or `/settings/api` while signed out, or sign-in returns an error.
- **Entry:** Redirect to `/sign-in`, or `/sign-in?error=...`.
- **Path:**
  1. All 40-plus protected routes redirect with `throw redirect({ to: '/sign-in' })` and no search (for example `routes/settings.tsx:22`, `routes/search.tsx:66`, `routes/$.tsx:14`; list from `grep "to: '/sign-in'" routes`).
  2. The sign-in page supports a validated `?next=` (`routes/sign-in.tsx:64-74`, `178`) but nothing in those redirects supplies it. After sign-in the user lands on `/`.
  3. Errors are mapped to recovery copy: declined, no email, expired state, not configured, generic (`lib/auth-errors.ts:6-22`). They render as a red Notice above a working "Continue with GitHub" button (`sign-in.tsx:216-218`, `264-282`).
  4. GitHub not configured: plain text pointing to `docs/operations/authentication.md` (`sign-in.tsx:292-297`). That path is not a link and a non-admin cannot act on it.
  5. The footer says "Sheetbase only allows company sign-in. If you don’t have a company account, ask your workspace admin." (`sign-in.tsx:287-289`). Any GitHub account that signs in gets its own workspace as owner (`lib/auth.ts:84-96`), so nothing restricts sign-in to company accounts. The copy overstates the control.
  6. After a user signs in with no admin to ask, there is no name or contact on the page.
- **Blockers hit:** Deep link lost. "Ask your workspace admin" with no name.
- **Verdict:** `partial`. Error recovery is good (steps 3, 4). The deep link is dropped (step 2). **Partly fixed in 3aa482c8 (guards keep `next`); sign-in footer reworded.**
- **Fix:** Add a helper that builds `redirect({ to: '/sign-in', search: { next: location.href } })` and use it in all `beforeLoad` guards. Reword the footer to match the actual policy.
- **Severity:** S3 for step 2, S2 for step 5.

### J-SET-07 Working offline, then syncing

- **Persona / goal:** A scientist on a lab network drop keeps editing a notebook, then reconnects.
- **Entry:** Notebook offline banner and "Some edits could not sync" notice.
- **Path:**
  1. Banner appears only inside the notebook route: `OfflineStatusBanner` is mounted only at `routes/records/$recordId/notebook.tsx:741`. The top-bar `ConnectionStatus` component says it lives in the app-shell top bar (`components/live/connection-status.tsx:10-12`), but nothing mounts it (grep of `src/` outside `components/live`: no reference).
  2. On every other screen, offline shows only each screen's own load or save errors.
  3. In the notebook the banner offers "Retry now" and counts unsynced changes (`offline-banner.tsx:62-83`). The inspector lists them (`components/offline/unsynced-changes.tsx:58-105`).
  4. After reconnect, a conflict shows "Some edits could not sync: N edits conflict with changes on the server" or "N edits were refused and stay queued." (`components/offline/offline-replay.tsx:121-145`). The Notice has no action. The unsynced list has no Keep, Discard or Retry per row (rows are display only, `unsynced-changes.tsx:85-101`).
  5. The one-edit conflict banner, with "Keep my edit" and "Use server version", exists only for a live autosave conflict (`components/notebook/conflict-banner.tsx:39-72`, used from `components/notebook/block-editor.tsx:388`).
- **Blockers hit:** "stay queued" with no reason and no way to resolve or discard. No offline indicator outside the notebook.
- **Verdict:** `partial`. The offline state is honest and the drafts are safe, but the sync-failure notice is a dead-end.
- **Fix:** Mount `ConnectionStatus` in the top bar. Give the replay Notice and each unsynced row Keep mine, Use server and Discard actions, reusing the conflict-banner handlers. Show the refusal reason.
- **Severity:** S2.

### J-SET-08 Admin turns off "Allow offline editing"

- **Persona / goal:** An admin of a regulated site disables offline editing so edits cannot be held on devices.
- **Entry:** Settings, General, "Allow offline editing on this workspace’s devices" (`components/v3/settings/settings-general.tsx:322-335`).
- **Path:**
  1. The switch saves `allow_offline_editing` through the SET-01 RPC (`lib/workspace-general.ts:115`).
  2. Nothing reads it. Grep of `src/` for `offlineEditingAllowed` and `allow_offline_editing` outside the settings form and its data module finds only a comment in `lib/offline/store.ts:20-27` that says the value is not wired.
  3. `OfflineBanner` and the replay runner mount unconditionally (`routes/records/$recordId/notebook.tsx:741-751`) and still say "Keep working: edits are saved on this device".
- **Blockers hit:** The control saves and confirms ("Settings saved") yet changes no behaviour. I found no server-side enforcement in `src/`.
- **Verdict:** `dead-end`. The setting is a control with no effect. **Fixed in 753250bc.**
- **Fix:** Read the flag in the notebook and suppress queuing, replace the banner copy with "Offline editing is turned off for this workspace. Reconnect to save", and disable edits offline. Or remove the switch until it works.
- **Severity:** S1 (a compliance setting that does nothing).

### J-SET-09 Bell: "Notification settings" and notification preferences

- **Persona / goal:** Any member wants to change which events reach them.
- **Entry:** Bell popover footer link "Notification settings" (`components/v3/shell/app-shell.tsx:792`).
- **Path:**
  1. The link goes to `/settings`, which is General, not `/settings/notifications`.
  2. A non-admin lands on the lock state "Only workspace admins can see workspace settings… Ask a workspace admin to change them." (`routes/settings/index.tsx:111-137`). Its only action is "Open your profile settings".
  3. The user must find Notifications in the rail (`settings-nav.ts:93-97`).
  4. On the Notifications page, the preference reads fall back to defaults when a read fails. `preferencesQuery.isError` is never shown, so defaults look like saved choices (`components/v3/settings/settings-notifications.tsx:39-48`, `77-90`). Saving then overwrites the stored choices.
  5. "Email" is offered for every event, but the email worker runs only when `SMTP_HOST` is set (`lib/email-delivery.server.ts:82-98`). Diagnostics has no email check (`routes/settings/diagnostics.tsx`: no SMTP row), so nobody is told email is off.
- **Blockers hit:** Wrong link target; silent default fallback; email channel that may never send.
- **Verdict:** `partial`. The page works once reached (steps 3 onward). **Fixed in a4142585.**
- **Fix:** Point the link to `/settings/notifications`. Show a load error with Retry. Add an "Email delivery" row to Diagnostics and a note on the Email column when it is off.
- **Severity:** S2.

### J-SET-10 Admin or owner opens Members and roles

- **Persona / goal:** A workspace `admin` (not owner) wants to invite someone or change a role. A viewer or client wants to see who is in the workspace.
- **Entry:** Settings, Members and roles.
- **Path:**
  1. The nav shows Members to `owner` and `admin` (`settings-nav.ts:32-37`). The route's `canManage` is true for `owner` only (`routes/settings/members.tsx:115`).
  2. For an `admin`, "Groups" and "Invite people" are not rendered and the row Manage menu is `null` (`members.tsx:530-545`, `401`). Nothing says why. The only line is the role description (`598`).
  3. If the same admin could act, SQL would refuse with owner-only errors (`drizzle/0054_admin_001_workspace_admin.sql:136,186,204`).
  4. `client_viewer` gets a lock with a link to the portal (`members.tsx:92-113`). That path is good.
  5. If the roster read fails, `rows` is empty and not loading, so the page shows "No members / Invite people to work in this workspace." (`members.tsx:552-566`). `members.isError` is never checked, and an owner sees a primary "Invite people" button on a failed read.
  6. Inviting a Client viewer when the workspace has no clients leaves the Client select empty with "Choose a client." and no link to create one (`members.tsx:776-777`, `815-829`, `836`). Failure toasts show raw database text ("The database refused it.", `members.tsx:224-227`, `248-252`). `describeAdminError` (`lib/workspace-admin.ts:610-625`) exists but is not used here.
- **Blockers hit:** Missing controls with no reason (admin); false "No members" on error; empty Client select; raw DB errors.
- **Verdict:** `partial`.
- **Fix:** For non-owners render a line "Only an owner can invite people or change roles. Owners: <names>". Branch on `members.isError` with Retry. Link the empty Client select to where clients are created, or say who can create them. Route errors through `describeAdminError`.
- **Severity:** S2.

### J-SET-11 Project access: "I can't add a rule"

- **Persona / goal:** A lead wants to give a group edit access to a project, or an owner wants to know why no one can open one.
- **Entry:** Settings, Project access.
- **Path:**
  1. If the caller manages no project, the header shows "Only a project manager can add rules. You don’t manage any project." (`routes/settings/access.tsx:279-284`). It does not say who manages a project or where to become one.
  2. With no visible projects, the body says "No accessible projects. An explicit project rule is required. Workspace roles do not grant project access." (`access.tsx:352-361`). It has no action. The user who most needs a rule cannot add one without a managed project.
  3. Access requests: pending rows show "Waiting for approval" to anyone who cannot decide (`access.tsx:250-251`) without naming the approver. The only approval offered is "Approve edit access" (`access.tsx:235-236`). A view-only request cannot be granted at that level.
  4. Requests are visible only when the list has rows (`access.tsx:375-385`). The section never explains how a member makes a request.
  5. In the rule dialog the Group list is empty when no groups exist, with no link to the Groups dialog on the Members page (`access.tsx:483-503`).
  6. The read-failure path is good: "Could not load project access. No permissions have changed." with Retry (`access.tsx:324-338`).
- **Blockers hit:** Two blocking messages with no named owner; unexplained empty Group select.
- **Verdict:** `dead-end` at step 2, `partial` overall.
- **Fix:** In both messages name the project leads (or the owners) and link to the project settings page. Offer a "Request access" action. Link the empty Group select to Members, Groups.
- **Severity:** S2.

### J-SET-12 API tokens and service credentials

- **Persona / goal:** A member creates a token for a notebook. An owner manages a service credential.
- **Entry:** Settings, API and SDK.
- **Path:**
  1. "Create token" is disabled until a name and at least one scope exist, with no message for either cause (`components/v3/settings/settings-credentials.tsx:239-245`).
  2. Secrets are shown once with a Copy control and "I have stored it" (`settings-credentials.tsx:154-177`). This part is complete.
  3. Expired rows have Rotate disabled with no explanation. The user must create a new token (`settings-credentials.tsx:292-298`).
  4. Non-owners do not see service credentials at all. The header says only "managed here by owners" (`routes/settings/api.tsx:146-149`, `182-198`).
  5. If the token list fails to load, `query.isLoading` is false, so the panel renders an empty list that says "You have no personal tokens." with a Retry button below it. The error text itself is never shown (`api.tsx:158-181`). The owner service query has no error branch at all and shows "no credentials" on failure (`api.tsx:182-198`).
  6. Mutation errors appear in one alert at the top of the page (`api.tsx:136-157`), which can be off-screen from the row that failed.
- **Blockers hit:** Silent disabled controls; false empty list on a failed read.
- **Verdict:** `partial`.
- **Fix:** Add helper text under the disabled button. Add "Expired. Create a new token" in the Status cell. Show `query.error` and Retry on both lists. Name the owners in the header.
- **Severity:** S2.

### J-SET-13 Settings, General fails to load

- **Persona / goal:** An admin edits the workspace name or time zone.
- **Entry:** Settings, General.
- **Path:**
  1. Non-admin: clear lock state with "Open your profile settings" (`routes/settings/index.tsx:111-137`). Complete. It does not name the admin.
  2. Admin, read fails: `Save changes` and both checkboxes are disabled when `query.isError` (`settings-general.tsx:139-146`, `300`, `326`). No branch renders an error and nothing offers Retry. The form shows default values (`settings-general.tsx:43`) that look like real settings.
  3. Save failures do show a Notice (`settings-general.tsx:156-162`).
- **Blockers hit:** Silently disabled form with default values after a failed read.
- **Verdict:** `dead-end` at step 2 for the read failure.
- **Fix:** When `query.isError`, replace the form with an error Notice and a Retry button, as `usage.tsx:162-182` does.
- **Severity:** S2.

### J-SET-14 Client viewer uses the client portal

- **Persona / goal:** A CDMO client reads approved reports, downloads a PDF and messages the team.
- **Entry:** Sign-in, then Home, then the portal.
- **Path:**
  1. `/client-portal` is linked from exactly one place: the Members lock state (`routes/settings/members.tsx:104`). Grep of `src/` finds no other link, and the nav has none. A `client_viewer` signing in lands on `/`, the full internal shell, with no pointer to the portal.
  2. The invitation route to become a client viewer is the broken one (J-SET-01).
  3. The portal is a bare route with no sign-out, no help and no contact (`routes/__root.tsx:172`, `routes/client-portal.tsx:475-506`). The header shows only an initials avatar (`client-portal.tsx:500-505`).
  4. Project, report and message reads have no error branch. A failed read shows "No shared projects yet" or "No shared reports yet" (`client-portal.tsx:421-433`, `560-572`, `309-327`). A client would conclude nothing was shared.
  5. For a preview viewer (internal member) the Messages empty state says "Send your CDMO team a message" but there is no composer, only "Messaging is for client portal accounts." (`client-portal.tsx:372-376`, `405-410`).
  6. "Open PDF" is a plain link. A failure opens a raw error page (`client-portal.tsx:178-184`).
- **Blockers hit:** No way in, no way out, failures that read as "nothing shared".
- **Verdict:** `dead-end` at step 1 (discovery) and step 3 (sign-out).
- **Fix:** Redirect a `client_viewer` from `/` to `/client-portal`. Add a Sign out and a "Contact your CDMO" mailto in the portal header. Show error states with Retry. Fix the preview empty-state copy.
- **Severity:** S1 for step 1, S2 for the rest.

### J-SET-15 Comments panel: read-only, empty or failed

- **Persona / goal:** A reviewer or author reads and adds comments on a record.
- **Entry:** Notebook inspector, Comments tab; review page; sheet workspace.
- **Path:**
  1. Record comments: `canComment = canEditMetadata && !archived` (`routes/records/$recordId/notebook.tsx:3085`). A viewer or an archived record gets no composer and no Reply or Resolve (`components/comments/comment-thread.tsx:204`, `240`). Nothing explains why.
  2. The record panel never shows a composer: `canComment && canCreate && !recordId` (`comment-panel.tsx:292`). A record with no comments shows "No comments yet on this Record. Comments anchored to a block or cell appear here…" (`comment-panel.tsx:251-258`). It does not say how to start one, so the user is left to guess that a block action is needed.
  3. Historical revisions use `canComment={false}` (`notebook.tsx:3073`). The empty state still reads as an invitation.
  4. Load failure shows "Could not load comments." with no Retry (`comment-panel.tsx:220`). A failed mutation shows a Notice with the raw message (`comment-panel.tsx:322`).
  5. The offline note promises "adding rows and comments" works offline (`components/offline/offline-banner.tsx:105`). Draft comments are stored for sheets only (`components/offline/offline-edits.tsx:56-58`, `132-136`).
- **Blockers hit:** Silent missing controls; empty state with no next step; no Retry.
- **Verdict:** `partial`.
- **Fix:** Render a one-line reason when `canComment` is false ("Viewers can read comments", "Archived records are read-only", "Historical revision"). Add a "How to comment" hint or button in the empty state. Add Retry on load failure.
- **Severity:** S2.

### J-SET-16 Something failed: from Diagnostics, Usage and Help to someone who can fix it

- **Persona / goal:** An admin sees a failing check, a capacity warning or a failed run and wants to fix it or get support.
- **Entry:** Settings, Diagnostics; Usage, "Capacity warnings"; Help, Contact support.
- **Path:**
  1. Non-admin sees "Ask a workspace admin if something isn’t working; they can send a support bundle to Sheetbase." (`routes/settings/diagnostics.tsx:115-116`). The bundle does not exist: "Support bundles aren’t built yet" (`diagnostics.tsx:620-629`), whose only alternative is the Audit log link.
  2. Failed rows carry a message and a request ID but no link to the failing run, pipeline or connector (`diagnostics.tsx:177-190`, columns at `199-232`). Only the Connector check links onward, to Integrations (`diagnostics.tsx:506`).
  3. "Run checks" ends with a toast "N need attention" (`diagnostics.tsx` `runAll`) and no link to the failing check list.
  4. Usage: "Capacity warnings" is a static list at the bottom of the page (`routes/settings/usage.tsx:385-401`). Each item has no action. "No seat limit is configured" and "No storage quota is configured" (`usage.tsx:263`, `277-281`) do not say where to configure one.
  5. Help, Contact support: "Support requests from Sheetbase aren’t set up yet… For anything stopping GMP work, contact the IT service desk." (`routes/help/index.tsx:421-426`, `lib/help.ts:38-39`). It gives no address, phone or link.
  6. "Ask a workspace admin" appears in 5 places (`routes/sign-in.tsx:289`, `settings/index.tsx:38`, `settings/usage.tsx:130`, `settings/diagnostics.tsx:116`, `routes/instruments.tsx:398`) and no page lists the admins to a non-admin, because Members is admin-only (`settings-nav.ts:32-37`).
- **Blockers hit:** Support path ends in a service desk with no contact; warnings with no action; admins not named.
- **Verdict:** `dead-end` at step 5 (no contact) and step 1 (support bundle).
- **Fix:** Put a real service-desk URL or address in `lib/help.ts` and render it. Link each failure row to its run or connector, and each capacity warning to the page that fixes it. Add a "Workspace admins" list readable by all members and link "Ask a workspace admin" to it.
- **Severity:** S2.

### J-SET-17 Search: no matches, search failure, empty query

- **Persona / goal:** Find a record by ID or value, and recover when nothing is found.
- **Entry:** `/search`, ⌘K palette, or the not-found screen's Search button (`components/v3/shell/not-found.tsx:94-100`).
- **Path:**
  1. Empty query: "Search names, IDs, cell values, comments and files. Type an ID like EXP-0142…" (`routes/search.tsx:342-350`).
  2. Service failure: "Search could not run. The search service did not answer. This is not a result of nothing matching." with "Try again" (`search.tsx:371-389`). The did-you-mean lookup is skipped on error (`search.tsx:161-172`).
  3. No matches: states cause, offers "Did you mean" links, "Clear filters" when facets are active, and "Include archived" or "Search active work only" toggles (`search.tsx:517-593`).
  4. The note "Archived projects and other workspaces aren’t searched" (`search.tsx:581`) offers no workspace switch link. Search failure does not distinguish offline from server errors. Visibility is stated ("you can access", `search.tsx:366-369`) with no way to request access.
  5. Signed out: redirect to sign-in, without `next` (`search.tsx:66`; see J-SET-06).
- **Blockers hit:** None that block. Two small gaps in step 4.
- **Verdict:** `complete`.
- **Fix:** Optional: link "other workspaces" to the workspace switcher.
- **Severity:** S3.

---

## Additional observations (not counted as journeys)

- **Audit and retention** (`routes/settings/audit.tsx`): the nav label promises retention, but the page is the log only; no retention setting appears (grep `retention` in the file: no match). The CSV export omits the Change and Reason columns that the grid shows (header at `audit.tsx:337-345` versus columns at `277-283`). Record and Project cells show a raw UUID or an 8-character prefix, not links (`audit.tsx:174-176`). Read failure and empty states are handled well (`audit.tsx:240-255`, `290-294`).
- **Sessions** (`components/v3/settings/settings-sessions.tsx`): load error with Try again is complete; per-session sign-out has no confirmation (`settings-sessions.tsx:120-126`).
- **Profile** (`routes/settings/profile.tsx:134-140`): "Role. Set by an administrator." shows the raw role key and does not name who.
- **Integrations** (`routes/settings/integrations.tsx:162-165`): names the roles that can register ("owners, admins and stewards"). Complete for the disabled-control case. The connector list error is text only, with no Retry (`integrations.tsx:126-133`).
- **Unknown URLs** (`components/v3/shell/not-found.tsx:53-112`): complete: names the section, offers Back and Search.
- **Route errors:** the router sets `defaultNotFoundComponent` but no `defaultErrorComponent` (`router.tsx:27`). A failure in the root `beforeLoad` (for example the database is down, `routes/__root.tsx:114-131`) shows the framework's default error screen.
- **Sign-out** (`components/v3/shell/app-shell.tsx:817-853`): failure keeps the user signed in and says "Try again". Complete.

---

## Summary

| ID       | Title                                               | Verdict  | Severity |
| -------- | --------------------------------------------------- | -------- | -------- |
| J-SET-01 | Invited person tries to join a workspace            | dead-end | S1       |
| J-SET-02 | Sole owner needs to certify an electronic signature | dead-end | S1       |
| J-SET-03 | User with no workspace membership opens Home        | dead-end | S1       |
| J-SET-04 | Suspended member keeps using the app                | dead-end | S1       |
| J-SET-05 | Session expires while working                       | dead-end | S1       |
| J-SET-06 | Signed-out deep link, or GitHub sign-in fails       | partial  | S2       |
| J-SET-07 | Working offline, then syncing                       | partial  | S2       |
| J-SET-08 | Admin turns off "Allow offline editing"             | dead-end | S1       |
| J-SET-09 | Bell: "Notification settings" and preferences       | partial  | S2       |
| J-SET-10 | Admin or owner opens Members and roles              | partial  | S2       |
| J-SET-11 | Project access: "I can't add a rule"                | dead-end | S2       |
| J-SET-12 | API tokens and service credentials                  | partial  | S2       |
| J-SET-13 | Settings, General fails to load                     | dead-end | S2       |
| J-SET-14 | Client viewer uses the client portal                | dead-end | S1       |
| J-SET-15 | Comments panel: read-only, empty or failed          | partial  | S2       |
| J-SET-16 | Something failed: Diagnostics, Usage, Help          | dead-end | S2       |
| J-SET-17 | Search: no matches, failure, empty query            | complete | S3       |

Counts: dead-end 10, partial 6, complete 1.
