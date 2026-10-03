# Admin editor layout and input refinements

## Scope

Implement the five requested admin UI adjustments: disable spellchecking for title, version, and lyric content; make the search input's clear affordance larger and show a pointer cursor; and allocate 40% of the desktop width to library search and 60% to the editor. Keep the existing single-column responsive layout and behavior.

## Tasks

| Task | Files | Expected behavior | Dependencies | Validation |
| --- | --- | --- | --- | --- |
| Disable spellcheck on song metadata and lyrics | `public/modules/admin.html` | Add `spellcheck="false"` to `#admin-form-title`, `#admin-form-version`, and `#admin-form-lyrics`. Other inputs and browser spellchecking behavior remain unchanged. | None | Inspect rendered elements for the attribute; manually enter misspelled words in each field and confirm browser spellcheck markings/suggestions are suppressed. |
| Adjust desktop search/editor proportions | `public/assets/css/index.css` | Change `.admin-panel__layout` desktop columns to `minmax(260px, 2fr) minmax(300px, 3fr)` (40/60 where minimum widths permit). Preserve the existing `max-width: 960px` stacked layout. | None | Verify desktop computed widths at a viewport above 960px and confirm the editor is 60%; verify the existing stacked layout below the breakpoint. |
| Improve the search clear affordance | `public/assets/css/index.css` | Enlarge the native search cancel control and give it `cursor: pointer` in the supported browser engine, scoped to `.admin-search-input`. Avoid adding custom controls or JavaScript unless browser testing proves the native control cannot meet the request. | None | In Chromium, enter a query, confirm the clear affordance is visibly larger and pointer cursor appears; click it and confirm input clears and search results refresh through the existing `input` listener. Check focus styling remains intact. |

## Review notes

- This is a CSS/HTML-only change; no package or dependency updates are needed, so there is no new license risk.
- The native search cancel pseudo-element is browser-specific. The target screenshot comes from Chromium; if cross-browser parity is later required, reassess whether a custom clear button is justified.
- Keep edits scoped to the three named fields and the admin layout/search styles. No admin data-flow changes are required.
