---
title: Song library search ranking and Admin exact phrases
category: frontend-search
tags: [song-library, add-lyrics, fuzzy-search, ranking]
date: 2026-07-08
---

# Song library search ranking and Admin exact phrases

## Problem

Add lyrics needed relevance ordering that reflected the whole query, typo
matching that stayed close to individual words, and lyric previews that showed
why a song matched. Admin also needed to use this relevance behavior for
nonempty queries while keeping its literal exact mode for fully quoted queries.

## Resolution

Add lyrics is routed through `matchSongsForAddLyrics()` in
`public/js/library/song-search.js`. It matches and ranks the loaded songs
directly; it does not use MiniSearch candidate retrieval. Every query component
must match somewhere in the song, while unquoted terms may match across fields.
Quoted phrases must match a contiguous sequence of word tokens in a single
field. Both unquoted terms and quoted phrases compact hyphen/dash punctuation
inside compounds: `pagibig` can match `Pag-ibig`; `"pagibig mong wagas"` can
match `Pag-ibig Mong Wagas`. Admin unquoted and mixed queries use these same
rules. Fully quoted Admin exact search preserves literal punctuation;
`"pagibig"` does not match `Pag-ibig`.

The Add lyrics ranker uses these relevance tiers:

1. Every query component matches the title without fuzzy matching.
2. The complete ordered query matches contiguously in the lyrics.
3. Every query component matches without fuzzy matching in one field.
4. Scattered matches and matches requiring fuzzy matching.

Within a tier, exact word matches rank above prefixes, and prefixes rank above
fuzzy matches. Matching uses whole normalized words; it does not accept an
arbitrary infix within a word. Adjacent transposition is accepted. Levenshtein
distance allows one edit for terms of 3–9 characters and up to two edits for
terms of 10 or more characters; terms shorter than three characters get no
Levenshtein tolerance. Exact matches, prefixes, and fuzzy matches receive
different match qualities, so close matches do not outrank exact ones.

If the query is completely matched in the title without fuzzy matching, the row
uses the plain opening lyric preview. Otherwise, the preview searches lyrics
for the complete ordered query, then a quoted phrase, then the best matching
word, and centers an excerpt on the first applicable match. It subtly highlights
the matched lyric text; for typo matches, the highlight uses the actual spelling
in the lyrics. Metadata-only matches use the opening preview.

Admin's exact quoted path remains separate: a complete ASCII- or smart-quoted
query is checked as literal case-insensitive text in the song fields and sorted
alphabetically without the ten-result cap. Empty Admin queries browse in
alphabetical order. All other nonempty Admin queries, including queries that
mix quoted and unquoted components without wrapping the full query in quotes,
use `matchSongsForAddLyrics()` and are capped at ten results. Admin rows use a
query-centered lyric excerpt for nonempty queries and the opening lyric preview
while browsing. For a fully quoted exact Admin query, a title exact match keeps
the opening preview; otherwise, an exact literal occurrence in lyrics is
centered and highlighted. Metadata-only exact matches without a lyric occurrence
use the opening preview. The shared `matchSongs()` API retains MiniSearch
candidate retrieval and its existing matching and ranking behavior.

## Verification criteria

- A complete title match ranks ahead of a lyric-only match.
- A contiguous ordered lyric phrase ranks ahead of scattered term matches.
- All non-fuzzy components in one field rank ahead of equivalent scattered or
  fuzzy matches.
- Exact word matches rank above prefixes, which rank above typo matches.
- A one-character insertion, deletion, or substitution in a 3–9 character word
  can match; a term under three characters gets no Levenshtein typo allowance.
- An adjacent transposition can match. A distant spelling does not match merely
  because it contains the query as an infix.
- Lyric matches show an excerpt around the matching text; metadata-only matches
  retain the opening preview.
- Fully quoted Admin exact search remains literal and separate from Add lyrics
  ranking.
- Unquoted and mixed Admin queries use Add lyrics matching and ranking; empty
  Admin browse is alphabetical.
- Nonempty Admin rows show query-centered lyric excerpts; browse rows show the
  opening preview.
- Complete title matches use the plain opening preview. Lyric matches are
  highlighted with the actual lyric spelling, including typo matches.
- Fully quoted Admin exact matches highlight a literal lyric occurrence only
  when the title is not the exact match.

## Files

- `public/js/library/song-search.js` — Add lyrics matcher, typo quality, ranking,
  preview extraction, and the separate shared/Admin paths
- `public/js/library/song-library.js` — routes Add lyrics `matchAllSongs()` to
  `matchSongsForAddLyrics()`
- `public/js/features/editor/block-source.js` — Add lyrics result filtering and
  query-centered preview rendering
- `public/js/features/admin/admin-panel.js` — Admin search, result rendering,
  and query-centered lyric previews

See also: [Song library search](../features/song-library-search/README.md).
