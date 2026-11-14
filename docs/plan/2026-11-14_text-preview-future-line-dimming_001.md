# Development tasks: Dim future lyric lines in the Text preview

## Scope

Repository/revision: `/Users/alwindenzsantos/Documents/personal/eclyrics`, branch `codex/lyrics-sync-session`, HEAD `637c928`.

Agreed requirements:

- Keep `getActiveSourceLine()` and the marker-based detection behavior unchanged.
- Use the existing `eclyrics-prompter-position` broadcast to style future lines in the Text Lyrics preview only.
- Do not style the audience popup or other lyric surfaces.
- Every formatted source line has one outer `data-prompter-source-line` span, so its wrapped rows and nested formatting should dim together.
- Preserve the existing uncommitted worktree changes; `.DS_Store` is unrelated and must remain untouched.

Acceptance criteria:

- **AC1 — Future-only styling:** With a valid active source line, preview spans whose source-line index is greater than the active index receive the dimming class. The active line and earlier lines keep their normal style.
- **AC2 — Preview-only scope:** Styling applies only under `#lyrics-preview-viewfinder`. The prompter popup and any other surface using `formatText()` remain unchanged.
- **AC3 — Whole semantic line:** The class is applied to the existing outer source-line span, so a wrapped line and its nested formatting are dimmed together.
- **AC4 — Correct state:** Position messages affect only the currently bound Text lineup/block. A null, stale, mismatched, or unavailable position clears the preview dimming rather than applying stale state to a different block.
- **AC5 — Rerender continuity:** Rebuilding the Text preview preserves the current valid dimming state by reapplying it to the new source spans.
- **AC6 — Detection unchanged:** No changes to `getActiveSourceLine()` or the prompter's position selection/broadcast contract.

Assumptions and decisions needed:

- Interpret **future lines** as `sourceLineIndex > current sourceLineIndex` in the currently bound Text block. The current and previous lines are not dimmed. When the position has `sourceLineIndex: null`, no future line is inferred and all preview lines remain undimmed.
- Dimming requires a valid position from the Text prompter bound to this editor. When the bound prompter/block changes or closes, clear the stored preview position. No new visible control is needed.

Non-goals:

- Changing reading-marker position, line detection, navigation, Text content, Video output, or popup rendering.
- Adding a second channel, persistence, dependencies, options, or a per-user dimming control.

## Repository evidence and boundary

- `public/js/features/prompter/prompter.js:getActiveSourceLine()` finds the source-line index crossing the reading marker; `broadcastSemanticPosition()` publishes `eclyrics-prompter-position` on `eclyrics-prompter`. This detection and payload are existing contracts and remain unchanged.
- `public/js/features/editor/index.js` already opens `PROMPTER_BC_NAME` in `initPrompterBroadcast()` to process `eclyrics-prompter-sync`, but does not handle semantic position messages. `updateLiveViewfinder()` replaces the preview contents, so the remembered position must be reapplied after a rebuild and cleared when its source changes.
- `public/js/features/video-lyrics/index.js` already consumes the same position message; the implementation should mirror its bound-lineup validation approach without routing styling through Video Lyrics.
- `public/js/features/editor/textformatting.js:formatText()` wraps each source lyric line in one outer `data-prompter-source-line` span. `public/modules/text-lyrics.html` places the Text stage under `#lyrics-preview-viewfinder`; the popup reuses formatting but is a different DOM surface.
- Existing tests in `test/lyrics-sync.test.js` cover source-line formatting, marker selection, and marker broadcasts. Extend this suite (or the established public-module harness if more natural) to check future/current/past/null/mismatched cases and preview-only class scope.
- `docs/features/text-lyrics-prompter/README.md` documents the Text preview and reading marker and should describe this new preview cue behavior.

## Tasks

### T1: Apply semantic future-line styling to the Text preview

- Implementation capability / responsible workstream: `developer` agent.
- Owned existing files: `public/js/features/editor/index.js`, `public/assets/css/index.css`, `public/index.html`, and `public/js/core/app-bootstrap.js`.
- Expected behavior and affected contracts: Reuse the existing `prompterBroadcast` channel to accept only well-formed position messages for the currently bound lineup and live block. Store the current source-line index, add/remove a preview-specific class on `#lyrics-preview-viewfinder` source-line spans, and reapply/clear it after `updateLiveViewfinder()` replaces the preview. The CSS selector must be rooted under `#lyrics-preview-viewfinder`; no popup or shared-formatting selector. Preserve the existing line detector and broadcast schema unchanged. Bump the `index.css`, editor `index.js`, and `app-bootstrap.js` cache tokens in their existing entry points because those assets change.
- Prerequisite tasks/files and external inputs: None; use the existing channel and `data-prompter-source-line` markup.
- Acceptance criteria covered: AC1–AC6.
- Validation criteria, commands, and testing capability: Developer self-check that both `stageHtml` and `formatText()` preview-render paths reapply state, and that stale/null block positions clear it. Test-engineer validation follows in T2.
- Dependency changes and license evidence/unknowns: None; no package changes.
- Compatibility, data migration, rollout, and recovery concerns: No persistence or content changes. Popup rendering and the position contract are unchanged. Revert the scoped class/style and cache-token edits to roll back.

### T2: Test preview dimming and message/state boundaries

- Implementation capability / responsible workstream: `test-engineer` agent.
- Owned existing files: `test/lyrics-sync.test.js` and, only if needed for an existing DOM harness, `test/public-modules.test.js`.
- Expected behavior and affected contracts: Verify the future index threshold, current and prior lines staying clear, null/mismatched positions clearing state, a preview rerender reapplying the current class, one outer span covering a wrapped semantic line, and CSS isolation to `#lyrics-preview-viewfinder`. Keep the existing marker detection assertions intact. Update cache-token assertions for the stylesheet, editor script, and bootstrap entry point.
- Prerequisite tasks/files and external inputs: T1 implementation.
- Acceptance criteria covered: AC1–AC6.
- Validation criteria, commands, and testing capability: Run focused tests `node --test test/lyrics-sync.test.js test/public-modules.test.js`, then `npm test` (includes JavaScript syntax checks). Record actual results and preserve unrelated baseline failures as such.
- Dependency changes and license evidence/unknowns: None.
- Compatibility, data migration, rollout, and recovery concerns: Ensure no test or selector implies that `prompter.js` detection changed.

### T3: Review the scoped implementation

- Implementation capability / responsible workstream: `tech-lead` agent; read-only.
- Owned existing files: T1/T2 diff.
- Expected behavior and affected contracts: Verify no change to active-line detection, correct bound lineup/block filtering, state reapplication after viewfinder HTML updates, strict preview-only CSS scope, cache tokens, and test coverage.
- Prerequisite tasks/files and external inputs: T1 and T2.
- Acceptance criteria covered: AC1–AC6.
- Validation criteria, commands, and testing capability: Review final diff and test output; do not edit code.
- Dependency changes and license evidence/unknowns: Confirm no package/lock changes.
- Compatibility, data migration, rollout, and recovery concerns: Confirm popup styles and content remain untouched.

### T4: Document preview-only future-line dimming

- Implementation capability / responsible workstream: `document-writer` agent.
- Owned existing files: `docs/features/text-lyrics-prompter/README.md`.
- Expected behavior and affected contracts: Document that the Text preview dims lines after the current marker-selected source line, and that the behavior is presentation-only and scoped to the Text preview.
- Prerequisite tasks/files and external inputs: T1 implementation and T3 review.
- Acceptance criteria covered: AC1–AC6 as implemented.
- Validation criteria, commands, and testing capability: Check documentation against the final implementation and test results; no separate code test required.
- Dependency changes and license evidence/unknowns: None.
- Compatibility, data migration, rollout, and recovery concerns: Documentation only.

## Follow-up: retain dimming across wrapped-fragment gaps

This follow-up supersedes the original plan's null-position clearing behavior
for messages belonging to the same lineup and block; all other acceptance
criteria remain unchanged.

### T5: Preserve the last valid line through a null position on the same block

- Evidence: `getActiveSourceLine()` checks each rectangle of a wrapped source
  span and can broadcast `sourceLineIndex: null` while the marker is between
  fragments. The editor currently replaces its remembered position with that
  null, temporarily clearing future-line styling.
- Scope: Do not change `getActiveSourceLine()` or the position broadcast
  contract. In `public/js/features/editor/index.js`, retain the last valid
  source-line index when a null-index message belongs to the same lineup and
  block. Replace/clear the remembered position when the lineup or block changes,
  including a null-index position for that new location.
- Regression coverage: In `test/lyrics-sync.test.js`, verify a same-lineup,
  same-block null message keeps the existing future-line classes; a null message
  for a changed lineup/block clears them; and an initial null leaves all lines
  undimmed. Existing assertions for valid position changes and preview rerenders
  remain in place.
- Acceptance criteria: Styling stays continuous while the marker crosses
  wrapped fragments; a new valid source-line position still updates which lines
  are future; lineup/block changes never carry stale styling into another song
  or block; active-line detection, broadcast payload, and popup remain
  unchanged.
- Validation: Run `node --test test/lyrics-sync.test.js`, then `npm test` and
  `git diff --check`. No dependency or cache-token change is expected.
- Documentation: Yes, add one sentence to
  `docs/features/text-lyrics-prompter/README.md` explaining that the Text
  preview keeps a wrapped source line's future-line styling continuous while
  the marker passes between its visual fragments. Keep the existing statement
  that this styling is preview-only and does not affect the audience prompter.

## Follow-up: transition both opacity directions

### T6: Keep the opacity transition active when the future-line class is removed

- Evidence: The current transition declaration is on the
  `is-future-source-line` selector. Once that class is removed, the element no
  longer has the transition declaration, so restoring its opacity may happen
  immediately.
- Scope: In `public/assets/css/index.css`, place `transition: opacity 0.2s ease`
  on all `[data-prompter-source-line]` spans scoped under
  `#lyrics-preview-viewfinder`; leave `opacity: 0.42` only on the
  `.is-future-source-line` rule. Keep both selectors rooted at the Text preview
  so the actual prompter and other `formatText()` consumers remain untouched.
  Since the current stylesheet token already identifies the earlier opacity
  behavior, bump the index stylesheet version in `public/index.html` so clients
  fetch this transition update too.
- Regression coverage: Extend the CSS assertions in `test/lyrics-sync.test.js`
  to require one preview-scoped base source-line rule with the transition and
  one preview-scoped future-line rule with the opacity. Ensure the transition
  is not limited to the future-line class, and update the stylesheet cache-token
  assertion to match `public/index.html`.
- Reduced motion: Do not add another media query. `public/assets/css/index.css`
  imports `globals.css`, whose existing `prefers-reduced-motion: reduce` rule
  shortens transitions globally.
- Performance: Opacity transitions affect only the lyric spans whose classes
  change; no filter, layout-affecting animation, or new runtime work is needed.
  Normal lyric lists present no material performance risk.
- Validation: Run `node --test test/lyrics-sync.test.js`, then `npm test` and
  `git diff --check`. No dependency changes are expected.

## Delivery and validation

Execution order: T1 → T2 → T5 → T6 → T3 → T4. Keep this as one small change; no parallel implementation is warranted.

PR shape: One coherent PR on the current branch if a PR is requested. No PR or publication is part of this plan.

Testing, review, documentation responsibilities: Required as T2, T3, and T4. The feature spans existing position-message handling, DOM rerenders, and a visual rule, so a focused regression test is appropriate.

Unverified assumptions / blockers:

- No blocker identified. The only assumed product detail is that “future” means larger source-line indices than the active line; if a different definition was intended, clarify before T1.
- No browser visual QA target was supplied; the code-level regression will assert the class changes and scoped selector.

Checks already observed (distinct from planned checks):

- Read `getActiveSourceLine()`, `broadcastSemanticPosition()`, the editor channel listener, Text preview rendering paths, shared formatter, scoped preview markup/CSS, existing sync tests, and current cache-token references.
- No tests were run during planning. Existing branch changes and `.DS_Store` were left untouched.
- No new/updated dependencies are proposed; dependency license review is not applicable unless implementation introduces a package.

## Next feature: render cue-only lines as blank

### T7: Preserve source indexes while blanking standalone Interlude/Instrumental cues

- Scope: In `public/js/features/editor/textformatting.js`, detect only source
  lines whose trimmed content is exactly `Interlude` or `Instrumental`, case
  insensitive, either bare or wrapped in a single pair of parentheses. Emit an
  empty `<span data-prompter-source-line="N"></span>` at that original source
  index so the preview/prompter shows a blank line and following lyric indexes
  remain stable. Leave mixed-content lines, surrounding source text, editing,
  and all other formatting behavior unchanged.
- Callers and boundary: `formatText()` feeds the Text preview, Text prompter
  lineup serialization, and `sendPrompt()`, so this one formatter change covers
  all three without mutating stored lyrics. The actual prompter skips empty
  semantic spans when selecting a line, preserving the source index of following
  lyric cues.
- Regression coverage: Extend `test/public-modules.test.js` formatter coverage
  for bare and parenthesized cue variants, case and surrounding whitespace,
  mixed-content preservation, and the next line retaining its original source
  index. Also verify the cue source text is not mutated by formatting.
- Cache tokens: Update the `textformatting.js` script token in
  `public/js/core/app-bootstrap.js`, bump the app-bootstrap script token in
  `public/index.html` because its loader list changed, and assert both current
  tokens in `test/lyrics-sync.test.js`. No Text fragment or prompter script
  token change is required unless those files are edited.
- Documentation: Update `docs/features/text-lyrics-prompter/README.md` with a
  short note that standalone cue-only lines render blank in the Text preview
  and audience prompter while source text remains editable and line indexes are
  preserved.
- Validation: Run `node --test test/public-modules.test.js
  test/lyrics-sync.test.js`, then `npm test` and `git diff --check`. No new
  package or dependency is needed, so there is no dependency license review.
- Scope caveat: `buildTextLineupProjection()` creates Video Lyrics lineup rows
  from raw lyric text rather than `formatText()`. This task does not change that
  separate row label. If the cue should also be hidden in Video Lyrics' Text
  lineup list, add a display-only row-label rule there while retaining its
  `sourceLineIndex`; do not filter the cue out of the lineup.

## Correction T8: Keep cue hiding inside Video Lyrics

This correction supersedes T7's Text formatter change and cue-hiding
documentation. The user's clarified behavior is: Text preview and the audience
Text prompter continue showing cue-only `Interlude`/`Instrumental` source lines;
Video Lyrics alone renders those lyric cues blank. Keep Video Lyrics' lineup,
Text tab, and block title labels visible as before.

### T8.1: Revert only T7's Text cue-hiding changes

- Files: `public/js/features/editor/textformatting.js`,
  `public/js/core/app-bootstrap.js`, `public/index.html`,
  `test/public-modules.test.js`, `test/lyrics-sync.test.js`, and
  `docs/features/text-lyrics-prompter/README.md`.
- Change: Remove the standalone-cue blanking branch from `formatText()` so
  Text preview and Text prompter keep their existing formatting and source text.
  Restore the formatter script cache token to its pre-T7 value and bump the
  app-bootstrap token to invalidate its updated loader list. Remove T7-specific
  blank-span expectations and replace them with a small assertion that bare and
  parenthesized cue lines remain visible in Text formatting. Remove only the
  T7 cue-hiding sentence from Text Lyrics documentation; retain T1/T5/T6
  preview-fade behavior and documentation.
- Preservation: Do not revert unrelated Video workspace, preview-opacity,
  transition, cache-token, or regression-test changes from earlier tasks.

### T8.2: Mark Video-only cue rows without dropping source positions

- Files: `public/js/features/video-lyrics/model.js`,
  `public/js/features/video-lyrics/index.js`, and `test/video-lyrics.test.js`.
- Change: Add one model-level exact-cue predicate for trimmed, bare or singly
  parenthesized `Interlude`/`Instrumental`, case-insensitive. For Text-projected
  lines, retain `sourceLineIndex` and original text metadata while marking the
  cue and supplying blank display/output text. Apply the same cue metadata to
  standalone `parseCues()`/`buildCues()` so manual Video Lyrics output also
  blanks these lines. Preserve the cue row and line number so navigation
  advances to the next source line without renumbering or skipping indexes.
  Ensure both `applyTextPosition()` and `cueTextLine()` blank output for marked
  lines instead of falling back to the raw `lineText`. Render the cue's text
  blank in the Video cue list while keeping the surrounding Text tab, block,
  song, and lineup labels visible.
- Boundaries: Do not change Text projection construction or Text marker logic.
  Do not blank cue-only labels in Text preview or the audience Text prompter.
  Preserve raw song lyrics/source text; no stored content migration is needed.

### T8.3: Verify visibility, identity, and output paths

- Tests: `test/video-lyrics.test.js` should cover standalone and Text-synced
  cue-only lines, raw text plus `sourceLineIndex` retention, blank Video output
  when a cue is active, blank cue-list text with the row/number retained, and
  advancing to the next lyric. `test/public-modules.test.js` should verify Text
  formatting still renders bare and parenthesized cue lines. `test/lyrics-sync.test.js`
  should assert the restored formatter token and the new Video script tokens.
- Documentation: Remove only T7's claim from
  `docs/features/text-lyrics-prompter/README.md`. Add a concise note to
  `docs/features/video-lyrics/README.md` that Video Lyrics blanks cue-only
  `Interlude`/`Instrumental` lines in its cue display/output while preserving
  source positions and lineup/title labels.
- Cache tokens: Restore the `textformatting.js` query token to its pre-T7 value;
  update the `video-lyrics/model.js` and `video-lyrics/index.js` script tokens
  in `public/js/core/app-bootstrap.js`; update the `app-bootstrap.js` query
  token in `public/index.html`. Assert these versions in
  `test/lyrics-sync.test.js`. The Video Lyrics fragment HTML cache version and
  CSS tokens need no change unless their files are edited.
- Validation: Run `node --test test/video-lyrics.test.js
  test/public-modules.test.js test/lyrics-sync.test.js`, then `npm test` and
  `git diff --check`. No new dependency is required; dependency-license review
  is not applicable.
