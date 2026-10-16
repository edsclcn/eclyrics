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

The **Sync video** switch in the Text Lyrics toolbar is off by default. The
matching **Sync to text** switch in Video Lyrics controls the same page-local
setting. Sync keeps the Text editor as the main workspace. When Sync is on and
Text Lyrics is active, the existing Video Lyrics preview appears below the
Text prompter preview in the right-hand preview column. Video Lyrics search and
lineup are not required: the source lyric line at the Text prompter's reading
marker directly becomes the live Video Lyrics output. Video appearance and
background settings remain available in the Video Lyrics workspace and apply
to the synced output.

The embedded Video Lyrics card reuses the existing Video preview card. It hides
**Open Prompter** and keeps **Blank**, the shared font picker, and **Background**.
The font trigger opens the same chooser from either workspace; detailed
appearance controls remain in Video Lyrics. The background chooser also opens
from either workspace. The card shows the selected curated or custom background
name and background loading/error status. Background and appearance changes
update the embedded preview and the open audience popup. The default background
loads only when Video Lyrics is activated or Sync/output needs video, so a
Text-only synced session does not need to visit Video Lyrics. **Blank** clears
the lyric while retaining its background. Audience popup playback errors appear
in the embedded status and clear after **Start** succeeds.

The reading marker is a subtle horizontal line over the Text prompter preview.
It defaults to the vertical midpoint, can be dragged, and supports keyboard
adjustment when focused. Its position sets where the Text prompter reads the
current lyric line; the selected position is remembered in browser storage.
Wrapped text lines remain associated with their source lyric line. Only
positions from the Text prompter lineup bound to this editor are accepted.

The Sync switch itself does not open either output window when the Text
prompter is not already open. In that state, Sync status asks the user to send
Text Lyrics. If the Text prompter is already open, enabling Sync opens or
focuses only the Video Lyrics window. Pressing **Send to prompter** opens or
updates the Text prompter and, when Sync is on, also opens or focuses the Video
Lyrics window. If the browser blocks the Video Lyrics popup, the Sync status
reports that popups must be allowed.

Turning Sync off stops text-driven updates; it does not close output windows or
clear the current Video Lyrics line. Manually cueing or advancing a line in
Video Lyrics pauses Sync and turns off both mirrored switches. With no lyric at
the reading marker, Sync waits for a line and leaves the current video output
unchanged.

## Send button state and presentation

The preview CTA is labeled **Send to prompter** and stays disabled until the
active lyrics lineup has at least one non-empty block. Text Lyrics and Image
Lyrics use the same primary button label, color treatment, and disabled state;
on desktop, the CTA is 10 rem wide and 2.5 rem high. The Image Lyrics speed
control group is aligned in height with its neighboring toolbar controls.

## Handled failures

- Short holds and pointer movement cancel without sending a block.
- Pointer cancellation, lost pointer capture, and window blur clear the timer
  and reset the progress ring.
- A removed or hidden target block is checked again at completion and is not
  sent.
- If the Text prompter is not open, enabling Sync alone opens no output window;
  its status prompts the user to send Text Lyrics.
- If the Video Lyrics popup is blocked while Sync opens it, the Sync status
  says to allow popups. The Video Lyrics panel reports popup opening and
  connection status.
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
- `public/js/features/editor/index.js` — Text prompter send/update behavior and
  opening the Video Lyrics popup after a send when Sync is on
- `public/js/features/editor/textformatting.js` and
  `public/js/features/prompter/prompter.js` — source-line markers, adjustable
  reading position, and the semantic line reported by the Text prompter
- `public/js/features/video-lyrics/index.js` and
  `public/js/features/video-lyrics/model.js` — mirrored Sync switches, paired
  preview stacking, popup behavior, position filtering, and direct text output
- `public/js/features/video-lyrics/backgrounds.js` and
  `public/js/features/video-lyrics/output.js` — lazy default background,
  shared chooser, preview/popup updates, and playback feedback
- `public/modules/text-lyrics.html`, `public/assets/css/index.css`, and
  `public/assets/css/video-lyrics.css` — right-column previews and reading marker
