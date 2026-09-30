---
title: Song library search
category: frontend-search
tags: [minisearch, song-library, fuzzy-search, ranking]
---

# Song library search

The Add lyrics dialog and Admin panel use the same Firestore-backed browser
library, but they use separate matching paths. Firestore remains the source of
truth; search runs against the songs already loaded in memory.

## Flow

```text
Firestore onSnapshot(lyrics)
  -> normalizeLyricsDoc
  -> song-library state
  -> Add lyrics: matchSongsForAddLyrics -> category/restricted filters -> results
  -> Admin: searchAdmin -> empty alphabetical browse, exact quoted path, or Add lyrics matcher/ranker
```

The library builds a MiniSearch index over `hymnNum`, `title`, `adaptOf`, and
`lyrics` for the shared `matchSongs()` API. Add lyrics calls
`matchSongsForAddLyrics()` and scans loaded songs with its own matcher and
ranker; it does not use MiniSearch to retrieve candidates. Admin uses
`searchAdmin()`: empty queries browse alphabetically, fully quoted queries use
literal exact matching, and all other nonempty queries use
`matchSongsForAddLyrics()` with a ten-result cap. The Add lyrics UI applies
category and restricted-song rules after matching, then displays up to ten
results for a query or twenty while browsing. Selecting a result uses the
already-loaded full lyric document.

## Add lyrics matching and ranking

- Every query component must match somewhere in the song (AND). Unquoted terms
  may match different fields among title, adaptation source, hymn number, and
  lyrics.
- A phrase in straight double quotes must match a contiguous sequence of word
  tokens in one field. It cannot span fields. Punctuation joining adjacent
  words is compacted for unquoted terms and quoted phrases: `sayo` matches
  `Sa 'Yo` and `Sa-yo`; `"sayo"` also matches both forms. Whitespace alone
  keeps words separate, so `sayo` and `"sayo"` do not match `Sa yo`, while
  `"sa yo"` matches those two adjacent words. Admin unquoted and mixed queries
  use this same Add lyrics matcher. Fully quoted Admin exact search remains
  literal and punctuation-sensitive, so `"sayo"` does not match `Sa 'Yo` or
  `Sa-yo`.
- Results are grouped by whole-query relevance, in this order: all components
  match the title without fuzzy matching; the complete ordered query matches
  contiguously in lyrics; all components match without fuzzy matching in one
  field; then scattered or fuzzy matches. Within a tier, exact word matches
  rank above prefixes, and prefixes rank above fuzzy matches. Field match
  quality further orders results within each tier.
- Matching is against whole normalized words, with prefix matching allowed.
  Arbitrary infix matches are not accepted. Adjacent transposition of two
  letters is accepted. Levenshtein typo tolerance is disabled for terms under
  three characters, allows one edit for terms of 3–9 characters, and up to two
  edits for terms of 10 or more characters.
- If a query is fully satisfied by the title without fuzzy matching, the row
  keeps the plain opening lyric preview. Otherwise, when lyrics contain a
  matching ordered query, quoted phrase, or best matching word, the preview
  centers an excerpt on that occurrence and subtly highlights the matched lyric
  text. For typo matches, the highlight shows the spelling from the lyrics.
  Metadata-only matches fall back to the opening preview.
- Revision and archived songs remain visible but are not selectable in Add
  lyrics. Category filters are applied by the dialog.

## Admin and shared search behavior

- In Admin search, enclose the complete query in ASCII (`"phrase"`) or smart
  (`“phrase”`) double quotes to use its separate exact phrase mode. It checks
  literal, case-insensitive text in `title`, `adaptOf`, `hymnNum`, and `lyrics`,
  normalizing query apostrophes with the smart-quotes helper. Results use
  Admin's alphabetical order and are not limited to ten.
- Unquoted queries and mixed queries that are not fully wrapped in quotes use
  `matchSongsForAddLyrics()` and its matching, ranking, and typo rules, capped
  at ten results. For these nonempty queries, Admin rows use the Add lyrics
  preview behavior: title-complete matches keep the plain opening preview;
  otherwise, an excerpt centers on an actual lyric match and subtly highlights
  the matched text, using the lyrics' spelling for typo matches. Metadata-only
  matches fall back to the opening preview.
- An empty Admin query lists songs in alphabetical order. Its rows use the
  opening lyric preview.
- For a fully quoted exact Admin query, a title exact match keeps the plain
  opening preview. If the title is not the exact match but the literal phrase
  occurs in lyrics, Admin centers the excerpt on that lyric occurrence and
  highlights it. An exact match in another metadata field without a lyric
  occurrence uses the opening preview.
- The shared `matchSongs()` API remains on MiniSearch candidate retrieval and
  its existing shared matcher/ranker. This path is separate from Add lyrics and
  unquoted Admin search.

For the exact phrase path, the Admin input handler calls `renderSearchResults()`
in `public/js/features/admin/admin-panel.js`, which calls `searchAdmin()` through
`public/js/library/song-library.js`. The exact phrase check and alphabetical
sort are in `public/js/library/song-search.js`. If there are no visible matches,
the Admin panel displays “No songs match your search.”

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

## Ownership

- `public/js/library/song-model.js` — document normalization and display data
- `public/js/library/song-search.js` — MiniSearch/shared search, Add lyrics
  matching and ranking, and lyric search previews
- `public/js/library/song-library.js` — Firestore listener, local cache, and
  search API routing
- `public/js/features/editor/block-source.js` — Add lyrics filters, result
  display, preview, and selection UI
- `public/js/features/admin/admin-panel.js` — Admin search, category filters,
  and query-centered lyric previews

## Current read behavior

The library currently attaches a collection-wide Firestore listener. The
initial synchronization reads the collection; later updates are applied from
document changes. A local browser cache makes the interface appear faster but
does not replace the initial Firestore synchronization.

Any future read-reduction work should preserve the shared MiniSearch contract
while changing synchronization to revision checks and incremental updates.
