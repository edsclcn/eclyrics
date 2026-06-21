/**
 * Preview ↔ prompter parity guard (backup layer).
 *
 * PRIMARY SYNC FLOWS (should keep preview ≡ prompter without hitting this guard):
 *
 *   Visual (scroll, font, width, theme, speed, playing)
 *     Main app control → postPrompterKey / postPrompterControl → prompter applies
 *     → broadcastPrompterState → ingestPrompterSyncBroadcast → preview viewfinder + dock
 *     Preview NEVER mutates lastPrompterSync except via broadcast ingest.
 *
 *   Lyrics content
 *     Main app textareas (source of truth) → sendPrompt / pushLineupToOpenPrompter
 *     → prompter updateLineup / eclyrics-prompter-load → broadcast includes fingerprint
 *     Preview live strip reads the is-live textarea; prompter reads data[currentIndex].
 *     pushLineup only runs for prompterBoundTabId (tab last sent to stage).
 *
 *   Live block edits
 *     Immediate pushLineupToOpenPrompter (no debounce) so stage tracks typing.
 *
 * BACKUP: runPrompterParityCheck on a slow interval only — not on every frame.
 *
 * Policy:
 *   - Visual state: prompter is authoritative.
 *   - Lyric content: main app is authoritative.
 */
(function (global) {
    const SYNC_TYPE = 'eclyrics-prompter-sync';

    const VISUAL_TOLERANCE = {
        top: 1.5,
        fs: 0.6,
        cw: 2,
        speed: 0.05,
    };

    /** @typedef {'visual' | 'content' | 'index' | 'stale'} ParityDriftKind */

    /**
     * @typedef {object} ParityDrift
     * @property {ParityDriftKind} kind
     * @property {string} field
     * @property {unknown} [expected]
     * @property {unknown} [actual]
     * @property {string} message
     */

    function hashString(str) {
        const s = String(str ?? '');
        let h = 5381;
        for (let i = 0; i < s.length; i += 1) {
            h = ((h << 5) + h) ^ s.charCodeAt(i);
        }
        return (h >>> 0).toString(36);
    }

    function parsePx(value, fallback = 0) {
        if (value == null || value === '' || value === 'normal') return fallback;
        const n = parseFloat(value);
        return Number.isNaN(n) ? fallback : n;
    }

    function numbersClose(a, b, tol) {
        if (typeof a !== 'number' || typeof b !== 'number' || Number.isNaN(a) || Number.isNaN(b)) {
            return a === b;
        }
        return Math.abs(a - b) <= tol;
    }

    /**
     * Normalize and validate a prompter sync broadcast payload.
     * @param {unknown} raw
     * @returns {Record<string, unknown> | null}
     */
    function normalizeSyncPayload(raw) {
        if (!raw || typeof raw !== 'object' || raw.type !== SYNC_TYPE) return null;
        const msg = /** @type {Record<string, unknown>} */ (raw);
        const out = { type: SYNC_TYPE };

        if (typeof msg.top === 'number' && !Number.isNaN(msg.top)) out.top = msg.top;
        if (typeof msg.vw === 'number' && !Number.isNaN(msg.vw)) out.vw = msg.vw;
        if (typeof msg.vh === 'number' && !Number.isNaN(msg.vh)) out.vh = msg.vh;
        if (typeof msg.fs === 'number' && !Number.isNaN(msg.fs)) out.fs = msg.fs;
        if (typeof msg.cw === 'number' && !Number.isNaN(msg.cw)) out.cw = msg.cw;
        if (typeof msg.speed === 'number' && !Number.isNaN(msg.speed)) out.speed = msg.speed;
        if (typeof msg.playing === 'boolean') out.playing = msg.playing;
        if (msg.theme === 'lyrics' || msg.theme === 'bw') out.theme = msg.theme;
        if (typeof msg.ls === 'string') out.ls = msg.ls;
        if (typeof msg.lh === 'string') out.lh = msg.lh;
        if (typeof msg.lineupKey === 'string' && msg.lineupKey) out.lineupKey = msg.lineupKey;
        if (typeof msg.currentIndex === 'number' && !Number.isNaN(msg.currentIndex)) {
            out.currentIndex = msg.currentIndex;
        }
        if (typeof msg.contentFingerprint === 'string') out.contentFingerprint = msg.contentFingerprint;

        return Object.keys(out).length > 1 ? out : null;
    }

    /**
     * @param {Record<string, unknown>} sync
     * @param {Record<string, unknown>} domMetrics
     * @returns {ParityDrift[]}
     */
    function diffVisualAgainstDom(sync, domMetrics) {
        /** @type {ParityDrift[]} */
        const drifts = [];
        if (!sync || !domMetrics) return drifts;

        const checks = [
            ['top', VISUAL_TOLERANCE.top],
            ['fs', VISUAL_TOLERANCE.fs],
            ['cw', VISUAL_TOLERANCE.cw],
        ];
        for (const [field, tol] of checks) {
            const expected = sync[field];
            const actual = domMetrics[field];
            if (typeof expected !== 'number' || typeof actual !== 'number') continue;
            if (!numbersClose(expected, actual, tol)) {
                drifts.push({
                    kind: 'visual',
                    field,
                    expected,
                    actual,
                    message: `Preview DOM ${field} (${actual}) ≠ prompter sync (${expected})`,
                });
            }
        }
        return drifts;
    }

    /**
     * @param {Record<string, unknown>} sync
     * @param {{ contentFingerprint?: string | null, blockIndex?: number | null, lineupKey?: string | null }} expected
     * @returns {ParityDrift[]}
     */
    function diffContentAgainstLive(sync, expected) {
        /** @type {ParityDrift[]} */
        const drifts = [];
        if (!sync || !expected) return drifts;

        if (
            expected.contentFingerprint != null &&
            typeof sync.contentFingerprint === 'string' &&
            sync.contentFingerprint !== expected.contentFingerprint
        ) {
            drifts.push({
                kind: 'content',
                field: 'contentFingerprint',
                expected: expected.contentFingerprint,
                actual: sync.contentFingerprint,
                message: 'Prompter lyrics differ from live block in main app',
            });
        }

        if (
            expected.blockIndex != null &&
            typeof sync.currentIndex === 'number' &&
            sync.currentIndex !== expected.blockIndex
        ) {
            drifts.push({
                kind: 'index',
                field: 'currentIndex',
                expected: expected.blockIndex,
                actual: sync.currentIndex,
                message: 'Prompter block index differs from live block',
            });
        }

        if (
            expected.lineupKey &&
            typeof sync.lineupKey === 'string' &&
            sync.lineupKey !== expected.lineupKey
        ) {
            drifts.push({
                kind: 'index',
                field: 'lineupKey',
                expected: expected.lineupKey,
                actual: sync.lineupKey,
                message: 'Prompter lineup differs from active tab',
            });
        }

        return drifts;
    }

    /**
     * @param {number | null} lastSyncAt
     * @param {number} [maxAgeMs=4000]
     */
    function diffStaleSync(lastSyncAt, maxAgeMs = 4000) {
        if (lastSyncAt == null) {
            return [{
                kind: 'stale',
                field: 'lastSyncAt',
                message: 'No prompter sync received yet',
            }];
        }
        if (Date.now() - lastSyncAt > maxAgeMs) {
            return [{
                kind: 'stale',
                field: 'lastSyncAt',
                expected: maxAgeMs,
                actual: Date.now() - lastSyncAt,
                message: 'Prompter sync is stale',
            }];
        }
        return [];
    }

    function createThrottledReporter(minIntervalMs = 2500) {
        let lastAt = 0;
        let lastKey = '';
        return function report(drifts) {
            if (!drifts?.length) return;
            const key = drifts.map((d) => d.message).join('|');
            const now = Date.now();
            if (key === lastKey && now - lastAt < minIntervalMs) return;
            lastKey = key;
            lastAt = now;
            console.warn('[eclyrics parity]', drifts.map((d) => d.message).join('; '));
        };
    }

    const api = {
        SYNC_TYPE,
        VISUAL_TOLERANCE,
        hashString,
        parsePx,
        normalizeSyncPayload,
        diffVisualAgainstDom,
        diffContentAgainstLive,
        diffStaleSync,
        createThrottledReporter,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        global.EclyricsPrompterSyncGuard = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : window);
