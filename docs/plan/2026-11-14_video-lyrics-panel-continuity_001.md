# Development tasks: Preserve Video Lyrics continuity across Text sync and Video control

## Scope

Repository/revision: `/Users/alwindenzsantos/Documents/personal/eclyrics`, branch `codex/lyrics-sync-session`, HEAD `637c928`.

Agreed requirements:

- While Text Lyrics is the active workspace and Sync video is enabled, Text prompter movement continues to drive the Video output.
- When Video Lyrics is active, its lineup and lyric cues remain available, and its controls can continue the Video output without moving the Text prompter.
- Moving between the workspaces must retain the current lyric context, titles, lineup, output, and Video appearance/background controls.
- Sync-off Video Lyrics behavior remains available.

Acceptance criteria:

- **AC1 — Text-owned sync:** In the Text workspace with Sync enabled, moving the Text position updates the same Video output and its highlighted projected line.
- **AC2 — Video-owned continuation:** In the Video workspace, selecting or stepping a projected lyric updates Video output only. Text prompter position is unchanged, and incoming Text position updates do not take over Video output while Video owns the controls.
- **AC3 — Clear projection identity:** The Video lineup and prepared cue view visibly identify the source Text tab/song label and block/title; all populated source lyrics remain accessible in the cue list.
- **AC4 — Seamless handoff:** Entering Video control from Text sync starts at the current projected line. Returning to Text control resumes from the latest Text position. Neither transition clears the projection, Video lineup, live output, background, nor appearance values.
- **AC5 — Standalone compatibility:** With Sync off, Video Lyrics retains its existing independent lineup, cue selection, arrow/button navigation, and popup advance behavior.
- **AC6 — No content writes:** Video-owned navigation does not edit Text Lyrics content or change the Text prompter position.

Assumptions and decisions needed:

- Treat **Sync video** as a Text-workspace control mode. The active workspace determines who owns Video cue navigation while the Sync preference and latest Text position remain intact. Returning to Text resumes Text-owned sync at the latest Text position. This matches the request to continue in Video Lyrics without requiring a second sync switch.
- Use the already-published Text projection as Video's cue source during this handoff; do not copy or persist Text content into the independent Video lineup. Keep that independent lineup in memory for Sync-off use.
- The tab label and block's first-line title are the available identity fields in the current Text projection. No new song-library metadata source is introduced.

Non-goals:

- Persisting lineups, current cues, settings, or uploaded media across page reloads.
- Editing Text lyrics from Video Lyrics, changing the Text sync layout, redesigning the shared Text projection contract, adding a second Sync switch, or introducing package dependencies.
- Browser/OBS/vMix deployment validation; this change is covered by code-level behavior checks unless a deployed target is separately requested.

## Repository evidence and boundary

- `public/js/features/video-lyrics/index.js` renders `state.sync.songs` as the Video lineup when `state.sync.enabled`; it currently makes projected entries/cues read-only, disables previous/next controls, and routes keyboard/popup navigation to Text or ignores it based on that same global flag.
- `public/js/features/video-lyrics/model.js` retains the Text projection and latest source position, but its `cue()` and `advance()` reject movement whenever Sync is enabled. Its independent Video lineup and appearance settings are separate in-memory state.
- `public/js/features/editor/index.js` publishes tab titles, populated blocks, and source-line positions through `eclyrics-text-lineup-updated` and the prompter BroadcastChannel. These are existing contracts to preserve.
- `test/public-modules.test.js` exercises the current rule that Video cannot navigate while Sync is enabled; those assertions must be updated to distinguish active workspace ownership. `test/video-lyrics.test.js` covers model transitions and Sync-off behavior. `test/lyrics-sync.test.js` covers the Text-only Sync switch, projection, and cache tokens.
- `docs/features/video-lyrics/README.md` currently documents Sync as Text-owned and says Video cue/lineup clicks seek Text while enabled. Update this after implementation so it describes the workspace-specific control handoff.
- The worktree contains an unrelated modified `.DS_Store`; do not include or change it.

## Tasks

### T1: Separate Text sync preference from active Video control ownership

- Implementation capability / responsible workstream: `developer` agent, one bounded implementation task.
- Owned existing files: `public/js/features/video-lyrics/model.js`, `public/js/features/video-lyrics/index.js`, `public/modules/video-lyrics.html`, and `public/assets/css/video-lyrics.css`. Update `public/index.html` for the Video stylesheet cache token and `public/js/core/app-bootstrap.js` for changed module/script cache tokens.
- Expected behavior and affected contracts: Keep receiving and validating the existing Text lineup/position messages. Make Text drive Video only while Text workspace owns controls. While Video workspace owns controls, allow cue click, previous/next, keyboard, and Video popup advance to operate on the projected cue context without changing Text content/position; preserve the last Text position for re-entry. Keep current output, independent Video lineup, background, and settings through panel changes. Make the projected row and prepared cue headings visibly distinguish the Text tab/song label from the block title. Do not duplicate shared state or add a package.
- Prerequisite tasks/files and external inputs: None; use the current `panel-text` / `panel-video` active classes and existing editor projection APIs.
- Acceptance criteria covered: AC1–AC6.
- Validation criteria, commands, and testing capability: Developer self-check against existing caller contracts; test-engineer will validate `npm test` after T2. Include panel switching in the deterministic harness and verify both a current Text position handoff and subsequent Video-only line stepping.
- Dependency changes and license evidence/unknowns: None planned; no `package.json` or lockfile changes.
- Compatibility, data migration, rollout, and recovery concerns: No persisted schema/data changes. Preserve `window.eclyricsVideoLyrics.getState()` and existing Text projection APIs. Existing Sync-off lineup remains in page memory. Reverting the code change requires no migration.

### T2: Cover workspace ownership and title/line continuity with regression tests

- Implementation capability / responsible workstream: `test-engineer` agent.
- Owned existing files: `test/public-modules.test.js`, `test/video-lyrics.test.js`, `test/lyrics-sync.test.js`, and `test/lyrics-sync-dock.test.js` to keep the sync controller harness aligned with the active workspace ownership API.
- Expected behavior and affected contracts: Replace assertions that globally prohibit Video navigation whenever Sync is enabled with checks for Text-owned versus Video-owned modes. Cover preservation of latest Text position, current Video line, source title/block labels, Video-only navigation without a Text position mutation, return-to-Text resumption, and unchanged Sync-off behavior. Keep existing origin/source/projection validation checks.
- Prerequisite tasks/files and external inputs: T1 implementation.
- Acceptance criteria covered: AC1–AC6.
- Validation criteria, commands, and testing capability: Run focused checks `node --test test/public-modules.test.js test/video-lyrics.test.js test/lyrics-sync.test.js`, then full `npm test` (which also runs `scripts/check-javascript.js`). Record actual results; fix failures through T1's implementation owner.
- Dependency changes and license evidence/unknowns: None.
- Compatibility, data migration, rollout, and recovery concerns: Tests should assert the existing public window APIs and message validation remain compatible.

### T3: Review the implementation and test diff

- Implementation capability / responsible workstream: `tech-lead` agent; review only.
- Owned existing files: Changed files from T1/T2.
- Expected behavior and affected contracts: Check correctness, workspace-mode transitions, stale or unbound Text positions, line selection, keyboard/popup callers, source validation, accessibility of visible title labels, test sufficiency, and unnecessary scope. Report R1–R5 findings; implementation owner addresses blockers before documentation.
- Prerequisite tasks/files and external inputs: T1 and T2.
- Acceptance criteria covered: AC1–AC6.
- Validation criteria, commands, and testing capability: Review the final diff and test output; no new production changes from the review workstream.
- Dependency changes and license evidence/unknowns: Confirm no package/lock changes; none are expected.
- Compatibility, data migration, rollout, and recovery concerns: No migration. Confirm `.DS_Store` remains untouched.

### T4: Update Video Lyrics feature documentation

- Implementation capability / responsible workstream: `document-writer` agent.
- Owned existing files: `docs/features/video-lyrics/README.md`.
- Expected behavior and affected contracts: Replace the blanket statement that Sync always owns Video navigation with the implemented active-workspace handoff; describe the visible projected title/block identity and retained standalone lineup/settings/output state.
- Prerequisite tasks/files and external inputs: T1 implementation and T3 review findings.
- Acceptance criteria covered: AC1–AC6 as implemented.
- Validation criteria, commands, and testing capability: Compare the updated flow and limitations with final code and tests; no separate code test required.
- Dependency changes and license evidence/unknowns: None.
- Compatibility, data migration, rollout, and recovery concerns: Documentation only.

## Delivery and validation

Execution order: T1 → T2 → T3 → T4. Keep this as one coherent change; the source ownership, tests, and docs depend on the same transition contract.

PR shape and layer boundaries: One PR on `codex/lyrics-sync-session` if a PR is requested. No PR creation or publication is part of this plan.

Testing, review, documentation responsibilities: Required as the distinct T2, T3, and T4 tasks above. Code-level tests are applicable because the behavior is stateful and has existing integration harness coverage.

Unverified assumptions / blockers:

- No blocker identified. The plan assumes selecting the Video workspace temporarily gives Video cue controls ownership while retaining the Text Sync preference. If product behavior differs, clarify before T1 because that changes the mode-transition contract.
- Actual browser interaction and broadcast-system capture are not planned because no deployed target was provided.

Checks already observed (distinct from planned checks):

- Confirmed branch and HEAD with `git status --short --branch` and `git rev-parse --short HEAD`.
- Read the current Video Lyrics model/index, Text projection publisher, feature README, and relevant model/integration tests. No tests were run during planning.
- No dependency changes are proposed; dependency license review is not applicable unless implementation introduces a package.
