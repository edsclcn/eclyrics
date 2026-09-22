# Bounded plan: PR workflow repair and frontend modularization

Date: 2026-09-21  
Scope: the two confirmed findings in the current working tree  
Implementation constraint: classic scripts remain classic scripts; existing `window` contracts remain stable; do not add a bundler or framework.

## Confirmed findings and boundaries

1. `.github/workflows/firebase-hosting-pull-request.yml:41` contains a stray
   bare `gi` token after the `FirebaseExtended/action-hosting-deploy` step.
   That token is outside YAML structure and makes the PR workflow invalid.
2. The browser foldering pass changed paths, but the two largest responsibilities
   remain concentrated:

   - `public/js/library/song-library.js`: 905 lines covering normalization,
     search/indexing, cache/state, Firestore subscription, admin writes, and the
     public library API.
   - `public/js/features/editor/index.js`: 2,548 lines covering shell/tabs,
     block editing, block-source search, preview/prompter messaging, and popup
     lifecycle.

This plan does not restore deleted legacy paths, change search semantics, split
the prompter protocol, or introduce a generic `utils`, service, event-bus, or
state-management layer. The preview/prompter and tab/grid code are too
cross-coupled for this bounded change; they remain in `index.js` until their
contracts are separately inventoried.

## Stable contracts to preserve

The implementation must continue to expose these existing names and shapes:

- `window.eclyricsSongLibrary`: `start`, `stop`, `search`, `searchAdmin`,
  `sortSongsForCategoryFilters`, `matchAllSongs`, `getSongs`, `createLyric`,
  `updateLyric`, `deleteLyric`, the existing formatting helpers, `onChange`,
  `getState`, and `LIMITS`.
- `window.eclyricsLyricsApi`, `window.__eclyricsAuth`,
  `window.eclyricsSmartQuotes`, `window.eclyricsLoadAdminPanel`, and
  `window.getActiveTabLabel`.
- Prompter message types, BroadcastChannel name, local-storage keys, popup
  name/URL, and `EclyricsPrompterSyncGuard` behavior.

New extraction files may expose narrow, namespaced implementation bridges such
as `window.eclyricsSongLibrarySearch` and
`window.eclyricsEditorBlockSource`. These are internal classic-script bridges;
the existing product-facing APIs above must remain owned by their current
facades.

## Delivery order

### Task 1 — Repair the invalid PR workflow

Files:

- Modify `.github/workflows/firebase-hosting-pull-request.yml`.

Work:

- Remove only the trailing `gi` token and restore a final newline.
- Keep the existing checkout, root `npm ci && npm run build`, credential
  validation, and Firebase Hosting preview action unchanged.
- Do not restore the removed Firestore-rules deploy or add Functions deployment
  to the PR workflow in this task; those are separate delivery-policy changes.

Dependencies: none.

Acceptance criteria:

- The file parses as a GitHub Actions workflow with one `build_and_preview`
  job and no scalar/token after the final step.
- A PR from the repository can reach the hosting-preview action after the build
  step; no workflow parse error is reported.
- `git diff --check` is clean for the workflow.

Validation:

- Run `actionlint` against both `.github/workflows/firebase-hosting-pull-request.yml`
  and `.github/workflows/firebase-hosting-merge.yml` if available.
- Run the repository's existing build check with `npm ci && npm run build`.
- Confirm the next PR run reaches `FirebaseExtended/action-hosting-deploy`.

### Task 2 — Extract library search/ranking from the library facade

Files:

- Add `public/js/library/song-library-search.js`.
- Modify `public/js/library/song-library.js`.
- Modify `public/index.html` to load the new file before
  `public/js/library/song-library.js`.
- Add a no-new-dependency test fixture/runner only if needed for the existing
  Node test setup; prefer the built-in `node:test` runner and keep it separate
  from production code.

Safe extraction seam:

- Move the search-only region currently beginning with search normalization and
  tokenization and ending with category-filter ordering (approximately current
  lines 208–567): `normalizeSearchText`, compact/token helpers,
  `songToSearchDocument`, MiniSearch construction, query parsing, fuzzy/fallback
  matching, scoring/ranking, browse/admin comparators, and
  `sortSongsForCategoryFilters`.
- Keep Firestore document normalization, cache persistence, auth waiting,
  snapshot subscription, admin writes, listener notification, and the public
  `window.eclyricsSongLibrary` object in `song-library.js`.
- Give the extracted file a small explicit API that accepts the current song
  collection/search state as arguments or a plain state record. Do not add a
  class, repository abstraction, or second copy of the search policy.

Required behavior:

- Preserve `SEARCH_OPTIONS`, tokenization, quoted phrases, AND semantics,
  fuzzy matching, field scoring, browse ordering, admin ordering, limits, and
  fallback behavior exactly.
- `song-library.js` remains the only owner of the public library facade. Its
  existing methods delegate to the extracted search implementation without
  changing return values or mutation behavior.
- The extracted file must not initialize Firebase, read Firestore, access the
  DOM, or write local storage.

Dependencies and load order:

1. Firebase compat scripts and the existing MiniSearch CDN script.
2. `js/core/firebase-config.js`, auth scripts, and smart-quotes script.
3. `js/library/lyrics-api.js`.
4. `js/library/song-library-search.js`.
5. `js/library/song-library.js`.
6. Existing admin, prompter, editor, port, and text-formatting scripts.

Keep all scripts as ordered `defer` classic scripts. The search bridge must be
defined before `song-library.js`; `song-library.js` must still load before the
admin panel and editor, which consume `window.eclyricsSongLibrary`.

Acceptance criteria:

- `window.eclyricsSongLibrary` exposes the same keys and behaves the same for
  empty browse, single-term, multi-term, quoted, fuzzy, hyphenated, limited,
  and admin searches.
- Library cache hydration, live snapshot updates, `onChange`, CRUD, and error
  states are unchanged.
- No consumer changes from `admin-panel.js` or `editor/index.js` are required
  beyond the internal delegation.
- The library facade is materially smaller and no longer contains the complete
  search/index implementation.

Tests:

- Unit-test extracted search behavior with representative song fixtures using
  Node built-ins only, including empty query ordering, quoted phrase matching,
  AND behavior, fuzzy fallback, title/adaptation/hymn weighting, result
  limits, and category-filter ordering.
- Run `node --check` through the existing `npm test` script for every browser
  file.
- Browser smoke test: sign in, open Add lyrics, search/browse/filter, select a
  result, verify full-lyrics fetch, and exercise the admin search path.

### Task 3 — Extract the editor block-source dialog controller

Files:

- Add `public/js/features/editor/block-source.js`.
- Modify `public/js/features/editor/index.js`.
- Modify `public/index.html` to load `js/features/editor/block-source.js`
  immediately before `js/features/editor/index.js`.

Safe extraction seam:

- Move the block-source-only state and behavior currently spanning the category
  constants/state and the block-source section (approximately current lines
  50–82 and 1676–2110): category filters, restricted-result policy, API
  search request/debounce guards, result rendering, dialog open/close/reset,
  paste interception, Escape handling, and full-song selection.
- Keep editor-owned mutation and selection functions in `index.js`, especially
  `applyLyricsToBlock`, `activateBlockTypeMode`,
  `pasteLyricsFromClipboard`, `getBlockTitleDisplay`, `selectTextarea`, and
  `onBlockContentChanged`.
- Expose only `init(context)`, `open(textarea)`, `close()`, and `isOpen()` on
  the namespaced internal bridge. `init(context)` receives the four editor
  callbacks needed by the dialog; it must not reach into editor lexical state.
- Replace the existing local calls from block creation/edit flows with a thin
  local delegate to the bridge, preserving the current call sites' behavior.

Required behavior:

- Preserve the 180 ms debounce, monotonically increasing request guard, stale
  response discard, category-filter reset, restricted-song disabling,
  adaptation/hymn display rules, loading/error/empty notes, full lyric fetch,
  paste auto-fill threshold, and Escape/backdrop/button close behavior.
- Keep `window.eclyricsLyricsApi` as the data-read owner and keep
  `window.eclyricsSongLibrary` formatting/sort methods as the existing
  compatibility source.
- The new module must do no DOM work at script evaluation time. `index.js`
  remains responsible for invoking `init` during its existing shell startup,
  after the DOM exists.

Dependencies and load order:

1. `smart-quotes.js`, `lyrics-api.js`, `song-library.js`, admin/prompter
   scripts, and the block-source module definition.
2. `block-source.js` before `editor/index.js`, so the bridge exists when the
   editor script defines its delegates.
3. `editor/index.js` invokes the bridge from the existing DOM-ready shell
   initialization and supplies editor callbacks.
4. Existing `port.js` and `textformatting.js` remain after `index.js` in the
   current ordered defer chain; they are available before DOM-ready handlers
   and before user actions. Do not change this ordering unless validation proves
   a real early-use dependency.

Acceptance criteria:

- `index.js` no longer owns block-source request state, category-filter state,
  or result-rendering code; its remaining editor code still owns block state,
  tabs, preview, and prompter messaging.
- Add lyrics works for browse, search, category filters, restricted results,
  full lyric selection, manual type, manual paste, and error/stale-response
  paths.
- No new product-facing `window` API is renamed, removed, or made dependent on
  module import syntax.
- The editor module has an explicit callback boundary; it does not depend on
  undeclared top-level `let`/`const` bindings from another classic script.

Tests:

- Run `node --check` through `npm test` and a static load-order check that every
  local script in `public/index.html` and `public/prompter.html` exists and the
  new block-source script precedes `index.js`.
- Browser smoke test the complete Add lyrics flow, including rapid query
  changes that would previously risk stale results.
- Regression smoke test tab creation, block editing/paste, import/export,
  `window.getActiveTabLabel`, prompter popup open/send/sync/close, and admin
  navigation.

## Final validation and review gate

Files inspected/validated:

- Both GitHub workflow files.
- `public/index.html` and `public/prompter.html`.
- All new/changed browser JavaScript files under `public/js`.
- Existing `scripts/check-javascript.js` and root `package.json`.

Commands/checks:

1. `npm test` / `npm run build`.
2. `git diff --check`.
3. Workflow YAML validation with `actionlint` or the GitHub Actions parser.
4. Local Firebase Hosting/emulator browser smoke coverage for auth, library,
   editor, admin, and prompter paths.
5. Review the final diff for accidental legacy-path restoration, changed public
   API names, changed message/storage contracts, or duplicate event binding.

## Dependency and license risk

No new package is required or approved by this plan. The extraction uses the
existing browser CDN MiniSearch runtime, Firebase compat globals, and standard
browser/Node APIs. Therefore there is no new lockfile or license delta.

Existing items to record, but not expand in this change:

- `minisearch` 7.1.2 is already used in the Functions dependency set and the
  browser CDN URL; preserve the current version and review its existing license
  under the repository's normal dependency process.
- `electron` is an existing root dev dependency; do not update it for this
  refactor.
- The workflows use `npx --yes firebase-tools@latest`; this is an existing
  unpinned CI tool risk, not a new dependency introduced by these tasks. Pinning
  or licensing that tool should be a separate delivery/security task.

## Implementation record — 2026-09-21

Completed in the working tree:

- Removed the stray `gi` token from the PR workflow; the existing PR workflow
  keeps its hosting-preview scope.
- Split library model/display helpers into
  `public/js/library/song-model.js`, search/index/ranking into
  `public/js/library/song-search.js`, and left Firestore/cache/CRUD plus the
  stable `window.eclyricsSongLibrary` facade in `song-library.js`.
- Split the Add lyrics block-source controller into
  `public/js/features/editor/block-source.js` behind the
  `window.eclyricsEditorBlockSource` bridge. The editor coordinator supplies
  callbacks for block mutation and paste/type actions.
- Added the new scripts to `public/index.html` with `block-source.js` before
  `editor/index.js` and the library modules before the library facade.

Validated with `npm test`, `npm test --prefix functions`, local-script path and
load-order checks, workflow YAML parsing, and `git diff --check`.

## Out of scope / follow-up

- Splitting preview/prompter synchronization out of `editor/index.js`.
- Splitting tab/grid orchestration out of `editor/index.js`.
- Removing MiniSearch or the client fallback without confirming offline/search
  requirements.
- Converting classic scripts to ES modules or adding a bundler.
- Changing Firebase deployment scope, workflow permissions, or dependency
  versions.
