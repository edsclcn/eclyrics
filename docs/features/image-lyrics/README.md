---
name: image-lyrics
description: Explains how image uploads are arranged into lineups, previewed, and sent to the isolated image prompter.
---

# Image Lyrics

Image Lyrics displays uploaded images as prompter content. It has its own editor state, popup page, and message types; it does not use the text editor’s lyric blocks or text prompter protocol.

Images remain in browser memory while the page is open. Use **Save image lineup JSON** to download a lineup before leaving or reloading the page. Image Lyrics does not save images or lineup data to Firestore.

## Step-by-step flow

1. Open **Image Lyrics** from the app navigation. The workspace in `public/index.html` starts with one lineup tab and two empty image blocks.
2. Add an image using an empty block’s file picker or by dropping a file onto it. The picker accepts `image/*`; a non-image file dropped into a block is rejected with a status message. Once filled, a block cannot accept another image until its **X** control clears the current image. Filled blocks display the uploaded filename as their title. The editor keeps each selected `File` in JavaScript state and creates a temporary object URL for its thumbnail and preview (`public/js/features/image-lyrics/index.js`).
3. Select a block to show its image in the workspace preview. New tabs start with two empty blocks. Adding an image to the last block appends an empty block. The **X** on a filled block clears its image; the **X** on an empty block removes that block. A tab keeps at least one block. Blocks use a 16:9 layout, with two blocks per row on wider screens and one per row on narrow mobile screens. Tabs can be added up to a limit of ten, renamed by clicking the pencil or double-clicking the tab, and closed when more than one exists. Press **Enter** or leave the name field to save a nonempty name; press **Escape** to cancel.
4. Use **Save image lineup JSON** to download populated tabs and images, or **Load image lineup JSON** to replace the current lineups from an exported file. The JSON format is `eclyrics-image-lineup`, version `1`. Each populated block stores its image name, MIME type, and base64-encoded bytes. Empty blocks are omitted.
5. Select **Send to prompter** to open the separate `public/image-prompter.html` popup. The editor sends the active tab’s populated blocks, selected block position, and speed using image-specific message types. The popup reports its current block, scroll position, pause state, and speed back to the editor.
6. The scrollbar-free workspace preview mirrors the prompter’s selected image and current scroll position in its fixed 16:9 window. Wheel scrolling in the workspace preview scrolls the open prompter, or scrolls the preview locally when the popup is closed. The separate popup displays images at a logical width of 1920 pixels inside a 1920×1080 stage and preserves each image’s aspect ratio; taller images scroll vertically. Changing blocks resets scrolling to the top, while syncing or reopening a paused prompter preserves its position. The stage scales to the popup window while keeping its 16:9 shape (`public/js/features/image-prompter/prompter.js`, `public/assets/css/image-prompter.css`).

## Preview, controls, and shortcuts

The workspace preview mirrors the open prompter’s image and scroll position in real time. Its 16:9 viewport hides scrollbars; the mouse wheel scrolls both the preview and open prompter together, or scrolls the preview locally when the popup is closed. The viewer, 16:9 label, shortcut strip, and control dock use the same shared presentation classes as Text Lyrics. Controls provide sending, play/pause, previous/next populated image, manual scrolling, jump to top, and scroll speed from 0.1 to 6.5.

Image Lyrics handles shortcuts separately from the text editor (`public/js/features/image-lyrics/index.js`). Open **Keyboard shortcuts** in the Image Lyrics preview dock to see its shortcut reference. The list contains only controls implemented for Image Lyrics:

| Key | Action |
| --- | --- |
| Backtick | Open the image prompter with the active lineup |
| Space | Play or pause scrolling |
| Double-press Left / Right arrow within 400 ms | Previous / next populated image |
| Up / Down arrow | Scroll manually |
| T | Jump to the top |
| 1–9 | Set speed to the digit × 0.5 |
| 0 | Pause |
| Numpad + / − | Increase or decrease speed by 0.1 |

The popup also handles Space, arrows, T, digits 0–9, and numpad +/− when it has keyboard focus. Press the same Left or Right arrow twice within 400 ms to change images; the on-screen previous and next buttons still change images with one click. Held shortcuts are ignored after their initial keydown, except repeated ArrowUp and ArrowDown events, which continue manual scrolling in 100-pixel steps. Manual scrolling pauses automatic scrolling; automatic scrolling pauses at the end of an image.

Text-only controls such as font size, line width, and theme are not included in the Image Lyrics toolbar or shortcut list. The Image Lyrics panel stacks the editor, viewer, and blocks in the same order as Text Lyrics at the shared workspace breakpoint. On desktop, the toolbar and blocks occupy the editor column and the viewer/control dock stays in the right column, matching Text Lyrics' two-column placement.

## Image lineup file

The downloaded JSON is a manual save, not an automatic browser backup. Its top-level fields are `format`, `version`, and `tabs`. Each populated block contains `name`, `type` (an `image/*` MIME type), and `data` (base64-encoded file bytes).

Loading checks the format, version, tab count, block arrays, image MIME types, and data field before replacing the current tabs. Invalid files display an error and leave the current lineup in place. Since empty blocks are omitted, their positions are not preserved; imported images return in saved order.

## Successful output

The workspace shows the top crop of the selected image in its fixed 16:9 preview. The popup displays one full image at a time in its own 16:9 stage; images retain their proportions, and content extending beyond the stage is navigated by vertical scrolling. The editor and popup use the image-specific `eclyrics-image-prompter-*` message types; the text prompter remains on its own page and protocol.

## Implementation files

- `public/index.html` — Image Lyrics panel, tabs, block area, preview, and controls
- `public/js/features/image-lyrics/index.js` — in-memory state, picker/drop handling, JSON import/export, preview, shortcuts, and popup communication
- `public/image-prompter.html` and `public/js/features/image-prompter/prompter.js` — separate popup and image rendering/playback
- `public/assets/css/image-lyrics.css` and `public/assets/css/image-prompter.css` — workspace and popup presentation

## Handled failures

- Non-image uploads are rejected with a status message.
- Saving an empty lineup reports failure.
- Invalid lineup JSON reports an error without replacing the current tabs.
- A blocked popup produces a message asking the user to allow pop-ups.
- Missing or undisplayable images produce a message in the popup.

## Limits

- Uploaded files remain in page memory until exported. Unsaved changes are lost when the page closes or reloads.
- There is no Firestore integration or cloud backup.
- Empty block positions are not included in JSON exports.
- Images scroll vertically at the popup’s fixed logical width; image content is not converted to editable text.
