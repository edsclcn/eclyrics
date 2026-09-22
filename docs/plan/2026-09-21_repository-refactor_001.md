# EC Lyrics repository refactor plan

Date: 2026-09-21  
Scope: foldering, modularization, and repository practices for the current working tree  
Plan posture: balanced and risk-first

## Executive recommendation

The final inspection snapshot shows that a concurrent user change has already
performed a browser foldering pass and added docs/architecture.md plus
scripts/check-javascript.js. Treat that entire change as protected. The safest
next implementation slice is therefore validation and contract stabilization of
the move, followed by a small behavior-preserving server-side extraction. Do not
move the browser files again or rename the deleted legacy feature files in the
same change.

The safest next implementation slice is:

1. Preserve and baseline the current browser foldering changes separately.
2. Validate every HTML script path, the new npm syntax-check command, and the
   documented classic-script load order.
3. Extract pure lyrics normalization/search helpers from functions/index.js into
   functions/lib/ while keeping Firebase exports and request/response contracts
   unchanged.
4. Add or complete a Functions syntax/import smoke check and run the local emulator flow before
   any browser folder moves.

This creates the first real module boundary without changing the static app's
global execution model.

## Confirmed current architecture

| Area | Current location | Ownership and observations |
| --- | --- | --- |
| Static hosting shell | public/index.html, public/prompter.html, firebase.json | Firebase Hosting serves static HTML. index.html loads ordered classic scripts with defer; prompter.html is a separate popup surface. |
| Main workspace | public/js/index.js | 2,548 lines own shell initialization, tabs, block editing, block-source search UI, preview/prompter dock, BroadcastChannel/postMessage sync, and import/export integration points. Largest coupling hotspot. |
| Song library | public/js/song-library.js | 905 lines combine Firestore subscription/cache, client search/ranking fallback, normalization, admin CRUD, and the window.eclyricsSongLibrary API. The current branch is transitioning search reads to Functions. |
| Lyrics API client | public/js/lyrics-api.js | New working-tree boundary for callable/local-emulator search and lyric reads via window.eclyricsLyricsApi. |
| Admin UI | public/js/admin-panel.js and admin markup in public/index.html | UI rendering and form state consume the song-library global API; writes remain Firestore-backed and authorization is enforced in rules/server checks. |
| Authentication | public/js/auth.js, public/js/login.js, public/js/firebase-config.js | Auth state and admin-role discovery are global/event based. login.js gates the app shell. |
| Prompter | public/js/prompter.js, public/js/prompter-shortcuts.js, public/js/prompter-sync-guard.js, public/prompter.html | Separate runtime with storage, popup messaging, BroadcastChannel, scrolling, keyboard shortcuts, and parity diagnostics. |
| Text and file utilities | public/js/textformatting.js, public/js/smart-quotes.js, public/js/port.js | Global helpers for lyric formatting, quote normalization, and lineup import/export. |
| Cloud backend | functions/index.js, functions/package.json, functions/package-lock.json | Firebase Functions v2 callable search/get operations and Firestore write-triggered cache invalidation are in one 317-line CommonJS entrypoint. |
| Desktop shell | electron/main.js, root package.json | Electron loads the deployed/local web app and controls popup sizing/background throttling. It does not own lyric/business state. |
| Styling/assets | public/assets/css/globals.css, index.css, prompter.css | index.css is 3,963 lines and mixes shared primitives, shell, editor, admin, search, and preview styles. |
| Delivery/configuration | .github/workflows/*.yml, firebase.json, firestore.rules, firestore.indexes.json | Merge installs/deploys Functions, Hosting, and rules. PR preview does not yet install or validate Functions. |
| Documentation | README.md and docs/features, docs/solutions | README is only a title. Search docs still describe the previous client-side/server-side boundary. |

## Protected working-tree state

These are uncommitted user changes and must not be reverted, reformatted, or
folded into unrelated refactor commits:

- Firebase Functions and lockfile additions under functions/.
- public/js/lyrics-api.js and public/js/smart-quotes.js additions.
- Search/admin/index/text-formatting changes.
- Auth/rules, Firebase emulator, CI, and Electron changes.
- Removal of the legacy UI/assets/scripts currently shown as deleted by Git.
- The newer browser foldering pass under public/js/core, public/js/auth,
  public/js/library, public/js/features, and public/js/ui.
- docs/architecture.md and scripts/check-javascript.js.

Before implementation, record git status --short and git diff --stat. Each
refactor task must be independently reviewable against that baseline. First
verify that the new paths referenced by public/index.html and public/prompter.html
exist and load in dependency order. The deleted legacy feature files remain
deleted unless the product owner explicitly asks to restore them.

## Target ownership model

Keep the current no-bundler Firebase Hosting deployment until there is a demonstrated
need for a build tool. Introduce explicit feature folders incrementally, while
preserving current global API names during migration.

Proposed destination shape:

    functions/
      index.js                 Firebase export/deployment entrypoint only
      src/
        firestore.js           Firestore and local REST/emulator reads
        cache.js               revision-aware cache lifecycle
        normalization.js       normalization and public song projection
        search.js              MiniSearch construction, filtering, ranking
        handlers.js            callable handlers and cache invalidation

    public/
      js/
        app/                    workspace orchestration and DOM feature modules
          shell.js
          tabs.js
          blocks.js
          block-source.js
          preview.js
        auth/                   auth state, gate, config adapter
        library/                API client, library UI adapter, display helpers
        prompter/               popup runtime, sync guard, shortcut registry
        text/                   formatting and smart quote helpers
        io/                     lineup import/export
        index.js                temporary compatibility bootstrap during migration

Do not create generic utils, services, or helpers buckets. A file belongs to the
feature that owns its behavior. Keep cross-feature contracts small and named:
auth state event, lyrics API client, song-library display API, and prompter sync
payload.

## Phased work plan

### Phase 0 — Baseline protection and refactor guardrails

Goal: separate current feature work from structural changes.

| Task | Files | Owner | Dependencies | Acceptance criteria |
| --- | --- | --- | --- | --- |
| 0.1 Capture current state and intended deletions | docs/architecture/current-state.md (new), README.md | Tech lead | Current branch and Firebase project access | Document script load order, Firebase entrypoints, Electron URL behavior, deleted legacy feature files, and working-tree baseline. |
| 0.2 Define smoke journey checklist | docs/testing/smoke-checklist.md (new) | QA/developer | Local Firebase config or deployed preview | Covers sign-in gate, admin visibility, Add lyrics browse/search/filter, admin CRUD, block editing, prompter popup/sync/shortcuts, import/export, and Electron local URL. |
| 0.3 Reconcile search documentation | docs/features/song-library-search/README.md, docs/solutions/song-library-search-ranking.md | Document owner | Current Functions behavior | Mark client-side search as historical where applicable; document callable names, auth requirement, emulator path, result limits, cache invalidation, and fallback behavior. |

Gate: no folder move starts until the smoke checklist passes or each failure is
recorded as pre-existing/current-branch work. No new dependency is needed.

### Phase 1 — First implementation slice: stabilize the existing foldering

Goal: prove the existing browser move is behavior-preserving, then reduce backend
entrypoint coupling without changing external behavior.

| Task | Files | Owner | Dependencies | Acceptance criteria |
| --- | --- | --- | --- | --- |
| 1.1 Verify the current folder move | public/index.html, public/prompter.html, public/js/core/**, public/js/auth/**, public/js/library/**, public/js/features/**, public/js/ui/** | Frontend developer | Phase 0 | Every script reference resolves; Firebase config/auth/library adapters load before consumers; the editor, admin, prompter, and theme paths initialize once; no old public/js path is referenced by active HTML. |
| 1.2 Verify and own the syntax-check command | package.json, scripts/check-javascript.js, docs/architecture.md | Tech lead/developer | 1.1 | npm test is deterministic, scans intended source files, excludes dependencies/generated state, and reports the actual count. No formatter/linter dependency is introduced. |
| 1.3 Extract song data contracts and pure normalization | Add functions/src/normalization.js; reduce functions/index.js | Backend developer | 1.2 | String/category normalization, Firestore document normalization, search-field projection, preview truncation, and public result projection have identical outputs. Pure module has no Firebase initialization. |
| 1.4 Extract search policy and matching helpers | Add functions/src/search.js; update functions/index.js | Backend developer | 1.3 | Search options, category filtering, browse ordering, MiniSearch construction, and result limiting remain unchanged. Callable response remains { total, hasMore, songs }. |
| 1.5 Add focused Functions tests | functions/test/*.test.js and functions/package.json | Test engineer | 1.3 | Node's built-in test runner verifies pure normalization/search behavior, auth validation, and exported function names without network access. |

Validation: resolve all active HTML script paths, run npm test, run node --check
on all Functions source files, make emulator callable smoke calls for signed-in
search/get, verify admin write followed by cache invalidation, and run git diff
--check.

Why first: it validates the foldering already present without repeating a risky
move, then uses the clean backend runtime boundary to make later API contract
tests cheap without forcing another front-end rewrite.

### Phase 2 — Browser contract inventory and low-risk leaf extraction

Goal: make browser dependencies explicit while preserving classic scripts.

| Task | Files | Owner | Dependencies | Acceptance criteria |
| --- | --- | --- | --- | --- |
| 2.1 Record public browser contracts | docs/architecture/browser-contracts.md (new), public/index.html, public/prompter.html | Frontend developer | Phase 1 stable | List every window API, custom event, storage key, message type, DOM ID, and script-order dependency across pages. |
| 2.2 Move pure text helpers behind one named API | Add public/js/text/smart-quotes.js and public/js/text/formatting.js; update references | Frontend developer | 2.1 | Formatting and quote behavior unchanged; callers no longer reach private variables. Keep compatibility globals only where required. |
| 2.3 Move prompter leaf contracts | Add public/js/prompter/shortcuts.js and public/js/prompter/sync-guard.js; update both HTML pages | Frontend developer | 2.1 | Shared shortcut registry and sync-guard API remain identical. Origin checks, key filtering, parity reporting, and stale-sync behavior are unchanged. |
| 2.4 Move auth/API adapters | Add public/js/auth/auth.js, public/js/auth/login.js, public/js/library/lyrics-api.js; update public/index.html | Frontend developer | 2.1 and callable contract | Auth event and window.eclyricsLyricsApi contracts remain stable. No local Firebase config or credentials are added to tracked files. |

Keep each task as a move-plus-reference update. Do not also split the 2,548-line
workspace file or change to ES modules.

### Phase 3 — Split the main workspace by feature ownership

Goal: remove the largest monolith only after contracts are documented.

| Task | Files | Owner | Dependencies | Acceptance criteria |
| --- | --- | --- | --- | --- |
| 3.1 Extract workspace state and tab lifecycle | Add public/js/app/state.js and tabs.js; reduce public/js/index.js | Frontend developer | Phase 2 | Tab create/rename/close, active-tab selection, empty-slot maintenance, and cleanup retain existing IDs and behavior. |
| 3.2 Extract block editor and paste flows | Add public/js/app/blocks.js; reduce public/js/index.js | Frontend developer | 3.1 | Grid/block editor, paste/type modes, title labels, block-source handoff, and preview refresh retain current DOM contracts. |
| 3.3 Extract block-source search dialog | Add public/js/app/block-source.js; reduce public/js/index.js | Frontend developer | Phase 1, 2.4, 3.1 | Async request ordering, filters, restricted-song rules, lyric fetch, loading/error/empty states, and limits remain unchanged. |
| 3.4 Extract preview/prompter bridge | Add public/js/app/preview.js; reduce public/js/index.js | Frontend developer | Phase 2.3 and 3.1 | Viewfinder, BroadcastChannel/postMessage payloads, popup lifecycle, scroll controls, parity watchdog, and storage keys remain unchanged. |
| 3.5 Leave a thin bootstrap | public/js/index.js and public/index.html | Frontend developer | 3.1 through 3.4 | index.js only wires initialization and compatibility exports; feature-specific code is no longer concentrated there. |

Each task must be a separate reviewable change with a browser smoke pass. Do not
introduce a state-management library, component framework, bundler, or generic
event bus.

### Phase 4 — Separate library data access from library/admin UI

Goal: give the song library one data contract and remove duplicate search policy.

| Task | Files | Owner | Dependencies | Acceptance criteria |
| --- | --- | --- | --- | --- |
| 4.1 Define the browser song contract | Add public/js/library/song-model.js or keep it local to library.js; update song-library.js | Frontend/backend developer | Phase 1 and feature docs | Field names, optional fields, category slugs, adaptation labels, preview fields, and full lyric fetch behavior are consistent between callable responses and admin CRUD. |
| 4.2 Reduce song-library.js to data/cache/write adapter | Add public/js/library/library-api.js; keep song-library.js as a temporary compatibility shim | Frontend developer | 4.1 | Search reads use Functions API; Firestore client access remains only where required for admin writes/live subscriptions. One documented owner exists for the public global API. |
| 4.3 Isolate admin rendering | Add public/js/library/admin-panel.js; update admin markup references | Frontend developer | 4.2 | Admin filtering, form validation, CRUD status/error handling, delete confirmation, and conditional fields are UI-owned; data access is through the adapter. |

Explicitly decide whether browser MiniSearch is still needed. If production reads
all use the server API, remove the CDN script and client fallback only after
offline requirements and usage are confirmed. Do not keep two search implementations
indefinitely.

### Phase 5 — HTML/CSS ownership and asset hygiene

Goal: make visual changes local to their feature without changing layout.

| Task | Files | Owner | Dependencies | Acceptance criteria |
| --- | --- | --- | --- | --- |
| 5.1 Classify CSS sections before moving rules | index.css, globals.css, prompter.css; add docs/architecture/css-ownership.md | Frontend developer | Phase 3 | Every selector is assigned to global primitives, shell, editor, block-source, admin, preview, or popup ownership. |
| 5.2 Split CSS by stable surface | Add public/assets/css/app/*.css; update both HTML pages | Frontend developer | 5.1 | Computed styles and responsive behavior remain equivalent at desktop, tablet, and narrow widths; popup CSS stays isolated. |
| 5.3 Clean stale artifacts only after confirmation | original-index.html, deleted legacy feature paths, unused CSS/assets | Tech lead/product owner | Phase 0 inventory | Each artifact is classified as active, historical, generated, or safe to remove. No deletion is based only on apparent unused status. |

### Phase 6 — Repository practices and delivery gates

Goal: make the structure safe to maintain and deploy.

| Task | Files | Owner | Dependencies | Acceptance criteria |
| --- | --- | --- | --- | --- |
| 6.1 Replace placeholder scripts with useful checks | Root package.json, functions/package.json, optional scripts checks | Tech lead/developer | Phase 1 | npm test or equivalent performs deterministic syntax/config checks; npm run build either performs real no-bundle validation or is removed from CI assumptions. |
| 6.2 Align CI install/validation paths | Both GitHub workflow files | DevOps developer | 6.1 | PRs install Functions dependencies, validate Functions/config/rules, and exercise a safe preview. Production deploy order is explicit and cannot silently skip Functions or rules. |
| 6.3 Document local development and release ownership | README.md, docs/operations/local-development.md, docs/operations/release.md | Document owner | 6.1 and 6.2 | New contributors can configure Firebase, run emulators, run Electron, run checks, and identify which workflow deploys Hosting, Functions, and rules. |
| 6.4 Add focused boundary tests | functions/test/* and browser test locations selected after module shape stabilizes | Test engineer | Phases 1 through 4 | Tests cover normalization, category filtering, search limits/ranking, auth/API errors, block-source async races, and prompter payload normalization. Tests assert behavior rather than implementation details. |

Do not add a test framework, formatter, linter, or build tool before identifying a
specific missing check and an owner for its maintenance. If a tool is approved,
add it in a separate dependency-reviewed change.

## File ownership after refactor

| Owner | May change | Must not absorb |
| --- | --- | --- |
| Frontend workspace | public/js/app/**, workspace markup, app CSS | Firebase Admin SDK, Firestore rules, Functions cache/search policy |
| Library/API | public/js/library/**, public/js/auth/**, callable contract docs | Popup rendering or arbitrary workspace state |
| Prompter | public/js/prompter/**, public/prompter.html, prompter.css | Main admin CRUD or Firestore writes |
| Backend | functions/**, firestore.rules, firestore.indexes.json | DOM rendering and browser storage |
| Desktop | electron/** and Electron scripts | Web app business logic; it should load/configure the web app only |
| Delivery/docs | workflows, firebase.json, root docs | Feature behavior unless release/config requires it |

## Dependency and license review

Current direct dependency posture observed locally:

| Package | Scope | Observed license | Risk / action |
| --- | --- | --- | --- |
| electron 41.1.1 | Root dev dependency | MIT | Existing dependency; keep version/lockfile review separate from refactor. |
| firebase-admin 13.10.0 in Functions lockfile | Functions runtime | Apache-2.0 | Permissive-looking; confirm organizational policy and transitive notices before release. |
| firebase-functions 6.6.0 in Functions lockfile | Functions runtime | MIT | Verify Firebase runtime and Node 20 support before version changes. |
| minisearch 7.2.0 in Functions lockfile and CDN 7.1.2 reference | Functions and possibly browser | MIT | Version drift exists. Decide one ownership/version; avoid duplicate client/server search implementations. |
| Firebase compat SDK 12.10.0, Font Awesome CDN, Bootstrap CDN | Browser runtime | Not represented in npm lockfiles | Capture exact license/notice obligations and pinning/integrity policy before vendoring or changing CDN sources. |

No new dependency is required for the recommended first slice. Any future package
must include why native APIs are insufficient, direct/transitive license results,
lockfile diff, maintenance status, and rollback plan.

## Cross-cutting best practices

- Keep callable names searchLyrics, getLyric, and cache invalidation stable until a
  versioned migration exists.
- Keep authorization at the boundary: Firestore rules plus server-side callable
  authentication; never rely on hidden admin UI controls.
- Preserve bounded inputs and result limits; return sanitized user-facing errors
  and log diagnostic context server-side only.
- Prefer pure functions for normalization, ranking, formatting, and sync-payload
  validation. Keep DOM, Firebase, storage, and messaging side effects in adapters.
- Use one source of truth for search policy and one source of truth for prompter
  shortcut definitions.
- Keep async request ordering/cancellation explicit so stale search results cannot
  overwrite the current query.
- Avoid drive-by reformatting of current working-tree changes.
- Do not log tokens, full lyrics, credentials, or user-sensitive data.

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Uncommitted feature work is mixed with refactor moves | High | Stabilize and baseline first; one bounded task per change; never reset or checkout to clean the tree. |
| Classic script order and implicit globals break after moves | High | Inventory contracts first; update one path group at a time; retain compatibility shims until consumers migrate. |
| Search behavior diverges between client and Functions | High | Treat callable response as a contract; remove duplicate implementation only after parity checks and product confirmation. |
| Admin authorization regresses | High | Test unauthenticated, signed-in non-admin, and admin paths; preserve rules and server checks. |
| Prompter timing/sync regresses | High | Keep popup and workspace changes separate; use parity checks and background-window validation. |
| CDN/runtime version drift is non-reproducible | Medium | Record versions, decide CDN/npm ownership, add integrity/pinning policy, and validate failure states. |
| CSS split changes responsive layout | Medium | Capture visual baselines before moving rules and validate existing breakpoints. |
| CI deploy order creates a partial release | High | Validate Functions in PRs, make deploy stages explicit, and document rollback/order. |
| Stale artifacts are removed prematurely | Medium | Classify original-index.html and legacy artifacts with owner approval. |

## Definition of done

- Current user changes remain intact and independently attributable.
- Each moved behavior has one owning module and a documented public contract.
- functions/index.js is a thin deployment entrypoint and public/js/index.js is a
  thin browser bootstrap rather than a feature monolith.
- Search, auth, admin CRUD, editor, prompter, and Electron journeys pass the smoke
  checklist.
- Pure data/search/sync boundaries have focused automated tests; critical runtime
  boundaries have emulator or integration coverage.
- Root and Functions installs are reproducible from their lockfiles, CI validates
  both dependency trees, and dependency licenses are recorded.
- README and operational docs explain setup, checks, emulators, deployment, and
  ownership.
