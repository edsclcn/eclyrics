---
name: video-lyrics
description: How the Video Lyrics workspace prepares songs, cues one lyric line, and sends it over a video background to a separate prompter window.
---

# Video Lyrics

With Sync off, Video Lyrics is the `/video-lyrics` workspace panel for preparing
a temporary song lineup and manually sending one lyric line at a time to a
separate 16:9 output popup. The control panel keeps the prepared cue list and
preview; the audience output shows only the live line over a muted looping
video.

## Step-by-Step Flow

1. Open `/video-lyrics`. `public/js/core/app-bootstrap.js` mounts
   `public/modules/video-lyrics.html` into the shared workspace and loads the
   Video Lyrics scripts after the shared song library and editor block-source
   dialog.
2. Choose one of the three compact plus slots in the lineup. The handler in
   `public/js/features/video-lyrics/index.js` calls
   `window.eclyricsEditorBlockSource.openForSongSelection()` for the shared
   `#block-source-dialog` in `public/index.html`. The shared picker retains the
   Text Lyrics search, category filters, result cards, **Manually type**, and
   **Paste lyrics** options. Selecting one song adds it to the lineup and closes
   the picker. Manual entry opens the Video Lyrics title/body editor. Paste
   reads the clipboard and adds the resulting temporary lineup entry directly;
   title and lyrics can be separated with a blank line. Drag the grip on a
   lineup entry to reorder it; edit and remove controls sit at the right. The
   same-background dialog lists the session-only own-video picker as its last
   card, alongside the curated background choices.
3. `public/js/features/video-lyrics/model.js` adds the song title as the first
   cue, then parses lyric lines into ordered cues. Blank lyric lines are
   omitted and advance the section marker used for visual grouping. The first
   added song becomes prepared; selecting a lineup entry changes the prepared
   song without changing the live output.
4. With Sync off, click a cue row, press **Down**/**Up**, or use the
   previous/next controls to cue a line. This immediately makes that line live
   and updates the preview. With Sync on, clicking a mirrored block row seeks
   the Text prompter to its first populated source line; clicking a source-line
   cue seeks that exact line. These controls navigate Text rather than edit its
   content, and Video output follows the Text prompter's position broadcast.
   With Sync enabled and the Video Lyrics panel active, **ArrowUp** and
   **ArrowDown** seek the adjacent populated source line in the current Text
   block through the Text prompter. The current block comes from its bound
   prompter position, or from the selected populated block in the active Text
   tab when there is no bound position. At the first or last populated line,
   navigation stops at that block boundary instead of moving to another block
   or tab. With Sync off, the arrow keys retain standalone cue stepping. The
   keys are ignored while focus is in an input, select, editable element, or open
   dialog. In standalone mode, the output popup also forwards its Up/Down keys
   to the control window for cue stepping.
5. Set appearance and playback for the whole lineup: font family, weight, size,
   text color, vertical position, fade duration, video speed, and background
   dimming. Text stays horizontally centered. Defaults are Satoshi, bold,
   120 px, white, 540 px vertical position (center of the 1080 px stage),
   400 ms fade, 1.0× video speed, and 30% background dimming. Vertical position
   uses pixel anchors from 0 to 1080 in 10 px steps: 0 aligns the lyric box to
   the top, 540 centers it, and 1080 aligns it to the bottom. The box stays
   inside the stage at the endpoints. Size changes in 5 px increments; fade
   ranges from 0–2000 ms in 100 ms steps, with a slider and editable millisecond
   value; video speed
   ranges from 0.5×–2.0× in 0.1× steps. The font size is a maximum:
   the stage reduces long text to fit one line. Dimming affects the video, not
   the lyric, and ranges from 0–90%. The custom font dialog shows alphabetical
   names in their actual faces, with search and a rectangular All/Sans
   Serif/Serif/Cursive category selector. `fonts.js` offers Atma, Birthstone,
   DynaPuff, Garamond, Great Vibes, IBM Plex Serif, Inter, Lobster Two, Lora,
   Merriweather, Parisienne, Poppins, Rouge Script, Satoshi, Story Script,
   Times New Roman, and Zen Antique. Garamond uses bundled EB Garamond;
   Times New Roman uses the installed device face and may fall back when absent.
   Bundled alternatives retain OFL/source notices under
   `public/assets/fonts/video/`. **Add your own font** accepts a decoded TTF,
   OTF, WOFF, or WOFF2 file up to 10 MB for this session only. Imported fonts
   have a generated family name and Regular weight.
6. The background chooser offers seven repository-hosted video presets:
   **Background 1 — White Stars** (`white-stars.mp4`, selected by default),
   **Blue Weightless**, **Green Lens**, **Orange Hexagons**,
   **Pink Hearts**, **Purple Fiber**, and **Purple Lens Glare**. The concise
   descriptions use the video filenames in title case. Preview videos are
   attached and played only while the chooser is open, then paused and
   detached when it closes. A selected built-in video is fetched if needed and
   eligible for a best-effort save to this browser's IndexedDB under its
   catalogue ID/version key after successful session playback; the full
   catalogue is not downloaded or saved up front. A save failure is silent
   and does not stop the current playback, so future offline reuse is not
   guaranteed.
   The default background loads when Video Lyrics is activated or Sync/output
   needs video, so Text-only synced use gets it without opening this workspace.
   Later selections reuse saved Blobs, while uncached selections are fetched
   when chosen. A personal file can be selected or dropped into **Add your own
   video**. It is decode-checked and used for the current page session only; it
   is not uploaded or saved to IndexedDB.
7. **Open prompter** opens or focuses `public/video-prompter.html`. The control
   panel and popup exchange state over the dedicated
   `eclyrics-video-v1` `postMessage` channel. Both ends check the same origin;
   the receiver checks the opener and channel, validates payload bounds, and
   ignores stale revisions. A background Blob is sent when it changes; later
   state messages carry only lyric and appearance updates. A selected custom
   font Blob is sent on font changes and popup initialization/reopening, rather
   than on each cue. The receiver loads the font before rendering and commits
   only a valid current revision, so slow loads cannot overwrite newer cues.
8. The shared stage renderer in `public/js/features/video-lyrics/stage.js`
   plays a muted, looping, inline video and displays one lyric line over it.
   On line changes, the previous and new line fade for the configured duration
   (0–2000 ms); reduced-motion preference sets the transition to zero. The
   vertical pixel anchor positions the centered lyric box within the video
   stage. Video playback
   continues as cues change at the selected rate.

## Optional Text Lyrics sync

Sync is off by default and is controlled only by the **Sync video** switch
beside the Text preview in Text Lyrics; Video Lyrics has no Sync toggle. When
enabled, each populated lyric block across all Text Lyrics tabs projects
one-way as a mirrored Video Lyrics lineup row, in tab order and then block
order. Empty placeholders are excluded, the lineup count reflects populated
blocks, and each row label combines the Text tab name and block title. Adding,
removing, renaming, or editing a tab or block, and changing the active Text tab
or selected block, refreshes the projection, including while the Video Lyrics
workspace is already selected. With no bound prompter position, the selected
populated block in the active Text tab is used, falling back to that tab's first
populated block if the selected block is empty. A position from the Text
prompter bound to any listed tab selects its matching tab and block even when
its source-line index is null. The cue list shows that block's source lines;
only an exact live source line is highlighted. The Video lineup page follows
the selected block. Clicking a mirrored row seeks the Text prompter to that
block's first populated source line; clicking a cue seeks that exact line. When
the target is on another tab, its lineup loads into the already-open Text
prompter without opening or focusing it. Text Lyrics remains the source of truth
and Video Lyrics does not edit its content; Video output follows the position
broadcast by the Text prompter. The mirrored lineup does not require a separate
Video Lyrics search or preparation step. With Sync off, Video Lyrics restores its own
lineup and prepared item while leaving the already-live output in place. When
Text Lyrics is active and Sync is on, the wide layout gives the
editor the left third and uses the right two thirds for two stacked horizontal
preview rows. The upper row has the Text preview stage on the left and its
controls on the right; the lower row has the Video preview stage on the left
and its controls and Appearance settings on the right. At medium widths, the
editor moves above both full-width preview rows. At narrow widths, the editor
moves above the preview rows while each stage stays paired with its controls.
Video appearance and background settings also apply to text-driven output.

The subtle horizontal reading marker appears over the Text prompter preview
while Sync is on. It defaults to the vertical midpoint, can be dragged, and can
be adjusted from the keyboard when focused. Its position sets the reading point
used to select the source lyric line. The marker position is remembered in
browser storage. Text prompter messages include the line text and source-line
index; Video Lyrics accepts them only from the Text prompter lineup bound to
this editor and validates the tab and block against the current projection. A
null source-line index still selects the matching row but produces no live-line
highlight. Positions pointing to a removed tab, block, or line are discarded.

In Text Lyrics Sync, the existing Video preview card and Appearance settings
move into the lower preview row automatically. The switch stays beside the Text
preview heading. The embedded preview hides **Open Prompter** and keeps
**Blank**, the single font picker trigger, **Background**, and all appearance
controls: weight, size, text
color and hex value, vertical position, fade duration, and background dimming. The
**Blank**, font, and **Background** actions share the Text toolbar buttons'
height and corner radius. Appearance sits directly below those actions. The
shared font chooser and background dialog are available from either workspace.
The Fade duration slider gets the wider column in its control row, while the
Vertical position value and **px** unit stay grouped at the right edge.
The embedded card shows the selected curated or custom background name. The
picker shows status in its dialog while open; when it is closed, loading and
selection errors use the dedicated background status surface. Background and
appearance changes update the preview and audience popup. **Blank** clears
the live lyric but keeps the selected background. Audience popup playback
errors appear in the embedded status and clear after **Start** succeeds.
Turning Sync off hides the embedded preview and restores the standalone Video
Lyrics inspector.

The Sync switch alone opens no windows if the Text prompter is not already
open. Routine Sync changes have no changing status text. If Text output is
already open, enabling Sync opens or focuses only the Video Lyrics window.
Pressing **Send to prompter** opens or updates the Text prompter and, when Sync
is on, also opens or focuses the Video Lyrics window. If the browser blocks
that Video popup, temporary feedback says to allow popups.

Turning Sync off stops text-driven updates, restores the independent Video
Lyrics lineup and prepared item, and leaves output windows and the current Video
Lyrics line live. While Sync is on, Video lineup and cue clicks seek the Text
prompter rather than edit Text content. The Text prompter broadcasts its
resulting position, which drives Video output. When no lyric line crosses the
reading marker, Sync waits for a line and leaves the current video output
unchanged. If a tab, block, or source line is removed, its stale position and
Text-derived live state are cleared; Video Lyrics then falls back to the active
Text tab until a valid prompter position arrives.

## Successful Output

- In standalone mode, the control window shows the ordered lineup, the selected
  song's cue rows, the live cue highlight, and a 16:9 preview. The three
  column shells share a fixed height; only the middle cue list scrolls. Long
  lineups use pagination.
  Cue changes center the highlighted row within the cue container, clamped near
  the beginning and end. Appearance updates preserve cue scroll position.
- In standalone mode, cue selection is immediate. Only the selected live lyric
  is rendered in the output popup; adjacent prepared cues are not shown there.
- The audience popup has no workspace controls and is sized initially at
  1280×720. The video is muted, loops, and remains active while lyrics change.
- The song title is cue 1; lyric lines follow it. Cue boundaries follow source
  line breaks, with blank lines omitted and retained as section breaks.
- Appearance updates apply across every song in the current lineup and are
  mirrored in the preview and popup. This includes vertical pixel position,
  fade duration, and video playback speed. Settings exist in page memory and
  reset on reload.
- With Sync enabled in the Text Lyrics workspace, the editor and its two
  horizontal preview rows use the responsive layout described above. The
  output windows remain separate.
- A lineup entry's pencil opens its temporary title/body editor. Saving changes
  only that instance, even when the same library song appears twice. It never
  writes to the song library or admin. Editing a live instance refreshes its
  current cue immediately; indices clamp if lines were removed. Cancelling
  leaves the instance unchanged.
- The lineup, current cue, and custom-file selection exist in page memory.
  Successfully saved catalogue Blobs may be reused from IndexedDB in this
  browser, subject to browser storage policy. Persistence is best-effort and
  separate from Firebase Hosting's CDN cache; it is not shared between users
  or browsers.

## Handled Failures

- If the browser blocks the popup, the control panel reports that popups must
  be allowed. Reopening focuses an existing popup rather than creating another.
- If the Text prompter is not open, enabling Sync alone opens no output window;
  there is no routine Sync status message.
- If a mirrored row or cue is clicked while the Text prompter is unavailable or
  its source lineup changed, temporary feedback says the navigation could not
  be completed. This navigation does not open or focus the Text prompter.
- If the browser blocks the Video Lyrics popup during Sync or a Text send, the
  temporary Sync feedback says to allow popups. Video Lyrics also reports popup
  opening and connection state in its workspace.
- If no lyric line crosses the reading marker, Sync waits for a line and keeps
  the current Video Lyrics output unchanged.
- If the popup cannot autoplay its video, it reports the issue and exposes a
  **Start video background** button for a user gesture. Background playback
  errors use the dedicated background status surface and clear after a
  successful **Start**. Decode or selection errors appear in the chooser while
  it is open and use that same surface after it closes.
- If a catalogue video cannot download, the open chooser reports that an
  internet connection is needed. Its dialog shows status while open; after it
  closes, loading and selection errors use the dedicated background status
  surface. An empty download or unsupported media is rejected; personal files
  are checked for non-empty content and playable video before selection.
- Saving a curated background to IndexedDB is best-effort after successful
  session playback. If browser storage is unavailable, blocked, full, or
  interrupted, the save failure is silent and current playback continues;
  later offline reuse is not guaranteed.
- Invalid or stale popup messages are ignored by origin, source, channel,
  payload validation, and revision checks. Invalid appearance values are
  constrained by the model before they are sent.
- Clipboard denial leaves the editor open with instructions for direct paste.
- Invalid, oversized, or undecodable font files leave the existing font
  selected and report an error in the font dialog.
- Rapid background selections are guarded by a generation counter so an older
  asynchronous load does not replace a newer choice.

## Unhandled Issues

- **Low:** The song lineup and appearance controls are not saved across page
  reloads; operators must prepare them again.
- **Medium:** IndexedDB is best-effort browser storage. The browser can evict
  saved data or a user can clear it, and a failed save means a curated
  background may need a network fetch later. This does not make the complete
  website available offline.
- **Low:** Imported fonts and a personal video are session-only and must be selected again after
  reload. It is never uploaded or copied into the built-in catalogue.
- **Medium:** Actual OBS and vMix capture was not validated in the available
  environment. Browser QA verified popup playback and cue updates, but that
  does not establish behavior in either broadcast application.
- **Low:** Browser QA did not externally verify automatic catalogue caching or
  reuse from IndexedDB. The personal-file selection path performs a decode
  probe in code.
- **Low:** Cue split/merge editing and timestamp-based automatic advancement
  are not implemented. Cue boundaries follow the stored lyric line breaks and
  advancement is manual.

## Implementation References

- `public/modules/video-lyrics.html` — Video Lyrics panel, lineup, cues,
  preview, output controls, and appearance settings
- `public/js/features/video-lyrics/index.js` — picker integration, rendering,
  active-panel keyboard handling, settings controls, Text-owned Sync control,
  populated-block projection rows and labels, count and page updates, selected
  block fallback, row/cue navigation into Text Lyrics, position filtering,
  reading marker, and responsive preview layout
- `public/js/features/video-lyrics/model.js` — in-memory lineup, line parsing,
  standalone cue state, direct text-driven output, guards against standalone
  cue changes while Sync is active, position validation, and settings validation
- `public/js/features/editor/block-source.js` — shared Add Lyrics dialog API
  and close-after-selection behavior
- `public/js/features/editor/index.js` — Text prompter send/update behavior,
  `navigateToSourceLine` validation and cross-tab loading into the existing
  prompter without opening or focusing it, and opening the Video Lyrics popup
  after a send when Sync is on
- `public/js/features/editor/textformatting.js` and
  `public/js/features/prompter/prompter.js` — source-line markers, semantic
  reading position, `goToSourceLine` handling, and broadcasts that drive Video
  output
- `public/index.html`, `public/assets/css/index.css`, and
  `public/assets/css/video-lyrics.css` — Text workspace preview column and
  stacked Text and Video preview rows with their controls alongside
- `public/js/features/video-lyrics/output.js` — preview and popup lifecycle,
  state synchronization, message validation, and playback feedback
- `public/js/features/video-prompter/prompter.js` — audience popup receiver,
  playback recovery, and keyboard forwarding
- `public/js/features/video-lyrics/stage.js` — 16:9 rendering, video playback,
  text transitions, and payload validation
- `public/js/features/video-lyrics/local-media.js` — IndexedDB Blob cache,
  catalogue loading, and personal media decode probe
- `public/js/features/video-lyrics/backgrounds.js` — chooser, lazy default,
  catalogue caching, and session-only personal video
- `public/js/features/video-lyrics/fonts.js` and
  `public/assets/css/video-fonts.css` — allowed font families and local font
  declarations

## Validation Notes

Validation of the 2026-10-03 redesign is pending the final GPT-6 Luna test
and browser QA results. OBS/vMix capture remains unverified.
