---
module: Video Lyrics
date: 2026-10-03
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - "Video Lyrics displayed redundant controls for adding songs to the lineup."
  - "Its song picker differed in placement and presentation from Text Lyrics Add Lyrics."
  - "Selecting a song left the picker open so additional songs could be added from one opening."
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags: [video-lyrics, add-lyrics, shared-dialog, picker]
---

# Reuse the shared Add Lyrics picker in Video Lyrics

## Problem

Video Lyrics had separate add-song affordances and a picker that did not match
the existing Text Lyrics dialog. Selecting a result also allowed another
selection without reopening the dialog.

## Environment

- Module: Video Lyrics
- Affected component: shared browser song picker
- Date: 2026-10-03

## Symptoms

- The empty lineup showed both a plus button and an **Add songs** button.
- The Video Lyrics search UI opened in a different position and had different
  presentation from the Text Lyrics Add Lyrics dialog.
- A single picker opening could add multiple songs.

## What Didn't Work

**Direct solution:** The issue was addressed by connecting Video Lyrics to the
existing picker API rather than maintaining a separate song search surface.

## Solution

`public/js/features/video-lyrics/index.js` calls
`window.eclyricsEditorBlockSource.openForSongSelection()` for the shared
`#block-source-dialog` in `public/index.html`. The optional `onManualType` and `onPasteLyrics` callbacks open the Video
Lyrics instance editor while preserving Text Lyrics' existing textarea paths.
Do not hide those shared options with feature CSS. The result
selection callback adds the chosen song; `block-source.js` runs its common
`close()` path after the callback, so the dialog closes after one selection.
Keep one add-song entry point in the Video Lyrics lineup.

## Why This Works

The shared API owns dialog layout, focus, search, filters, and close behavior.
Video Lyrics supplies selection and optional manual/paste callbacks plus a
mode-specific title, so
the picker stays consistent with Text Lyrics while each selected song starts a
new add action after the dialog closes.

## Prevention

- Use `openForSongSelection()` when a feature needs a library song-selection
  dialog instead of recreating the search UI.
- Add UI flows through the shared dialog's existing result-selection path so
  close and focus restoration remain consistent.
- Keep one visible control for the same add action.
- Mount native instance dialogs inside the panel fragment: the workspace loader
  appends the selected panel root, so sibling dialogs would be discarded.
- Keep instance editing in the temporary model; do not reuse admin save paths.

## Related Issues

No related issues documented yet.
