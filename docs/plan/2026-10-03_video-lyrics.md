# Video Lyrics — implementation record

Status: implemented on `feat/video-lyrics`. This record reflects the implemented
website-first scope; it is not a deployment record. Electron support is deferred.
See the [feature guide](../features/video-lyrics/README.md) for the operator
flow and [shared-picker fix](../solutions/ui-bugs/shared-add-lyrics-picker-video-lyrics-20261003.md)
for the Add Lyrics dialog correction.

## Confirmed behavior

- Video Lyrics is the `/video-lyrics` workspace panel. It prepares an ordered,
  in-memory song lineup and advances cues manually with Up/Down, cue-row
  clicks, or the previous/next controls.
- A song title is its first cue. Stored lyric lines follow; blank lines are
  omitted and separate visual sections.
- The control panel shows Spotify-style cue emphasis and a 16:9 preview. The
  separate audience popup displays only the live cue over the looping video.
  It is intended for OBS/vMix capture; those applications were not tested.
- Font family, weight, maximum size, text color, alignment, fade, and dimming apply to the whole
  lineup. Satoshi is the default, with locally bundled font alternatives and
  source/license notices.
- The centered background dialog shows Background 1 (the bundled sample),
  disabled Background 2–4 placeholders, and **Add your own video** last.
- A selected personal video is decode-checked, held for the page session, and
  not uploaded. Cue split/merge editing and timestamp-based advancement are
  deferred.
- The three column shells have equal fixed height. Only the middle cue list
  scrolls and centers the active cue within its bounds; long lineups paginate.
- Shared Add Lyrics supports library search, manual entry, and paste. Pencil
  edits affect one temporary lineup instance, including its live cue, without
  changing library/admin data.
- The alphabetical actual-face font picker supports search and category
  filtering. The 17 requested families include bundled EB Garamond under the
  Garamond label and device-only Times New Roman. Custom fonts are decoded,
  limited to 10 MB, and session-only; personal videos support select or drop.

## Background storage

Curated catalogue videos automatically cache in IndexedDB on the first
Video Lyrics activation. Later activations check versioned catalogue keys and
reuse saved Blobs. A missing or unsaved item is fetched and cached. Personal
videos remain session-only.

IndexedDB belongs to a browser profile. It is not shared between devices or
users, can be evicted or cleared, and does not make the whole website available
offline. It is separate from Firebase Hosting's CDN cache. The supplied sample
is `public/assets/videos/ambient-worship.mp4`; its poster is under
`public/assets/images/video-backgrounds/`.

## Implementation and output transport

The workspace reuses the shared `#block-source-dialog` through
`eclyricsEditorBlockSource.openForSongSelection()`. The selection callback
adds one song; the shared result handler closes the dialog after that
selection. This preserves the Text Lyrics picker layout, placement, search and
filter behavior.

The workspace preview and `public/video-prompter.html` use the shared stage
renderer. They exchange cue, appearance, and background state on the dedicated
same-origin `eclyrics-video-v1` message channel, with payload validation and
revision checks. The popup can request manual cue changes by forwarding arrow
keys to its opener.

The relevant stylesheet, module fragment, bootstrap entry, and Video Lyrics
scripts carry the `20261003-video-workspace-redesign` cache version. See
[`docs/architecture.md`](../architecture.md) for script ownership and load
order.

## Validation and limits

Final GPT-6 Luna test and browser QA evidence for the redesign is pending.
OBS/vMix capture is not verified.

The implementation does not persist a lineup across reloads. Browser storage
may be cleared or evicted, after which curated backgrounds need to be fetched
again. See the feature guide's **Unhandled Issues** section for remaining
limits.
