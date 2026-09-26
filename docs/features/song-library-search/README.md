---
title: Song library search
category: frontend-search
tags: [minisearch, song-library, fuzzy-search, ranking]
---

# Song library search

The Add lyrics dialog and Admin panel share the same Firestore-backed browser
library and MiniSearch index. Firestore remains the source of truth; matching
is performed in memory after the library is loaded.

## Flow

```text
Firestore onSnapshot(lyrics)
  -> normalizeLyricsDoc
  -> song-library state
  -> MiniSearch index
  -> Add lyrics and Admin search
```

MiniSearch indexes `hymnNum`, `title`, `adaptOf`, and full `lyrics`. The Add
lyrics dialog calls `matchAllSongs()` so category filters are applied to the
complete match set before the visible result limit is applied. Selecting a
result uses the already-loaded full lyric document.

## Adaptation heading in the prompt

When an Adaptation song is selected, its prompt heading includes adaptation
metadata. If `adaptOf` and the song title match under the existing
case-insensitive, accent-sensitive comparison, the heading is `(Adaptation)`.
If they differ, it is `(Adaptation of “source title”)`. Parenthetical prompt
text is rendered in italics by `public/js/features/editor/textformatting.js`.
`public/js/library/song-model.js` builds the heading label, while
`public/js/features/editor/port.js` removes that metadata from the lyrics
preview. This heading behavior does not change the adaptation-source label
shown in search results.

## Search behavior

- Multi-word queries use AND matching.
- Prefix and fuzzy matching are enabled through shared search options.
- Title, adaptation source, and hymn-number matches rank above lyrics-body
  matches.
- Empty queries use browse ordering and result limits.
- Category filters are applied by the consuming UI.
- Revision and archived songs remain visible but are not selectable in Add
  lyrics.

## Ownership

- `public/js/library/song-model.js` — document normalization and display data
- `public/js/library/song-search.js` — MiniSearch construction, parsing, and ranking
- `public/js/library/song-library.js` — Firestore listener, local cache, and shared API
- `public/js/features/editor/block-source.js` — Add lyrics search and selection UI
- `public/js/features/admin/admin-panel.js` — Admin search and category filters

## Current read behavior

The library currently attaches a collection-wide Firestore listener. The
initial synchronization reads the collection; later updates are applied from
document changes. A local browser cache makes the interface appear faster but
does not replace the initial Firestore synchronization.

Any future read-reduction work should preserve the shared MiniSearch contract
while changing synchronization to revision checks and incremental updates.
