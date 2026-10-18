---
name: text-lyrics-prompter
description: How text lyric blocks are sent to the prompter from the Text Lyrics workspace.
---

# Text Lyrics prompter send

## Step-by-step flow

1. The user presses and holds the primary pointer button on a visible,
   non-empty Text Lyrics block. The pointer handler is registered on
   `#tab-content` in `public/js/features/editor/index.js`.
2. A 600 ms hold timer starts. After 140 ms, an 18 px ring appears at the
   block's lower-right corner and fills for the remainder of the hold
   (`.textarea-send-hold-indicator` in `public/assets/css/index.css`).
3. If the hold completes without cancellation, the editor sends that block to
   the text prompter through `sendTextareaToPrompter()` and `sendPrompt()`.
4. The toolbar **Send to prompter** button remains a native button. It sends the
   selected text block on click and supports keyboard activation through the
   browser's normal button behavior.

Releasing before 600 ms, moving the pointer more than 8 px, receiving
`pointercancel` or `lostpointercapture`, or blurring the window cancels the hold
and resets the ring. At completion the editor rechecks that the same held text
block is still connected and visible; otherwise it is not sent.

## Successful output

The specific visible, non-empty text block under the pointer is sent to the Text
Lyrics prompter. Its lower-right 18 px ring provides hold progress; the ring is
hidden from assistive technology because it is decorative.

## Optional Text and Video Lyrics sync

The **Sync video** switch beside the Text preview is the only Sync toggle
and is off by default. When enabled, each populated lyric block across all Text
Lyrics tabs projects one-way as a mirrored Video Lyrics lineup row, in tab
order and then block order. Empty placeholders are excluded, the lineup count
reflects populated blocks, and each row label combines the Text tab name and
block title. Adding, removing, renaming, or editing a tab or block, and changing
the active Text tab or selected block, refreshes the projection, including while
the Video Lyrics workspace is already selected. With no bound prompter position,
the selected populated block in the active Text tab is used, falling back to
that tab's first populated block when the selected block is empty. A position
from the Text prompter bound to any listed tab selects its matching tab and
block even when the source-line index is null; only an exact live source line is
highlighted. The Video lineup page follows the selected block. Clicking a
mirrored row seeks the Text prompter to that block's first populated source
line; clicking one of its source-line cues seeks that exact line. If the target
is on another tab, the target lineup loads into the already-open Text prompter
without opening or focusing it. Text Lyrics remains the source of truth and
Video Lyrics does not edit its content; Video output follows the position
broadcast by the Text prompter. Stale positions whose tab, block, or source line
was removed are ignored. With Sync off, Video Lyrics restores its
standalone lineup and prepared item while leaving the already-live output in
place. Sync keeps the Text editor as the main workspace. When Sync is on and
Text Lyrics is active, the wide layout gives the editor the left third and uses
the right two thirds for two stacked horizontal preview rows. In the upper row,
the Text preview stage is on the left and its prompter controls are on the right.
The labeled **Send to prompter** action occupies a full-width row at the top of
the Text control rail so it remains visible. Transport/navigation and scroll
controls follow in a separate group, with text sizing, line width, and speed
below. In the lower row, the Video preview stage is on the left and its Video
controls and Appearance settings are on the right. The embedded Video actions
(**Blank**, font, and **Background**) use the same button height and corner
radius as the Text toolbar controls; Appearance follows directly below. At
medium widths, the editor moves above both full-width preview rows. At narrow
widths, the editor moves above the preview rows while each stage stays paired
with its controls. The mirrored Text tabs do not need a separate Video Lyrics
search or preparation step.

In the synced workspace, the editor shows two lyric blocks per row. The Sync
switch stays beside the Text preview heading, separate from transient feedback,
so routine state changes do not move it. Enabling Sync automatically shows the
embedded Video preview and its full controls; turning Sync off hides that
embedded panel and restores the standalone Video Lyrics inspector.

The embedded Video controls use the same page-session settings as the standalone
Video Lyrics workspace and audience output. Text remains horizontally centered.
The Fade duration slider gets the wider column in its control row, while the
Vertical position value and **px** unit stay grouped at the right edge.
Vertical position uses a pixel anchor from 0–1080 px in 10 px steps (default
540 px): 0 aligns the lyric box to the top, 540 centers it, and 1080 aligns it
to the bottom. The box stays inside the stage at the endpoints. Fade duration
ranges from 0–2000 ms in 100 ms steps (default 400 ms), with a slider and
editable millisecond value; video playback speed ranges
from 0.5×–2.0× in 0.1× steps (default 1.0×). Changing these controls updates
the embedded preview and Video output; the settings reset when the page reloads.

The embedded Video Lyrics card reuses the existing Video preview card and
appearance controls. It hides **Open Prompter** and keeps **Blank**, the font
picker, **Background**, and the full appearance settings: weight, size, text
color and hex value, vertical pixel position, fade duration, and background dimming. The font
picker and background chooser are the same controls used in the Video Lyrics
workspace. The selected curated or custom background name remains visible;
repetitive success messages are suppressed while loading and error feedback
remain available. Background and appearance changes update the embedded preview
and the open audience popup. The default background loads only when Video
Lyrics is activated or Sync/output needs video, so a Text-only synced session
does not need to visit Video Lyrics. **Blank** clears the lyric while retaining
its background. Audience popup playback errors appear as transient feedback and
clear after **Start** succeeds.

The reading marker is a subtle horizontal line over the Text prompter preview.
It defaults to the vertical midpoint, can be dragged, and supports keyboard
adjustment when focused. Its position sets where the Text prompter reads the
current lyric line; the selected position is remembered in browser storage.
Wrapped text lines remain associated with their source lyric line. Only
positions from the Text prompter lineup bound to this editor are accepted, and
Video Lyrics validates the tab, block, and source line against the current
projection before following it. If a source tab, block, or line is removed, its
stale position and Text-derived live state are cleared. When no lyric line
crosses the marker, the current video output remains unchanged until a valid
position arrives.

The Sync switch itself does not open either output window when the Text
prompter is not already open. If the Text prompter is already open, enabling
Sync opens or focuses only the Video Lyrics window. Pressing **Send to
prompter** opens or updates the Text prompter and, when Sync is on, also opens
or focuses the Video Lyrics window. Routine Sync state has no changing status
text; if the browser blocks the Video Lyrics popup, temporary feedback says to
allow popups.

Turning Sync off stops text-driven updates and restores the independent Video
Lyrics lineup and cue controls; it does not close output windows or clear the
current Video Lyrics line. While Sync is on, Video lineup and cue clicks seek
the Text prompter rather than editing Text content. The Text prompter broadcasts
its resulting position, which drives Video output. With no lyric at the reading
marker, Sync waits for a line and leaves the current video output unchanged.

## Send button state and presentation

The preview CTA is labeled **Send to prompter** and stays disabled until the
active lyrics lineup has at least one non-empty block. Text Lyrics and Image
Lyrics use the same primary button label, color treatment, and disabled state.
In the synced Text layout, the CTA spans the Text control rail above the
transport/navigation group. The Image Lyrics speed control group is aligned in
height with its neighboring toolbar controls.

## Handled failures

- Short holds and pointer movement cancel without sending a block.
- Pointer cancellation, lost pointer capture, and window blur clear the timer
  and reset the progress ring.
- A removed or hidden target block is checked again at completion and is not
  sent.
- If the Video Lyrics popup is blocked while Sync opens it, temporary feedback
  says to allow popups. Normal Sync state changes do not display status text.
- If a mirrored row or cue is clicked while the Text prompter is closed, or its
  source lineup has changed, temporary feedback reports that navigation could
  not be completed. Video Lyrics does not open or focus the Text prompter.
- If no lyric line crosses the reading marker, Sync waits for a line and keeps
  the current Video Lyrics output unchanged.

## Unhandled issues

None identified in the current Text-to-Video Lyrics sync flow.

## Shortcuts and send behavior

Text Lyrics no longer uses the Backquote (`) key to send a block. Its toolbar
Send button remains available to keyboard users. The Backquote send shortcut
belongs to Image Lyrics only: `public/js/features/image-lyrics/index.js` handles
it while the Image Lyrics panel is active, and the Image Lyrics shortcut list
is documented in [Image Lyrics](../image-lyrics/README.md). It does not trigger
Text Lyrics sending. Both panels support hold-to-send, but the target is
panel-specific: Text Lyrics sends the visible text block under the pointer;
Image Lyrics sends the populated image block under the pointer to its separate
image prompter.

## Implementation references

- `public/js/features/editor/index.js` — 600 ms hold, 140 ms indicator delay,
  cancellation, toolbar click handler, and Text Lyrics sending
- `public/index.html` — native toolbar Send button
- `public/assets/css/index.css` — 18 px lower-right hold ring
- `public/js/features/image-lyrics/index.js` — Image Lyrics Backquote handler
- `public/js/features/editor/index.js` — Text prompter send/update behavior,
  all-tab and selected-block projection publication, source-line navigation
  into the already-open Text prompter, and opening the Video Lyrics popup after
  a send when Sync is on
- `public/js/features/editor/textformatting.js` and
  `public/js/features/prompter/prompter.js` — source-line markers, adjustable
  reading position, `goToSourceLine` handling, and the position broadcast that
  drives Video output
- `public/js/features/video-lyrics/index.js` and
  `public/js/features/video-lyrics/model.js` — Text-owned Sync toggle,
  populated-block lineup rows, selected-block fallback, row/cue navigation,
  responsive preview layout, popup behavior, position filtering, and direct
  text output
- `public/js/features/video-lyrics/backgrounds.js` and
  `public/js/features/video-lyrics/output.js` — lazy default background,
  shared chooser, preview/popup updates, and playback feedback
- `public/modules/text-lyrics.html`, `public/assets/css/index.css`, and
  `public/assets/css/video-lyrics.css` — heading toggle, two-block synced rows,
  aligned preview stages, embedded Video inspector, and reading marker
