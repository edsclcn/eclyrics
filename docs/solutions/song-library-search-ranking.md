---
title: Song library search ranking and phrase narrowing
category: frontend-search
tags: [minisearch, song-library, fuzzy-search, ranking, revert]
date: 2026-07-08
---

# Song library search ranking and phrase narrowing

## Problem

Multi-word admin and Add lyrics search could **expand** results (OR matching) instead of narrowing them. Title matches were not prioritized over lyrics-only matches. Typos were only partially handled when MiniSearch was unavailable.

## Symptoms

- Adding words to a query returned **more** songs instead of fewer.
- A song matching the query only in long lyrics text ranked the same as a title match.
- Fallback search (before MiniSearch index ready) used whole-string substring match, not per-term AND.

## Root cause

`matchSongs()` on `main` called `state.searchIndex.search(q)` with MiniSearch defaults (`combineWith: 'OR'`) and no field boosts. Fallback used a single `includes(q)` check across fields.

## Resolution

Centralized search in `public/js/song-library.js`:

1. **`SEARCH_OPTIONS`** — `combineWith: 'AND'`, `fuzzy: 0.2`, field boosts (`title` highest, `lyrics` lowest).
2. **`parseSearchQuery()`** — quoted `"phrases"` require contiguous match; unquoted words are AND terms.
3. **`rankMatchedSongs()` + `computeFieldMatchScore()`** — post-rank by which field matched.
4. **Fuzzy fallback** — Levenshtein-based token match when MiniSearch is absent.
5. **`searchAdmin()`** — relevance order when querying; A–Z only for empty browse.

Shared by `search()`, `searchAdmin()`, and `matchAllSongs`.

## Verification

- `sinisigaw ng pangalan` ⊆ results of `sinisigaw` (narrowing).
- Title match for query term appears above lyrics-only match in top 10.
- `"exact phrase"` query filters to songs containing that substring.
- Revert steps documented in `docs/features/song-library-search/README.md`.

## Files

- `public/js/song-library.js` — all search logic
- `public/js/index.js` — consumes `search()` / `matchAllSongs`
- `public/js/admin-panel.js` — consumes `searchAdmin()`
