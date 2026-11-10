# Editing Office files in the browser

Word, Excel, PowerPoint and OpenDocument files in an experiment can be opened
and edited in the browser. This is optional and off by default. It uses
[Collabora Online](https://www.collaboraonline.com/code/), which you run
yourself; nothing is sent to a third party.

Without it, Office files still preview in the page (a built-in preview that
approximates the document), and "Open in Word" style download works as usual.

## What it gives people

- **Edit** on an Office file block opens the file in a full editor. Several
  people can edit the same file at once.
- **Every save is a new file version.** Earlier versions stay downloadable and
  the file's text is read again, so search finds the edited content.
- **Signed experiments are locked.** The editor opens read-only once the
  experiment holding the file is signed or archived; change it through an
  amendment.
- Legacy `.doc`, `.xls` and `.ppt` files open and save in their own format.
- **The block shows the document as Office draws it.** With the editor on, a
  Word, Excel or PowerPoint block shows the real document in place, read-only,
  with Collabora's own page, cell and slide rendering, and follows the app's
  light or dark theme. Expand makes it full size. An older pinned version, or an
  editor that is not answering, falls back to the built-in preview.

## Setting it up

Collabora needs about 2 GB of memory.

1. Start it from the compose files: `docker compose --profile editor up -d collabora`.
   A production deployment (`compose.deploy.yaml`) has no default image: set
   `SHEETBASE_OFFICE_EDITOR_IMAGE` to a pinned `collabora/code` image, by digest.
2. Put it behind HTTPS on its own address (for example `office.example.com`)
   with your reverse proxy or tunnel. Browsers must reach it directly.
   Use a different origin from the app: a separate path on the app's origin
   is not sufficient. The browser refuses same-origin editor sessions before
   posting their access token. The editor needs scripts and its own origin
   inside its sandbox, so origin separation is required for isolation.
3. Set on the app:

   ```
   OFFICE_EDITOR_URL=https://office.example.com
   OFFICE_EDITOR_WOPI_HOST_URL=http://app:3000   # how Collabora reaches the app
   ```

   `OFFICE_EDITOR_WOPI_HOST_URL` defaults to `BETTER_AUTH_URL`. Set it when
   Collabora reaches the app on a private network name.

4. Tell Collabora which app it may serve: `OFFICE_EDITOR_ALLOWED_HOST` (the app
   address Collabora calls, the same as `OFFICE_EDITOR_WOPI_HOST_URL`) and
   `BETTER_AUTH_URL` (the address that frames the editor) in the compose
   environment.

Admins see the editor's state under Settings > Integrations.

## How it works

The app is the WOPI host. When someone presses Edit, the app issues an access
token for that person and that one file, valid for eight hours, and loads the
editor in a frame. Collabora calls these endpoints with the token:

| Call                       | Endpoint                             |
| -------------------------- | ------------------------------------ |
| CheckFileInfo              | `GET /api/wopi/files/{fileRecordId}` |
| GetFile                    | `GET /api/wopi/files/{id}/contents`  |
| PutFile                    | `POST /api/wopi/files/{id}/contents` |
| Lock, refresh, get, unlock | `POST /api/wopi/files/{id}`          |

Each call turns the token back into the person's own database identity, so row
security, work permissions, audit and change events apply as for any upload.
The token is signed with a key derived from the server secret and is useless as
a database token. File locks are held in the app process and lapse after 30
minutes without a refresh.

Content-Security-Policy gets the editor's origin added to `frame-src` and
`form-action` only when `OFFICE_EDITOR_URL` is set.

## Limits

- Collabora shows its welcome screen to each person the first time they open a
  document. Its "home mode" setting hides it, but caps the editor at 20
  concurrent connections and 10 open documents, so it suits a small team only.
- The in-place view always shows the file's latest version. A block pinned to an
  older version uses the built-in preview instead.
- Collabora saves after edits and when the last person leaves, and each save is
  a version, so a long session can leave several versions.
- Locks live in one app process. With several app replicas, run one replica for
  editing or put the editor behind sticky routing.
