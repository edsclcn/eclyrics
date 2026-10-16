(function () {
    const OUTRO_CUE = 'To God be the Glory';
    function parseCues(lyrics) {
        let section = 0;
        return String(lyrics || '').split(/\r?\n/).reduce((cues, line) => {
            const text = line.trim();
            if (!text) { if (cues.length) section++; return cues; }
            cues.push({ text, section });
            return cues;
        }, []);
    }
    function buildCues(title, lyrics) {
        const lyricCues = parseCues(lyrics);
        const lastText = lyricCues.at(-1)?.text.toLocaleLowerCase().replace(/[.!?]+$/, '');
        if (lastText === OUTRO_CUE.toLocaleLowerCase()) {
            lyricCues.at(-1).isOutro = true;
        } else {
            lyricCues.push({ text: OUTRO_CUE, section: lyricCues.at(-1)?.section ?? 0, isOutro: true });
        }
        return [{ text: title, section: -1, isTitle: true }, ...lyricCues];
    }
    function create() {
        let nextId = 0;
        const state = { lineup: [], preparedId: null, preparedIndex: -1, live: null, background: null,
            sync: { enabled: false, paused: false, status: 'Off by default', lineupKey: null, projection: [], latestPosition: null },
            settings: { fontFamily: 'Satoshi', fontWeight: 700, fontSize: 120, color: '#ffffff', alignment: 'center', fadeMs: 400, dimming: 0.3 } };
        const listeners = new Set();
        const prepared = () => state.lineup.find(entry => entry.id === state.preparedId);
        const notify = () => listeners.forEach(listener => listener(state));
        function pauseSyncForManualCue() {
            if (!state.sync.enabled) return;
            state.sync.enabled = false;
            state.sync.paused = true;
            state.sync.status = 'Sync paused after a manual video cue. Turn Sync on to resume.';
        }
        function setCue(index) {
            const entry = prepared();
            if (!entry?.cues[index]) return false;
            state.preparedIndex = index;
            state.live = { entryId: entry.id, index, text: entry.cues[index].text };
            return true;
        }
        function applyTextPosition(position) {
            const block = state.sync.projection.find(entry => entry.blockIndex === position.blockIndex);
            const line = block?.lines.find(entry => entry.sourceLineIndex === position.sourceLineIndex);
            if (!Number.isInteger(position.sourceLineIndex) || !line) {
                state.live = null;
                state.sync.status = 'Sync on · Waiting for a lyric at the text marker.';
                notify();
                return;
            }
            const text = line.text || position.lineText.trim();
            if (!text) {
                state.live = null;
                state.sync.status = 'Sync on · Waiting for a lyric at the text marker.';
                notify();
                return;
            }
            state.live = { entryId: 'text-sync', blockIndex: position.blockIndex, index: position.sourceLineIndex, text };
            state.sync.status = `Following text · Line ${position.sourceLineIndex + 1}.`;
            notify();
        }
        function applyLatestPositionWhenEnabled() {
            if (state.sync.enabled && state.sync.latestPosition) applyTextPosition(state.sync.latestPosition);
            else notify();
        }
        function prepare(id) { if (!state.lineup.some(entry => entry.id === id)) return; state.preparedId = id; state.preparedIndex = state.live?.entryId === id ? state.live.index : -1; if (state.sync.enabled && state.sync.latestPosition) applyLatestPositionWhenEnabled(); else notify(); }
        function cue(index) {
            const entry = prepared();
            if (!entry?.cues[index]) return;
            pauseSyncForManualCue();
            setCue(index); notify();
        }
        function setSyncEnabled(enabled) {
            const syncEnabled = Boolean(enabled);
            state.sync.enabled = syncEnabled;
            state.sync.paused = false;
            if (!state.sync.enabled) {
                state.sync.status = 'Sync off.';
                notify();
                return;
            }
            state.sync.status = 'Sync on · Send text lyrics to start.';
            if (state.sync.latestPosition) applyTextPosition(state.sync.latestPosition);
            else notify();
        }
        function setTextLineup(source) {
            if (!source) {
                state.sync.lineupKey = null;
                state.sync.projection = [];
                state.sync.latestPosition = null;
                if (state.live?.entryId === 'text-sync') state.live = null;
                if (state.sync.enabled) state.sync.status = 'Sync on · Send text lyrics to start.';
                notify();
                return true;
            }
            if (typeof source.lineupKey !== 'string' || !Array.isArray(source.blocks)) return false;
            const projection = source.blocks.filter(block => Number.isInteger(block?.blockIndex) && block.blockIndex >= 0).map(block => ({
                id: `text-${block.blockIndex}`,
                blockIndex: block.blockIndex,
                title: String(block.title || `Block ${block.blockIndex + 1}`),
                lines: Array.isArray(block.lines) ? block.lines.filter(line => Number.isInteger(line?.sourceLineIndex) && line.sourceLineIndex >= 0 && typeof line.text === 'string' && line.text.trim()).map(line => ({
                    sourceLineIndex: line.sourceLineIndex,
                    text: line.text.trim(),
                })) : [],
            }));
            const lineupChanged = state.sync.lineupKey !== source.lineupKey;
            state.sync.lineupKey = source.lineupKey;
            state.sync.projection = projection;
            if (lineupChanged) {
                state.sync.latestPosition = null;
                if (state.live?.entryId === 'text-sync') state.live = null;
                state.sync.status = state.sync.enabled ? 'Sync on · Waiting for a lyric at the text marker.' : state.sync.status;
            }
            if (state.sync.enabled && state.sync.latestPosition) applyTextPosition(state.sync.latestPosition);
            else notify();
            return true;
        }
        function updateTextPosition(position) {
            if (!position || typeof position !== 'object' || !Number.isInteger(position.blockIndex) || position.blockIndex < 0) return;
            if (position.sourceLineIndex !== null && (!Number.isInteger(position.sourceLineIndex) || position.sourceLineIndex < 0)) return;
            if (typeof position.lineText !== 'string') return;
            if (typeof position.lineupKey !== 'string' || position.lineupKey !== state.sync.lineupKey) return;
            if (!state.sync.projection.some(block => block.blockIndex === position.blockIndex)) return;
            const latestPosition = {
                lineupKey: position.lineupKey,
                blockIndex: position.blockIndex,
                sourceLineIndex: position.sourceLineIndex,
                lineText: position.lineText,
            };
            state.sync.latestPosition = latestPosition;
            if (state.sync.enabled) applyTextPosition(latestPosition);
        }
        function getNextTextPosition(delta) {
            if (delta !== -1 && delta !== 1) return null;
            const lines = state.sync.projection.flatMap(block => block.lines.map(line => ({ blockIndex: block.blockIndex, sourceLineIndex: line.sourceLineIndex })));
            if (!lines.length) return null;
            const current = state.sync.latestPosition && lines.findIndex(line => line.blockIndex === state.sync.latestPosition.blockIndex && line.sourceLineIndex === state.sync.latestPosition.sourceLineIndex);
            const targetIndex = Number.isInteger(current) && current >= 0 ? current + delta : delta > 0 ? 0 : lines.length - 1;
            return targetIndex >= 0 && targetIndex < lines.length ? lines[targetIndex] : null;
        }
        function updateSettings(patch) {
            const settings = state.settings;
            if ((window.eclyricsVideoFonts?.allowedFamilies || ['Satoshi']).includes(patch.fontFamily)) settings.fontFamily = patch.fontFamily;
            if ([400, 500, 600, 700, 800, 900].includes(Number(patch.fontWeight))) settings.fontWeight = Number(patch.fontWeight);
            [['fontSize', 24, 160], ['fadeMs', 0, 2000], ['dimming', 0, .9]].forEach(([key, min, max]) => {
                if (patch[key] !== undefined && Number.isFinite(Number(patch[key]))) settings[key] = Math.max(min, Math.min(max, Number(patch[key])));
            });
            if (/^#[\da-f]{6}$/i.test(patch.color || '')) settings.color = patch.color.toLowerCase();
            if (['left', 'center', 'right'].includes(patch.alignment)) settings.alignment = patch.alignment;
            notify();
        }
        return { getState: () => state, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }, prepare, cue, updateSettings,
            add(song) { const title = window.eclyricsSongLibrary?.getPopupSongTitle(song) || song.title || 'Untitled'; const entry = { id: ++nextId, songId: song.id, title, category: [...(song.category || [])], lyrics: String(song.lyrics || ''), cues: buildCues(title, song.lyrics) }; state.lineup.push(entry); if (!state.preparedId) { state.preparedId = entry.id; state.preparedIndex = -1; } if (state.preparedId === entry.id) applyLatestPositionWhenEnabled(); else notify(); return entry.id; },
            edit(id, { title, lyrics }) {
                const entry = state.lineup.find(item => item.id === id);
                if (!entry) return;
                entry.title = String(title || '').trim() || 'Untitled';
                entry.lyrics = String(lyrics || '');
                const wasPreparedOutro = state.preparedId === id && entry.cues[state.preparedIndex]?.isOutro;
                const wasLiveOutro = state.live?.entryId === id && entry.cues[state.live.index]?.isOutro;
                entry.cues = buildCues(entry.title, entry.lyrics);
                if (state.preparedId === id) state.preparedIndex = wasPreparedOutro ? entry.cues.length - 1 : Math.min(state.preparedIndex, entry.cues.length - 2);
                if (state.live?.entryId === id) {
                    state.live.index = wasLiveOutro ? entry.cues.length - 1 : Math.min(state.live.index, entry.cues.length - 2);
                    state.live.text = entry.cues[state.live.index].text;
                    if (state.preparedId === id) state.preparedIndex = state.live.index;
                }
                if (state.preparedId === id) applyLatestPositionWhenEnabled();
                else notify();
            },
            remove(id) { const index = state.lineup.findIndex(entry => entry.id === id); if (index < 0) return; state.lineup.splice(index, 1); if (state.live?.entryId === id) state.live = null; if (state.preparedId === id) { state.preparedId = state.lineup[Math.min(index, state.lineup.length - 1)]?.id ?? null; state.preparedIndex = -1; } if (state.sync.enabled && state.sync.latestPosition) applyLatestPositionWhenEnabled(); else notify(); },
            move(id, delta) { const index = state.lineup.findIndex(entry => entry.id === id), target = index + delta; if (index < 0 || target < 0 || target >= state.lineup.length) return; const [entry] = state.lineup.splice(index, 1); state.lineup.splice(target, 0, entry); notify(); },
            advance(delta) { const entry = prepared(); if (!entry?.cues.length) return; pauseSyncForManualCue(); setCue(Math.max(0, Math.min(entry.cues.length - 1, state.preparedIndex + delta))); notify(); },
            setSyncEnabled, setTextLineup, updateTextPosition, getNextTextPosition,
            blankOutput() { if (!state.live) return; state.live = null; notify(); },
            setBackground(background) { state.background = background; notify(); },
        };
    }
    window.eclyricsVideoModel = { create, parseCues };
})();
