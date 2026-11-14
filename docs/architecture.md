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
  video-prompter.html                Video Lyrics audience-output popup
  assets/                            CSS, fonts, and images
    videos/                           Bundled Video Lyrics background clips
    fonts/video/                      Local Video Lyrics font files and notices
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
      video-lyrics/                   Video lineup, cue state, stage, and background media
      video-prompter/                 Video output popup receiver and key forwarding
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

Video Lyrics reuses this shared song library and the editor's
`#block-source-dialog` through `eclyricsEditorBlockSource.openForSongSelection()`.
Its callback adds one selected song to an in-memory lineup; the shared dialog
closes after selection. `video-lyrics/model.js` parses stored lyric lines into
manual cues. `video-lyrics/output.js` mirrors the stage in the workspace,
opens `public/video-prompter.html`, and sends live lyric, appearance,
and changed background state over the origin-checked, revisioned
`eclyrics-video-v1` `postMessage` channel. The popup uses the shared stage
renderer from `video-lyrics/stage.js`; it contains only the audience output and
forwards arrow-key cue requests to the opener. Each song's title is the first
cue, followed by cues parsed from lyric lines. Video settings include font
family, weight, maximum size, text color, vertical pixel anchor, fade duration,
playback rate, and video-only dimming. Text remains horizontally centered. The
vertical anchor ranges from 0–1080 px in 10 px steps, defaults to 540 px, and
aligns the lyric box top, center, or bottom to the corresponding stage position.
Fade ranges from 0–2000 ms in 100 ms steps (default 400 ms), with both a slider
and editable value; playback rate ranges from 0.5×–2.0× in 0.1× steps
(default 1.0×).
Optional manual/paste callbacks reuse the shared picker; a
Video Lyrics title/body editor saves to one in-memory lineup instance without
writing to Firestore.

Text and Video Lyrics synchronization is an optional, page-local mode and starts
Off. The only Sync toggle is beside the Text preview in the Text Lyrics
workspace. Enabling it automatically shows the embedded Video preview and its
Appearance settings; disabling it hides that embedded panel and restores the
normal standalone Video Lyrics inspector. Text Lyrics owns the lineup and
reading position. While Sync is on, every populated lyric block across all Text
Lyrics tabs becomes a separate mirrored Video Lyrics lineup row, in tab order
and then block order. Empty placeholders are excluded, the lineup count reflects
the populated blocks, and each row label combines its Text tab name and block
title. Adding, removing, renaming, or editing a tab or block, and changing the
active Text tab or selected block, republishes the projection so the Video
Lyrics lineup stays current even when that workspace is already selected. With
no bound prompter position, the selected populated block in the active Text tab
is selected; if it is empty, the first populated block in that tab is used. A
position from the Text prompter bound to any listed tab selects its matching
tab and block even when its source-line index is null. Only an exact live source
line is highlighted. The Video lineup page follows the selected block. Clicking
a mirrored row seeks the Text prompter to that block's first populated source
line; clicking one of its source-line cues seeks that exact line. Cross-tab
navigation loads the target into the already-open Text prompter without opening
or focusing it. Text Lyrics remains the source of truth; Video Lyrics does not
edit its content, and Video output follows the Text prompter's position
broadcast. Stale positions whose source tab, block, or line was removed are
discarded. With Sync off, Video Lyrics restores its
standalone lineup and prepared item while leaving the already-live output in
place. `public/js/features/editor/textformatting.js` marks source lines;
`public/js/features/prompter/prompter.js` reads the line crossing the
configurable marker and publishes its text and source index over the
`eclyrics-prompter` BroadcastChannel. `public/js/features/video-lyrics/index.js`
accepts positions only from the bound Text prompter and refreshes the projected
lineup on editor updates. Its mirrored-row and cue handlers call
`eclyricsEditorPrompter.navigateToSourceLine` in
`public/js/features/editor/index.js`; cross-tab requests load the target lineup
into the existing Text prompter without opening or focusing the window.
`public/js/features/prompter/prompter.js` seeks to the requested source line and
broadcasts the resulting marker position. `public/js/features/video-lyrics/model.js`
validates that position against the projected tab, block, and source line before
sending the received text directly to the Video Lyrics stage. The mirrored
lineup does not require a separate Video Lyrics search or preparation step.

Text Lyrics remains the main workspace. With Sync on and Text Lyrics active,
the wide layout gives the Text editor the left third and uses the right two
thirds for two stacked preview rows. The upper row places the Text preview
stage on the left and its prompter controls on the right. The labeled **Send
to prompter** action spans the top of the Text control rail; transport and
navigation follow, with text sizing, line width, and speed below. The lower row
places the Video preview stage on the left and its Video controls and Appearance
settings on the right. At medium widths, the editor moves above both full-width
preview rows; at narrow widths, the editor moves above the preview rows while
each preview stays paired with its controls.
The reading marker defaults to the midpoint and can be dragged or adjusted
from the keyboard; its position is remembered in browser storage and controls
which source lyric line drives the Video stage. The synced editor uses two
lyric blocks per row. Text and Video preview stages share the same 16:9 size
and align in the left side of their respective rows. The embedded Video inspector reuses the Video preview
card and appearance controls. It hides **Open Prompter** and keeps **Blank**,
the font picker, **Background**, and the full appearance settings. The Video
action buttons match the Text toolbar's height and corner radius, with
Appearance directly below them. The same font trigger and background chooser
work in either workspace. The card shows the selected curated or custom
background name while suppressing repetitive success messages. The picker
shows status in its dialog while open; when it is closed, loading and selection
errors use the dedicated background status surface. Background and
appearance changes update the preview and audience popup. Vertical pixel
position, fade, and video-speed controls use the same settings in standalone Video Lyrics, the
synced embedded preview, and audience output. These settings live in page
memory and reset on reload. **Blank** clears the lyric while keeping its
background. Audience popup playback errors appear in
the embedded status and clear after **Start** succeeds.

The Sync toggle alone opens no windows if the Text prompter is not already
open. If it is open, enabling Sync opens or focuses only the Video Lyrics
window. Sending Text Lyrics opens or updates the Text prompter and, when Sync is
on, opens or focuses the Video Lyrics window too. A blocked Video popup is
reported through temporary feedback. Routine Sync changes do not display
changing status text. Turning Sync off leaves existing output windows and the
current video line live. In Sync, Video lineup and cue clicks seek the Text
prompter, and Video output follows the resulting prompter position broadcast.
Sync state resets to Off on page reload.

The seven repository-hosted background presets live under
`public/assets/videos/`; `white-stars.mp4` is **Background 1** and the default.
The other concise, title-cased descriptions follow their filenames. Preview
video sources are attached and played only while the background picker is open,
then paused and detached when it closes. The default background loads lazily
when Video Lyrics is activated or Sync/output needs video, so Text-only synced
use does not require visiting the Video Lyrics workspace. The media adapter
fetches a selected preset and, after successful session playback, attempts to
save only that Blob to per-browser IndexedDB under its catalogue ID/version
key; it does not download or cache the full catalogue on activation. Saving is
best-effort: a failure is silent and does not interrupt current playback, so
future offline reuse is not guaranteed. Later selections reuse saved entries,
while an uncached preset is fetched when selected. This browser storage is
distinct from Firebase Hosting's CDN cache and is subject to browser eviction
or clearing. A user-selected video is decode-checked and held only in page
memory for that session; it is neither uploaded nor saved to IndexedDB. Video
output fonts and local declarations are owned by `video-lyrics/fonts.js` and
`public/assets/css/video-fonts.css`; font licenses/source notices are stored
alongside the font files. The actual-face font picker searches alphabetical
metadata and filters Sans Serif, Serif, and Cursive families. Imported fonts
use validated FontFace loading and generated family names; their Blobs remain
in session memory and are transferred when needed on popup initialization or
font changes. Times New Roman remains an installed-device font, not a bundled
asset.

The Video Lyrics workspace has three equally tall fixed shells. Only the
middle cue container scrolls; its highlighted cue is centered with clamped
container scrolling. Lineup pagination keeps entries reachable without another
workspace scroll area. Native modal dialogs retain their own bounded content.
The Text Lyrics stylesheet uses `20261017-sync-horizontal-rows`; the Video
Lyrics stylesheet, bootstrap entry, Video fragment, and Video controller assets
use `20261017-video-position-speed`. The Text fragment uses
`20261017-sync-preview-refinement`. Prompter marker assets use
`20261017-sync-marker`; the Video Lyrics model and source-line formatting use
`20261017-lyric-sync`.

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
   library services and Admin, then the editor block-source bridge and editor
   coordinator. It loads Image Lyrics, then Video Lyrics modules (`fonts.js`,
   `model.js`, `index.js`, `stage.js`, `output.js`, `local-media.js`, and
   `backgrounds.js`), followed by the text-formatting helper. The shared
   block-source module must load before Video Lyrics because the feature opens
   its picker through the block-source bridge.

Within the editor, `features/editor/block-source.js` loads before
`features/editor/index.js` and exposes only the internal block-source bridge;
the coordinator owns block state and supplies the mutation callbacks.

`public/video-prompter.html` is a standalone popup document, not a workspace
fragment. It loads the font registry, shared video stage renderer, and
`features/video-prompter/prompter.js`; the workspace and popup use a dedicated
same-origin message channel for cue, background, and appearance updates.

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
