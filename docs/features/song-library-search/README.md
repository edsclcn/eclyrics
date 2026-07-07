---
name: song-library-search
description: Song library search ranking, fuzzy matching, phrase narrowing, and revert guide for Add lyrics and Admin search.
---

# Song Library Search

Client-side full-text search over the Firestore `lyrics` collection, shared by **Add lyrics** (block source dialog) and **Admin panel** search.

## Scope

| In scope | Out of scope |
|----------|--------------|
| Query parsing, ranking, fuzzy match, result limits | Firestore query filters (all matching is in-memory via MiniSearch) |
| `public/js/song-library.js` search pipeline | Category pill filtering in UI (`index.js`, `admin-panel.js`) |
| Add lyrics + Admin search entry points | Server-side search APIs |

## Step-by-Step Flow

### 1. Library load and index build

```
Firestore onSnapshot(lyrics) -> normalizeLyricsDoc -> state.songs
  -> refreshLibraryIndex -> buildSearchIndex (MiniSearch)
```

- **Source:** `public/js/song-library.js` — `buildSearchIndex()`, `refreshLibraryIndex()`
- **Indexed fields:** `hymnNum`, `title`, `adaptOf`, `lyrics`
- **Dependency:** MiniSearch v7.1.2 loaded from CDN in `public/index.html`

### 2. User types a query

**Add lyrics (block source dialog)**

```
#block-source-search input
  -> renderBlockSourceSearchResults(query)          [index.js]
  -> eclyricsSongLibrary.search(q, limit)           [song-library.js]
  -> filterSongsByCategory + mergeRestrictedBlockSourceMatches [index.js]
```

**Admin panel**

```
#admin-search input
  -> renderSearchResults(q)                         [admin-panel.js]
  -> eclyricsSongLibrary.searchAdmin(q)             [song-library.js]
  -> category filter pills applied in admin-panel.js
```

Both paths call the shared matcher `matchSongs()` (exported as `matchAllSongs` for restricted-song merge in Add lyrics).

### 3. Query parsing

```
matchSongs(query)
  -> parseSearchQuery(q)
       -> phrases[]   from double-quoted segments, e.g. "sinisigaw ng"
       -> terms[]     remaining space-separated words
       -> miniSearchQuery  deduplicated token string for MiniSearch
```

- **Source:** `parseSearchQuery()` in `public/js/song-library.js`
- Unquoted multi-word queries use **AND** semantics (every term must match).
- Quoted phrases require a **contiguous substring** match in any indexed field.

### 4. MiniSearch + post-ranking

```
matchSongs(query)
  -> state.searchIndex.search(miniSearchQuery, SEARCH_OPTIONS)
  -> optional phrase filter (songMatchesPhrases)
  -> rankMatchedSongs (MiniSearch score + computeFieldMatchScore)
  -> search() / searchAdmin() apply limits and browse sort
```

**`SEARCH_OPTIONS`** (tunable constants at top of `song-library.js`):

| Option | Value | Effect |
|--------|-------|--------|
| `combineWith` | `'AND'` | All query tokens must match; adding words narrows results |
| `fuzzy` | `0.2` | ~1 edit per 5 characters (MiniSearch default algorithm) |
| `prefix` | `true` | Prefix match on tokens |
| `boost.title` | `5` | Title matches rank highest |
| `boost.adaptOf` | `3` | Adaptation source field |
| `boost.hymnNum` | `2.5` | Hymn number |
| `boost.lyrics` | `1` | Full lyrics body (lowest priority) |

**Post-ranking** (`computeFieldMatchScore`) adds a secondary score so title hits stay above lyrics-only hits even when MiniSearch scores are close:

| Field match | Score weight |
|-------------|--------------|
| `title` | 1000 × term weight |
| `adaptOf` | 300 |
| `hymnNum` | 200 |
| `lyrics` | 10 |

Quoted phrases use 2× term weight.

### 5. Fallback path (no MiniSearch)

When the CDN script is unavailable or the index is not built:

```
matchSongs -> filterSongsFallback(parsed)
  -> songMatchesParsedQuery (AND + phrase + fuzzy via Levenshtein)
  -> sort by computeFieldMatchScore
```

- **Source:** `filterSongsFallback()`, `levenshteinDistance()`, `fuzzyTokenMatch()`
- Fuzzy fallback applies only to tokens with length ≥ 3.

### 6. Result limits and sort order

| Mode | Entry API | Empty query | With query |
|------|-----------|-------------|------------|
| Add lyrics browse | `search(q)` | Hymn order, cap **20** | Relevance, cap **10** |
| Admin browse | `searchAdmin('')` | Title A–Z, **all** songs | Relevance, cap **10** |

Constants: `LIMITS.BROWSE = 20`, `LIMITS.SEARCH = 10` in `song-library.js`.

## Successful Output

- **Add lyrics:** Up to 10 ranked song rows in `#block-source-results`; revision/archived songs may appear but are disabled (handled in `index.js`, not in the matcher).
- **Admin:** Up to 10 ranked rows in admin search results; full library when search is empty.
- **Ranking:** Songs whose **title** matches the query appear before songs that match **lyrics only**.
- **Multi-word:** `sinisigaw ng pangalan` returns fewer (or equal) results than `sinisigaw` alone.
- **Quoted phrase:** `"sinisigaw ng" pangalan` requires the phrase `sinisigaw ng` as a contiguous substring plus the term `pangalan`.

## Handled Failures

| Condition | Behavior | Location |
|-----------|----------|----------|
| Empty / whitespace query | Returns browse set (not search ranking) | `matchSongs()`, `search()`, `searchAdmin()` |
| MiniSearch not loaded | Falls back to in-memory filter + fuzzy | `filterSongsFallback()` |
| No songs loaded | Empty results | `buildSearchIndex()` returns `null` |
| Quoted-only empty phrase | Ignored; other terms still apply | `parseSearchQuery()` |
| Short tokens (< 3 chars) | No fuzzy in fallback; exact/substring only | `maxFuzzyDistance()` |

## Unhandled Issues

| Issue | Impact |
|-------|--------|
| No stop-word list (`ng`, `sa`, etc.) | **Low** — short words must still match somewhere; may feel strict for Tagalog queries |
| Fuzzy fallback is token-based, not whole-field | **Low** — only affects no-MiniSearch path |
| No search analytics / “did you mean” | **Low** — UX only |
| Category pills applied **after** search in UI | **Medium** — can hide high-ranked matches when filters are active |

## Query Examples

| Query | Expected behavior |
|-------|-------------------|
| `sinisigaw` | Fuzzy/prefix match; title matches first |
| `sinisigaw ng pangalan` | AND: all three tokens required |
| `"sinisigaw ng" pangalan` | Contiguous phrase + `pangalan` |
| `ismael` (typo) | Fuzzy may match `ishmael` in title or lyrics |

---

## Revert Guide

Use this section to roll back search behavior without guessing what changed.

### What changed (vs `main`)

All search logic changes live in **one file**:

- `public/js/song-library.js`

Compared to `main`, the branch adds:

1. `SEARCH_OPTIONS` constant (AND, fuzzy, field boosts)
2. Query parser (`parseSearchQuery`) for quoted phrases
3. Fuzzy fallback helpers (`levenshteinDistance`, `fuzzyTokenMatch`, …)
4. Field-priority re-ranking (`computeFieldMatchScore`, `rankMatchedSongs`)
5. `searchAdmin()` keeps relevance order when querying (no A–Z re-sort); caps at 10
6. Export `matchAllSongs` alias

**Previous behavior on `main`:**

- MiniSearch used `prefix: true`, `fuzzy: 0.2`, default **OR** combine (any term matches)
- Fallback matched the **entire query string** as one substring (not per-term AND)
- No title boost; results followed MiniSearch default order
- `searchAdmin()` always sorted A–Z after matching

### Option A — Full revert (recommended)

Restore the file from the base branch:

```bash
git checkout main -- public/js/song-library.js
```

Verify in the browser:

1. Add lyrics: multi-word query may return **more** results (OR semantics).
2. Admin search with query: results sort **A–Z** again (not relevance).
3. Title matches are **not** explicitly prioritized over lyrics.

### Option B — Partial revert (keep AND, drop ranking/fuzzy)

Edit `public/js/song-library.js`:

1. Set `SEARCH_OPTIONS` to remove boosts and keep only:

```javascript
const SEARCH_OPTIONS = {
    prefix: true,
    fuzzy: 0.2,
    combineWith: 'AND',
};
```

2. Simplify `matchSongs()` to skip `rankMatchedSongs` and phrase filtering:

```javascript
function matchSongs(query) {
    const q = String(query || '').trim();
    if (!q) return state.songs.slice();
    const raw = state.searchIndex
        ? state.searchIndex.search(q, SEARCH_OPTIONS)
        : filterSongsFallback(parseSearchQuery(q));
    return raw.map(resolveStoredSong).filter(Boolean);
}
```

3. Optionally delete unused helpers: `parseSearchQuery` (if fallback simplified), `levenshteinDistance`, `rankMatchedSongs`, etc.

### Option C — Tune without reverting

Adjust behavior via constants only:

| Goal | Change |
|------|--------|
| Less strict multi-word | Set `combineWith: 'OR'` in `SEARCH_OPTIONS` |
| Stronger title bias | Increase `boost.title` (e.g. `8`) or `computeFieldMatchScore` title weight |
| Looser typos | Increase `fuzzy` to `0.3` |
| Stricter typos | Set `fuzzy: false` or lower to `0.1` |
| More/fewer results | Change `LIMITS.SEARCH` |

### Verification checklist after revert

- [ ] Add lyrics empty search shows 20 songs in hymn order
- [ ] Add lyrics typed search shows ≤ 10 results
- [ ] Admin empty search shows full library A–Z
- [ ] Admin typed search shows ≤ 10 results
- [ ] Multi-word query behavior matches intended combine mode (AND vs OR)
- [ ] Title-heavy queries rank as expected

## References

- `public/js/song-library.js` — search implementation
- `public/js/index.js` — `renderBlockSourceSearchResults()`, restricted song merge
- `public/js/admin-panel.js` — `renderSearchResults()`
- `public/index.html` — MiniSearch CDN script
- Related solution note: `docs/solutions/song-library-search-ranking.md`
