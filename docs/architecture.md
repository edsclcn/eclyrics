# EC Lyrics architecture

EC Lyrics is a static Firebase Hosting frontend, an Electron shell that loads
that frontend, and a Firestore-backed browser library. Firebase Authentication
and Firestore rules protect admin mutations.

## Admin access

After sign-in, `public/js/auth/auth.js` resolves the user's admin role from a
case-normalized email match in `rbac/config.adminEmails` or the presence of an
`admins/{uid}` document. The Admin sidebar entry and panel start hidden and are
shown only after an admin role is confirmed. The Admin panel also checks the
role before loading. Firestore rules independently enforce authorization for
protected `lyrics` and `admin_data` access, so hiding the UI is not the security
boundary. The `adminEmails` entries in Firestore must be lowercase for the
rules' email check.

## Repository layout

```text
public/
  index.html                         Main workspace and admin shell
  prompter.html                      Lyrics prompter popup
  assets/                            CSS, fonts, and images
  js/
    core/                            Firebase configuration and shared bootstrap
    auth/                             Authentication state and sign-in UI
    library/                          Firestore library and MiniSearch modules
    features/
      admin/                          Admin library editor
      editor/                         Lyric workspace, formatting, import/export
      prompter/                       Popup, shortcuts, and preview synchronization
    ui/                               UI bootstrap helpers

electron/
  main.js                             Desktop shell and popup window policy

docs/
  architecture.md                    System boundaries and ownership
  features/                           Feature behavior and user flows
  solutions/                          Historical decisions and fixes
scripts/
  check-javascript.js                 Cross-platform syntax verification
```

## Runtime boundaries

```text
Browser / Electron renderer
  ├─ UI features and prompter state
  ├─ Firebase Auth (user session)
  ├─ Song library ─────────────> Firestore lyrics collection + MiniSearch
  └─ Admin CRUD (authorized by Firestore rules)
```

The song library adapter loads the authorized Firestore `lyrics` collection,
builds a browser MiniSearch index across titles, adaptation sources, hymn
numbers, and lyrics, and shares that index with Add lyrics and Admin search.
Firestore remains the source of truth.

## Script loading rule

The frontend intentionally uses classic scripts rather than a bundler. Load
order is therefore part of the contract:

1. Firebase SDKs and configuration.
2. Auth and shared browser services.
3. Feature modules that consume those services.
4. The editor coordinator and import/export helpers.

Within the editor, `features/editor/block-source.js` loads before
`features/editor/index.js` and exposes only the internal block-source bridge;
the coordinator owns block state and supplies the mutation callbacks.

When adding a new script, put it in the narrowest ownership folder and add it
to the relevant HTML entrypoint after its dependencies. Avoid introducing
new globals unless the module is an explicit browser integration point.

## Local verification

```bash
npm test
npm run dev
npm run electron:local
```

`npm test` runs syntax checks across the root app and Electron shell while
excluding dependency folders.
