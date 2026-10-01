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
  index.html                         Shared shell, navigation, sign-in gate, and panel mount
  modules/                            Route-specific HTML fragments mounted by the shared shell
    text-lyrics.html
    image-lyrics.html
    video-lyrics.html
    admin.html
    sign-in.html
  prompter.html                      Lyrics prompter popup
  assets/                            CSS, fonts, and images
  js/
    core/
      app-bootstrap.js               Loads fragments, mounts panels, then loads scripts
      firebase-config.js             Firebase initialization
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

## Workspace URLs

`public/index.html` is the single application shell. It contains the navigation,
shared dialogs, the `#auth-gate-mount` sign-in mount, and the
`.app-main#workspace-panels` panel mount. It loads
`public/js/core/app-bootstrap.js` as a deferred classic script; the bootstrap
runs in an async IIFE, fetches the HTML fragments from `public/modules/`, mounts
their panels, then loads the classic application scripts in dependency order.
It mounts `sign-in.html` into `#auth-gate-mount` before loading the auth and
login scripts. It appends `text-lyrics.html`, `image-lyrics.html`,
`video-lyrics.html`, and `admin.html` panels directly to
`.app-main#workspace-panels`, so the panels participate in the shell's
full-height flex layout. These are route fragments, not standalone documents.

The client maps routes to panels as follows:

| Path | Panel or behavior |
| --- | --- |
| `/text-lyrics` | Text lyrics workspace; default route |
| `/image-lyrics` | Image lyrics workspace |
| `/video-lyrics` | Video lyrics workspace |
| `/admin` | Admin panel fragment, available to confirmed admins |
| `/sign-in` | Shared sign-in gate fragment over the application shell |

All five routes use the same shell and update the selected view through the
client-side route controller; browser Back and Forward restore the route.
Unauthenticated users see the sign-in gate on `/sign-in`. The Admin panel stays
hidden until the auth module confirms the admin role.

Unauthenticated visits to `/admin` go to `/sign-in?returnTo=%2Fadmin`; a signed-in
non-admin visiting `/admin` goes to `/text-lyrics`. After sign-in, the client
redirects to the allowed `returnTo` destination or `/text-lyrics`. `returnTo` is
accepted only for a root-relative URL with no protocol-relative prefix and a
same-origin pathname in the allowlist `/text-lyrics`, `/image-lyrics`,
`/video-lyrics`, or `/admin`. If a non-admin's allowed return path is `/admin`,
the destination is changed to `/text-lyrics`.

Firebase Hosting redirects `/index.html` and `/public/index.html` to
`/text-lyrics`; its `**` rewrite serves `public/index.html` for the clean
application routes, including `/text-lyrics`, `/image-lyrics`, `/video-lyrics`,
`/admin`, and `/sign-in`. These routes have no separate document entry points
or route-specific rewrites. For local route testing, run `npm run dev`; Firebase
Hosting Emulator serves the app at `http://127.0.0.1:5501`.

## Script loading rule

The frontend intentionally uses classic scripts rather than a bundler. Load
order is therefore part of the contract:

1. `app-bootstrap.js` fetches and mounts the sign-in fragment and all four
   workspace fragments into the shared shell, then moves the Admin delete
   dialog into `document.body`.
2. It loads Firebase SDKs, Firebase configuration, auth, login UI, shared
   library services, then feature modules including Admin and image lyrics,
   followed by the editor coordinator and import/export helpers.

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
