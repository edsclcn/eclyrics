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

## Unhandled issues

None identified in the hold-send flow described above.

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
