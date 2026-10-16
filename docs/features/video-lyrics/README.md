---
name: video-lyrics
description: How the Video Lyrics workspace prepares songs, cues one lyric line, and sends it over a video background to a separate prompter window.
---

# Video Lyrics

Video Lyrics is the `/video-lyrics` workspace panel for preparing a temporary
song lineup and manually sending one lyric line at a time to a separate 16:9
output popup. The control panel keeps the prepared cue list and preview; the
audience output shows only the live line over a muted looping video.

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
4. Click a cue row, press **Down**/**Up**, or use the previous/next controls to
   cue a line. This immediately makes that line live and updates the preview.
   Arrow keys work while the Video Lyrics panel is active, except when focus is
   in an input, select, editable element, or open dialog. The output popup also
   forwards its Up/Down keys to the control window.
5. Set appearance for the whole lineup: font family, weight, size, text color,
   alignment, fade duration, and background dimming. Defaults are Satoshi, bold,
   120 px, white, centered, 400 ms, and 30% background dimming. Size changes in
   5 px increments and fade changes in 50 ms increments. The font size is a maximum:
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
   saved to this browser's IndexedDB under its catalogue ID/version key; the
   full catalogue is not downloaded or saved up front.
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
   (0–2000 ms); reduced-motion preference sets the transition to zero. Video
   playback continues as cues change.

## Optional Text Lyrics sync

Sync is off by default, so Text Lyrics and Video Lyrics keep their existing
separate workspaces and previews until an operator enables it. The
**Sync to text** switch here mirrors the **Sync video** switch in Text Lyrics.
Sync follows the source lyric line shown at the reading marker in the Text
prompter and sends that line directly to the Video Lyrics stage. It does not
search the Video Lyrics library or require a prepared Video Lyrics lineup.
Text Lyrics remains the main editing workspace. When it is active and Sync is
on, its existing right-hand preview column shows the Text and Video previews
stacked vertically. Video Lyrics search, lineup, and cue controls remain in the
Video Lyrics workspace for manual prompting. Its appearance and background
settings also apply to text-driven output.

The subtle horizontal reading marker appears over the Text prompter preview
while Sync is on. It defaults to the vertical midpoint, can be dragged, and can
be adjusted from the keyboard when focused. Its position sets the reading point
used to select the source lyric line. The marker position is remembered in
browser storage. Text prompter messages include the line text and source-line
index; Video Lyrics accepts them only from the Text prompter lineup bound to
this editor.

In Text Lyrics Sync, the existing Video preview card moves into the Text
workspace and hides **Open Prompter**. It keeps **Blank**, the same single font
picker trigger, and **Background**; detailed appearance controls remain here.
The shared font chooser and background dialog are available from either
workspace. The embedded card shows the selected curated or custom background
name and background loading/error status. Background and appearance changes
update the preview and audience popup. **Blank** clears the live lyric but
keeps the selected background. Audience popup playback errors appear in the
embedded status and clear after **Start** succeeds.

The Sync switch alone opens no windows if the Text prompter is not already
open; its status asks the user to send Text Lyrics. If Text output is already
open, enabling Sync opens or focuses only the Video Lyrics window. Pressing
**Send to prompter** opens or updates the Text prompter and, when Sync is on,
also opens or focuses the Video Lyrics window. If the browser blocks that Video
popup, the visible Sync status says to allow popups.

Turning Sync off stops text-driven updates without closing output windows or
clearing the current Video Lyrics line. Manually selecting or advancing a
Video Lyrics cue pauses Sync and turns off both mirrored switches. When no
lyric line crosses the reading marker, Sync waits for a line and leaves the
current video output unchanged.

## Successful Output

- The control window shows the ordered lineup, the selected song's cue rows,
  the live cue highlight, and a 16:9 preview. The three column shells share
  a fixed height; only the middle cue list scrolls. Long lineups use pagination.
  Cue changes center the highlighted row within the cue container, clamped near
  the beginning and end. Appearance updates preserve cue scroll position.
- Cue selection is immediate. Only the selected live lyric is rendered in the
  output popup; adjacent prepared cues are not shown there.
- The audience popup has no workspace controls and is sized initially at
  1280×720. The video is muted, loops, and remains active while lyrics change.
- The song title is cue 1; lyric lines follow it. Cue boundaries follow source
  line breaks, with blank lines omitted and retained as section breaks.
- Appearance updates apply across every song in the current lineup and are
  mirrored in the preview and popup.
- With Sync enabled in the Text Lyrics workspace, its Text and Video previews
  appear stacked in the existing right-hand preview column; the Text editor
  remains the main workspace. The output windows remain separate.
- A lineup entry's pencil opens its temporary title/body editor. Saving changes
  only that instance, even when the same library song appears twice. It never
  writes to the song library or admin. Editing a live instance refreshes its
  current cue immediately; indices clamp if lines were removed. Cancelling
  leaves the instance unchanged.
- The lineup, current cue, and custom-file selection exist in page memory.
  Catalogue Blobs saved to IndexedDB persist per browser subject to browser
  storage policy. This browser cache is separate from Firebase Hosting's CDN
  cache and is not shared between users or browsers.

## Handled Failures

- If the browser blocks the popup, the control panel reports that popups must
  be allowed. Reopening focuses an existing popup rather than creating another.
- If the Text prompter is not open, enabling Sync alone opens no output window;
  the Sync status asks the operator to send Text Lyrics first.
- If the browser blocks the Video Lyrics popup during Sync or a Text send, the
  visible Sync status says to allow popups. Video Lyrics also reports popup
  opening and connection state in its workspace.
- If no lyric line crosses the reading marker, Sync waits for a line and keeps
  the current Video Lyrics output unchanged.
- If the popup cannot autoplay its video, it reports the issue and exposes a
  **Start video background** button for a user gesture. Background playback
  errors appear in the embedded preview status and clear after a successful
  **Start**; decode or playback errors are also reported to the control panel.
- If a catalogue video cannot download, the chooser reports that an internet
  connection is needed. An empty download or unsupported media is rejected;
  personal files are checked for non-empty content and playable video before
  selection.
- The automatic catalogue cache reports a save failure in the control panel.
  Session playback can still use a loaded video when persistent browser
  storage is unavailable.
- If IndexedDB is unavailable, blocked by another tab, full, or interrupted,
  save status reports that storage failed while session playback remains
  available when the media can load.
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
- **Medium:** IndexedDB is persistent best-effort browser storage. The browser
  can evict it or a user can clear it; curated backgrounds will be fetched and
  cached again automatically on a later Video Lyrics activation. This does not
  make the complete website available offline.
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
  active-panel keyboard handling, settings controls, mirrored Sync switches,
  position filtering, reading marker, and stacked preview layout
- `public/js/features/video-lyrics/model.js` — in-memory lineup, line parsing,
  manual cue state, direct text-driven output, Sync pause behavior, and settings
  validation
- `public/js/features/editor/block-source.js` — shared Add Lyrics dialog API
  and close-after-selection behavior
- `public/js/features/editor/index.js` — Text prompter send/update behavior and
  opening the Video Lyrics popup after a send when Sync is on
- `public/js/features/editor/textformatting.js` and
  `public/js/features/prompter/prompter.js` — source-line markers and semantic
  reading position at the Text prompter midpoint
- `public/index.html`, `public/assets/css/index.css`, and
  `public/assets/css/video-lyrics.css` — Text workspace preview column and
  vertical Text/Video preview layout
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
