const LINEUP_FORMAT = 'eclyrics-lineup';
const LINEUP_FORMAT_VERSION = 1;

function getLineupContextForTab(tabElement) {
    if (!tabElement) return null;

    const tabId = tabElement.dataset.tabId;
    const tab = document.getElementById(`tab-${tabId}`);
    if (!tab) return null;

    const blocks = Array.from(tab.querySelectorAll('textarea'))
        .map((textarea, index) => {
            const content = textarea.value.trim();
            if (!content) return null;
            const summary = parseBlockSummary(content);

            return {
                block: index + 1,
                title: summary.hymnNumber ? `${summary.hymnNumber} - ${summary.title}` : summary.title,
                hymnNum: summary.hymnNumber,
                lyrics: summary.lyrics,
                content,
            };
        })
        .filter(Boolean);

    return {
        label: (tabElement.querySelector('.tab-label')?.textContent?.trim() || `Tab ${tabId}`).toUpperCase(),
        tabId,
        blocks,
    };
}

function parseBlockSummary(content) {
    const lines = String(content).split(/\r?\n/);
    const hymnNumberMatch = (lines[0] || '').trim().match(/^#\s*(\d+)\s*$/);
    const hymnNumber = hymnNumberMatch ? hymnNumberMatch[1] : '';
    if (hymnNumber) lines.shift();
    while (lines[0] === '') lines.shift();

    const title = (lines.shift() || '').trim();
    while (lines[0] === '') lines.shift();

    // Adaptation metadata is part of the prompt heading, not the lyrics preview.
    if (/^\(Adaptation(?: of .+)?\)$/i.test((lines[0] || '').trim()) || /^Adapted from .+$/i.test((lines[0] || '').trim())) {
        lines.shift();
        while (lines[0] === '') lines.shift();
    }

    return {
        title: title || (hymnNumber ? 'Untitled hymn' : 'Untitled block'),
        hymnNumber,
        lyrics: lines.join('\n').trim(),
    };
}

function getLineupContext() {
    const tabs = Array.from(document.querySelectorAll('#tabs-list .tab'))
        .map(getLineupContextForTab)
        .filter(Boolean);

    return tabs.length ? { tabs } : null;
}

function exportLineup() {
    const lineup = getLineupContext();
    if (!lineup) {
        alert('No selected tab!');
        return;
    }

    const blockCount = lineup.tabs.reduce((count, tab) => count + tab.blocks.length, 0);
    if (!blockCount) {
        alert('Lineup is empty! Save was unsuccessful.');
        return;
    }

    renderLineupDialog(lineup);
    openLineupDialog();
}

function renderLineupDialog(lineup) {
    const body = document.getElementById('lineup-dialog-table-body');
    const count = document.getElementById('lineup-dialog-count');
    const lede = document.getElementById('lineup-dialog-lede');
    if (!body || !count || !lede) return;

    body.replaceChildren();
    const blockCount = lineup.tabs.reduce((total, tab) => total + tab.blocks.length, 0);
    lede.textContent = `Review ${lineup.tabs.length} tab${lineup.tabs.length === 1 ? '' : 's'} and ${blockCount} block${blockCount === 1 ? '' : 's'}, then choose an export format.`;
    count.textContent = `${lineup.tabs.length} tab${lineup.tabs.length === 1 ? '' : 's'} · ${blockCount} block${blockCount === 1 ? '' : 's'} ready to save`;

    for (const tab of lineup.tabs) {
        const tabRow = document.createElement('tr');
        tabRow.className = 'lineup-dialog__tab-row';
        const tabCell = document.createElement('th');
        tabCell.scope = 'rowgroup';
        tabCell.colSpan = 3;
        tabCell.textContent = tab.label;
        tabRow.appendChild(tabCell);
        body.appendChild(tabRow);

        if (!tab.blocks.length) {
            const emptyRow = document.createElement('tr');
            emptyRow.className = 'lineup-dialog__empty';
            const emptyCell = document.createElement('td');
            emptyCell.colSpan = 3;
            emptyCell.textContent = 'No filled blocks';
            emptyRow.appendChild(emptyCell);
            body.appendChild(emptyRow);
            continue;
        }

        for (const block of tab.blocks) {
            const row = document.createElement('tr');

            const numberCell = document.createElement('td');
            numberCell.textContent = String(block.block);

            const titleCell = document.createElement('td');
            titleCell.textContent = block.title || 'Untitled block';
            titleCell.title = block.title || 'Untitled block';

            const lyricsCell = document.createElement('td');
            lyricsCell.className = 'lineup-dialog__lyrics-cell';
            if (block.lyrics) {
                const summary = document.createElement('div');
                summary.className = 'lineup-dialog__lyrics-summary';

                const excerpt = document.createElement('span');
                excerpt.className = 'lineup-dialog__lyrics-excerpt';
                excerpt.textContent = getLyricsExcerpt(block.lyrics);

                const details = document.createElement('div');
                details.className = 'lineup-dialog__lyrics-details';
                details.hidden = true;
                details.textContent = block.lyrics;

                const toggle = document.createElement('button');
                toggle.type = 'button';
                toggle.className = 'lineup-dialog__lyrics-toggle';
                toggle.setAttribute('aria-expanded', 'false');
                toggle.setAttribute('aria-label', `Expand lyrics for ${block.title || 'this block'}`);
                toggle.title = 'Expand lyrics';
                toggle.innerHTML = '<i class="fa-solid fa-chevron-down" aria-hidden="true"></i>';
                toggle.addEventListener('click', () => {
                    const expanded = toggle.getAttribute('aria-expanded') === 'true';
                    toggle.setAttribute('aria-expanded', String(!expanded));
                    toggle.setAttribute('aria-label', `${expanded ? 'Expand' : 'Collapse'} lyrics for ${block.title || 'this block'}`);
                    toggle.title = expanded ? 'Expand lyrics' : 'Collapse lyrics';
                    toggle.querySelector('i')?.classList.toggle('fa-chevron-down', expanded);
                    toggle.querySelector('i')?.classList.toggle('fa-chevron-up', !expanded);
                    excerpt.hidden = !expanded;
                    details.hidden = expanded;
                });

                summary.append(excerpt, toggle);
                lyricsCell.append(summary, details);
            } else {
                lyricsCell.textContent = '—';
            }

            row.append(numberCell, titleCell, lyricsCell);
            body.appendChild(row);
        }
    }
}

function getLyricsExcerpt(lyrics) {
    const oneLine = String(lyrics).replace(/\s+/g, ' ').trim();
    const maxLength = 150;
    return oneLine.length > maxLength ? `${oneLine.slice(0, maxLength).trimEnd()}…` : oneLine;
}

function openLineupDialog() {
    const dialog = document.getElementById('lineup-dialog');
    if (!dialog) return;
    dialog.hidden = false;
    dialog.setAttribute('aria-hidden', 'false');
    document.getElementById('lineup-dialog-close')?.focus();
}

function closeLineupDialog() {
    const dialog = document.getElementById('lineup-dialog');
    if (!dialog) return;
    dialog.hidden = true;
    dialog.setAttribute('aria-hidden', 'true');
}

function buildLineupDocument(lineup) {
    return {
        format: LINEUP_FORMAT,
        version: LINEUP_FORMAT_VERSION,
        tab: lineup.tabs.length === 1 ? lineup.tabs[0].label : 'Lineup',
        tabs: lineup.tabs.map((tab) => ({
            tab: tab.label,
            blocks: tab.blocks.map((block) => ({
                block: block.block,
                title: block.title,
                ...(block.hymnNum ? { hymnNum: block.hymnNum } : {}),
                lyrics: block.lyrics,
                content: block.content,
            })),
        })),
    };
}

function downloadLineupJson() {
    const lineup = getLineupContext();
    const blockCount = lineup?.tabs.reduce((count, tab) => count + tab.blocks.length, 0) || 0;
    if (!lineup || !blockCount) {
        alert('Lineup is empty! Download was unsuccessful.');
        return;
    }

    const filename = `${getDatePrefix()}_${safeFilenamePart(lineup.tabs.length === 1 ? lineup.tabs[0].label : 'Lineup')}_line_up.json`;
    download(filename, JSON.stringify(buildLineupDocument(lineup), null, 2), 'application/json');
}

function downloadLineupTitlesCsv() {
    const lineup = getLineupContext();
    const blocks = lineup?.tabs.flatMap((tab) => tab.blocks) || [];
    if (!blocks.length) {
        alert('Lineup is empty! CSV download was unsuccessful.');
        return;
    }

    const csv = blocks.map((block) => csvEscape(block.title)).join('\n');
    const filename = `${getDatePrefix()}_${safeFilenamePart(lineup.tabs.length === 1 ? lineup.tabs[0].label : 'Lineup')}_line_up.csv`;
    download(filename, `${csv}\n`, 'text/csv;charset=utf-8');
}

function importLineup() {
    const importBtn = document.getElementById('import-btn');
    if (importBtn) {
        importBtn.disabled = true;
        importBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>';
    }

    uploadJson()
        .then((values) => {
            if (!values) return;

            const activeTab = document.querySelector('#tabs-list .tab.active');
            if (!activeTab) return;

            const firstTabId = parseInt(activeTab.dataset.tabId, 10);
            const importedTabs = values;
            importedTabs.forEach((tabData, index) => {
                const tabId = index === 0 ? firstTabId : addTab();
                if (!tabId) return;
                if (tabData.label && typeof setTabLabel === 'function') {
                    const tabElement = document.querySelector(`#tabs-list .tab[data-tab-id="${tabId}"]`);
                    setTabLabel(tabElement, tabData.label);
                }
                fillLineupIntoTab(tabData.blocks, tabId);
            });

            if (typeof showTabContent === 'function') showTabContent(firstTabId);
            if (typeof refreshAllBlockLabelsInTab === 'function') refreshAllBlockLabelsInTab(firstTabId);
            if (typeof updatePreview === 'function') updatePreview();
            if (typeof updateActiveBlockToolbar === 'function') updateActiveBlockToolbar();
        })
        .catch((err) => {
            if (err !== 'No file selected') alert(`Failed to import lineup: ${err}`);
        })
        .finally(() => {
            if (!importBtn) return;
            importBtn.disabled = false;
            importBtn.innerHTML = '<i class="fa-solid fa-folder-open" aria-hidden="true"></i>';
        });
}

function uploadJson() {
    return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';

        input.onchange = (event) => {
            const file = event.target.files[0];
            if (!file) {
                reject('No file selected');
                return;
            }

            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    resolve(parseLineupJson(JSON.parse(e.target.result)));
                } catch (error) {
                    reject(error.message || 'The selected file is not valid lineup JSON.');
                }
            };
            reader.onerror = () => reject('Failed to read the selected JSON file.');
            reader.readAsText(file);
        };
        input.oncancel = () => reject('No file selected');

        input.click();
    });
}

function parseLineupJson(payload) {
    const tabs = Array.isArray(payload)
        ? [{ label: '', blocks: payload }]
        : Array.isArray(payload?.tabs)
            ? payload.tabs.map((tab) => ({ label: tab?.tab || tab?.label || '', blocks: tab?.blocks }))
            : [{ label: payload?.tab || '', blocks: payload?.blocks }];

    if (!tabs.length || tabs.some((tab) => !Array.isArray(tab.blocks))) {
        throw new Error('Lineup JSON must contain a tabs array with blocks.');
    }

    const parsedTabs = tabs.map((tab) => ({
        label: String(tab.label || '').trim().toUpperCase(),
        blocks: tab.blocks
            .map((block) => {
                if (typeof block === 'string') return block.trim();
                if (!block || typeof block !== 'object') return '';
                if (typeof block.content === 'string' && block.content.trim()) return block.content.trim();

                const title = String(block.title ?? '').trim();
                const lyrics = String(block.lyrics ?? '').trim();
                if (!title && !lyrics) return '';
                return lyrics ? `${title}\n\n${lyrics}` : title;
            })
            .filter(Boolean),
    }));

    if (!parsedTabs.some((tab) => tab.blocks.length)) {
        throw new Error('The lineup JSON does not contain any blocks.');
    }
    return parsedTabs;
}

function fillLineupIntoTab(values, tabId) {
    const tab = document.getElementById(`tab-${tabId}`);
    const container = tab?.querySelector('.textareas-container');
    if (!container) return;

    let current = 0;
    for (let i = 1; current < values.length; i++) {
        let textarea = document.getElementById(`textarea-${tabId}-${i}`);
        if (!textarea) {
            if (typeof addSingleBlock === 'function') addSingleBlock(container, tabId);
            textarea = document.getElementById(`textarea-${tabId}-${i}`);
        }
        if (!textarea) break;

        if (!textarea.value.trim()) {
            textarea.value = values[current];
            current++;
            if (typeof onBlockContentChanged === 'function') {
                onBlockContentChanged(textarea);
            } else {
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }
    }

    if (typeof refreshAllBlockLabelsInTab === 'function') refreshAllBlockLabelsInTab(tabId);
}

function download(filename, text, mimeType = 'text/plain;charset=utf-8') {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const element = document.createElement('a');
    element.href = url;
    element.download = filename;
    element.style.display = 'none';
    document.body.appendChild(element);
    element.click();
    element.remove();
    URL.revokeObjectURL(url);
}

function csvEscape(value) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function getDatePrefix() {
    return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

function safeFilenamePart(value) {
    return String(value || 'Tab').replace(/[^a-zA-Z0-9 _.-]/g, '').trim() || 'Tab';
}

document.getElementById('lineup-dialog-close')?.addEventListener('click', closeLineupDialog);
document.getElementById('lineup-dialog-backdrop')?.addEventListener('click', closeLineupDialog);
document.getElementById('lineup-json-btn')?.addEventListener('click', downloadLineupJson);
document.getElementById('lineup-csv-btn')?.addEventListener('click', downloadLineupTitlesCsv);
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !document.getElementById('lineup-dialog')?.hidden) {
        closeLineupDialog();
    }
});
