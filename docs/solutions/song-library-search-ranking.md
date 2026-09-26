---
title: Song library search ranking and Admin exact phrases
category: frontend-search
tags: [minisearch, song-library, fuzzy-search, ranking]
date: 2026-07-08
---

# Song library search ranking and Admin exact phrases

## Problem

Multi-word Admin and Add lyrics searches could expand results instead of
narrowing them. Title matches were not prioritized over lyrics-only matches.

## Resolution

Search policy is centralized in the browser library search module:

1. Shared search options use AND matching, fuzzy matching, and field boosts.
2. Shared query parsing supports terms and quoted phrases for narrowing.
3. Field-match scoring keeps title and adaptation-source matches above broad
   lyrics-body matches.
4. Admin search adds a separate exact mode when the complete query is wrapped
   in ASCII or smart double quotes. It checks contiguous, case-insensitive text
   in the title, adaptation source, hymn number, and lyrics, returning every match.
   Query apostrophes are normalized to the app's smart apostrophe first.
5. Unquoted Admin queries and Add lyrics/shared search retain the shared search
   behavior; exact mode is Admin-only.

## Verification

- `sinisigaw ng pangalan` returns no more results than `sinisigaw`.
- Title matches rank above lyrics-only matches.
- Admin exact phrases require a contiguous match and include spacing and
  punctuation.
- Add lyrics and unquoted Admin search use the shared in-memory index.

## Files

- `public/js/library/song-search.js` — matching, parsing, and ranking helpers
- `public/js/library/song-library.js` — Firestore listener and shared index
- `public/js/features/editor/smart-quotes.js` — apostrophe normalization used
  by exact Admin queries
- `public/js/features/editor/block-source.js` — Add lyrics rendering
- `public/js/features/admin/admin-panel.js` — Admin rendering
