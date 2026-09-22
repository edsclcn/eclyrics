---
title: Song library search ranking and phrase narrowing
category: frontend-search
tags: [minisearch, song-library, fuzzy-search, ranking]
date: 2026-07-08
---

# Song library search ranking and phrase narrowing

## Problem

Multi-word Admin and Add lyrics searches could expand results instead of
narrowing them. Title matches were not prioritized over lyrics-only matches.

## Resolution

Search policy is centralized in the browser library search module:

1. Shared search options use AND matching, fuzzy matching, and field boosts.
2. Query parsing supports terms and quoted phrases.
3. Field-match scoring keeps title and adaptation-source matches above broad
   lyrics-body matches.
4. The same matcher powers Admin search and Add lyrics search.

## Verification

- `sinisigaw ng pangalan` returns no more results than `sinisigaw`.
- Title matches rank above lyrics-only matches.
- Quoted phrases require a contiguous match.
- Add lyrics and Admin search use the same in-memory index.

## Files

- `public/js/library/song-search.js` — matching, parsing, and ranking helpers
- `public/js/library/song-library.js` — Firestore listener and shared index
- `public/js/features/editor/block-source.js` — Add lyrics rendering
- `public/js/features/admin/admin-panel.js` — Admin rendering
