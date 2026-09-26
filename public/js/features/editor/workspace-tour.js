(function () {
    const STEPS = [
        {
            title: 'Build your lineup',
            description: 'Use one tab for each service or setlist. Add blocks with +, rename tabs with the pencil, and arrange lyrics in the order you will present them.',
            visual: `
                <div class="tour-art__window">
                    <div class="tour-art__tabs"><span class="tour-art__tab is-active">TAB 1</span><span class="tour-art__tab">TAB 2</span><span class="tour-art__add">+</span></div>
                    <div class="tour-art__blocks"><span class="tour-art__block"><b>BLOCK 1</b><strong>Opening song</strong></span><span class="tour-art__block"><b>BLOCK 2</b><strong>Message</strong></span><span class="tour-art__block tour-art__block--empty"><i class="fa-solid fa-plus"></i></span></div>
                </div>`,
        },
        {
            title: 'Add lyrics from a block',
            description: 'Start with + on an empty block, then choose Search library, Manually type, or Paste lyrics. You can paste multiline lyrics directly into the search field. The app recognizes the text as lyrics. Paste lyrics reads the latest clipboard contents automatically, so Ctrl+V is not needed.',
            visual: `
                <div class="tour-art__window tour-art__add-art">
                    <div class="tour-art__empty-block"><i class="fa-solid fa-plus"></i><span>EMPTY BLOCK</span></div>
                    <div class="tour-art__choice-arrow"><i class="fa-solid fa-arrow-right"></i></div>
                    <div class="tour-art__choice-list"><strong>Choose how to add lyrics</strong><span><i class="fa-solid fa-magnifying-glass"></i> Search library</span><span><i class="fa-solid fa-keyboard"></i> Manually type</span><span><i class="fa-solid fa-paste"></i> Paste lyrics</span></div>
                </div>`,
        },
        {
            title: 'Search the library',
            description: 'Search matches across the song title, hymn number, the actual lyrics, and the adaptation source/name. A single search can find any of these fields and show every matching result.',
            visual: `
                <div class="tour-art__window tour-art__search-art">
                    <div class="tour-art__search-field"><i class="fa-solid fa-magnifying-glass"></i><span>hymn number, lyric line, or adaptation name…</span></div>
                    <div class="tour-art__library-card"><div class="tour-art__library-card-top"><strong>A MILLION THANKS TO YOU</strong><em class="block-source-pill block-source-pill--adaptation">ADAPTATION</em></div><small>Adapted from “I Can’t Stop Loving You”</small><p>A million thanks to You You cleared up my mind…</p></div>
                    <div class="tour-art__library-card"><div class="tour-art__library-card-top"><strong>109 - HALINA OH, MGA KAPATID</strong><em class="block-source-pill block-source-pill--himnario">HIMNARIO</em></div><p>Halina, Oh mga kapatid At tayo’y magsiawit…</p></div>
                </div>`,
        },
        {
            title: 'Filter results by category',
            description: 'Use category filters to narrow the library to HIMNARIO, ORIGINAL, ADAPTATION, ASOP/F, REVISION, or ARCHIVED. Select multiple categories when needed, then clear the filters to return to the full result set.',
            visual: `
                <div class="tour-art__window tour-art__filter-art">
                    <div class="tour-art__filter-row"><span class="block-source-filter-pill block-source-filter-pill--active block-source-filter-pill--himnario is-selected">HIMNARIO</span><span class="block-source-filter-pill block-source-filter-pill--original">ORIGINAL</span><span class="block-source-filter-pill block-source-filter-pill--active block-source-filter-pill--adaptation is-selected">ADAPTATION</span><span class="block-source-filter-pill block-source-filter-pill--asop-f">ASOP/F</span><span class="block-source-filter-pill block-source-filter-pill--revision">REVISION</span><span class="block-source-filter-pill block-source-filter-pill--archived">ARCHIVED</span></div>
                    <div class="tour-art__filter-note"><i class="fa-solid fa-filter"></i><strong>2 filters active</strong><button type="button">Clear filters</button></div>
                    <div class="tour-art__library-card"><div class="tour-art__library-card-top"><strong>31 - HESUS, LIGAYA NG PUSO</strong><span class="tour-art__pill-stack"><em class="block-source-pill block-source-pill--himnario">HIMNARIO</em><em class="block-source-pill block-source-pill--adaptation">ADAPTATION</em></span></div><p>Only matching results remain visible.</p></div>
                </div>`,
        },
        {
            title: 'Edit lyrics one block at a time',
            description: '• Select a result to fill a block.\n• Type or paste manually using a title line, blank line, then lyrics.\n• Click a block title to open the full editor. The lyrics remain connected to the block and the preview updates as you work.',
            visual: `
                <div class="tour-art__split tour-art__edit-preview-art">
                    <div class="tour-art__editor">
                        <div class="tour-art__editor-head"><span class="tour-art__label">EDITING: SELECTED SONG</span><button type="button"><i class="fa-solid fa-table-cells"></i> Back to blocks</button></div>
                        <div class="tour-art__lyrics-editor"><strong>SELECTED SONG</strong><span>Bawat isa’y may pinagdaraanan</span><span>May mga hirap, mga kalungkutan</span><span>May nangungulila, may namamanglaw</span><span>At ang pagluha ay hindi mapigilan</span><span class="tour-art__lyrics-gap"></span><span>Salamat, Oh Hesus sa Iyong pagmamahal</span></div>
                    </div>
                    <div class="tour-art__editor tour-art__editor--preview"><span class="tour-art__label">16∶9 PREVIEW</span><div class="tour-art__stage-shell"><div class="tour-art__stage"></div></div></div>
                </div>`,
        },
        {
            title: 'Preview and send to prompter',
            description: 'The preview follows the selected block in the same blue 16∶9 stage used by the prompter. Send to prompter opens or updates the live presentation. Place it on another monitor that is not covered by other apps, or behind this controls page with a small visible edge so it stays active.',
            visual: `
                <div class="tour-art__window tour-art__prompter-art">
                    <div class="tour-art__stage-shell"><div class="tour-art__stage"></div></div>
                    <div class="tour-art__stage-shortcuts"><span><i class="fa-solid fa-keyboard"></i> KEYBOARD SHORTCUTS</span><small>Open the complete reference</small></div>
                    <div class="tour-art__stage-controls"><span class="is-emphasis"><i class="fa-solid fa-display"></i> SEND TO PROMPTER</span><i class="fa-solid fa-play"></i><i class="fa-solid fa-chevron-left"></i><i class="fa-solid fa-chevron-right"></i><i class="fa-solid fa-chevron-up"></i><i class="fa-solid fa-chevron-down"></i><i class="fa-solid fa-angles-up"></i><i class="fa-solid fa-font"></i><i class="fa-solid fa-font"></i><i class="fa-solid fa-arrows-left-right"></i><i class="fa-solid fa-arrows-left-right"></i><i class="fa-solid fa-palette"></i><b>SPEED ━━━━━</b></div>
                </div>`,
        },
        {
            title: 'Use every prompter control',
            layout: 'controls',
            description: '',
            visual: `
                <div class="tour-art__window tour-art__controls-art">
                    <p class="tour-art__control-instruction">Click any control below to see what it does. The selected control shows its keyboard shortcut when one exists.</p>
                    <div class="tour-art__control-row">
                        <button type="button" class="tour-art__control-button tour-art__control-button--send" data-control-name="Send to prompter" data-control-description="Open or update the live prompter with the active block." data-control-shortcut="Backtick (&#96;)"><i class="fa-solid fa-display"></i><small>Send to prompter</small></button>
                        <button type="button" class="tour-art__control-button" data-control-name="Play / pause" data-control-description="Start or pause automatic lyric scrolling." data-control-shortcut="Space"><i class="fa-solid fa-play"></i><small>Play</small></button>
                        <button type="button" class="tour-art__control-button" data-control-name="Previous block" data-control-description="Click once to move to the previous lyric block." data-control-shortcut="Double-press ←"><i class="fa-solid fa-chevron-left"></i><small>Prev</small></button>
                        <button type="button" class="tour-art__control-button" data-control-name="Next block" data-control-description="Click once to move to the next lyric block." data-control-shortcut="Double-press →"><i class="fa-solid fa-chevron-right"></i><small>Next</small></button>
                        <button type="button" class="tour-art__control-button" data-control-name="Scroll up" data-control-description="Hold to scroll upward continuously at the current speed. Arrow ↑/↓ keys and the scroll wheel are separate fixed-step controls."><i class="fa-solid fa-chevron-up"></i><small>Up</small></button>
                        <button type="button" class="tour-art__control-button" data-control-name="Scroll down" data-control-description="Hold to scroll downward continuously at the current speed. Arrow ↑/↓ keys and the scroll wheel are separate fixed-step controls."><i class="fa-solid fa-chevron-down"></i><small>Down</small></button>
                        <button type="button" class="tour-art__control-button" data-control-name="Jump to top" data-control-description="Return to the top when automatic scrolling is paused." data-control-shortcut="T"><i class="fa-solid fa-angles-up"></i><small>Top</small></button>
                        <button type="button" class="tour-art__control-button" data-control-name="Smaller text" data-control-description="Decrease the projected lyric text size." data-control-shortcut="["><i class="fa-solid fa-font preview-icon-glyph--sm"></i><small>Smaller</small></button>
                        <button type="button" class="tour-art__control-button" data-control-name="Larger text" data-control-description="Increase the projected lyric text size." data-control-shortcut="]"><i class="fa-solid fa-font preview-icon-glyph--lg"></i><small>Larger</small></button>
                        <button type="button" class="tour-art__control-button" data-control-name="Narrower lines" data-control-description="Reduce the lyric line width." data-control-shortcut="−"><i class="fa-solid fa-arrows-left-right preview-icon-glyph--narrow"></i><small>Narrower</small></button>
                        <button type="button" class="tour-art__control-button" data-control-name="Wider lines" data-control-description="Increase the lyric line width." data-control-shortcut="="><i class="fa-solid fa-arrows-left-right preview-icon-glyph--wide"></i><small>Wider</small></button>
                        <button type="button" class="tour-art__control-button" data-control-name="Stage theme" data-control-description="Switch between the blue lyrics stage and black-and-white stage." data-control-shortcut="P"><i class="fa-solid fa-palette"></i><small>Theme</small></button>
                        <button type="button" class="tour-art__speed" data-control-name="Scroll speed" data-control-description="Adjust scrolling speed. 1–9 set speed presets, 0 pauses, and Numpad + / − nudges the speed." data-control-shortcut="1–9, 0, Numpad + / −"><i class="fa-solid fa-gauge-high"></i><b>SPEED</b><i class="tour-art__speed-track"></i></button>
                    </div>
                </div>`,
        },
        {
            title: 'Use keyboard shortcuts',
            layout: 'shortcuts',
            description: 'Open Keyboard shortcuts in the prompter dock for this complete reference. Keyboard arrows and the scroll wheel manually move lyrics by fixed steps; they are separate from the speed-based toolbar up/down controls.',
            visual: `
                <div class="tour-art__window tour-art__shortcut-art">
                    <div class="tour-art__shortcut-table-head"><span>Action</span><span>Keys</span><span>What it does</span></div>
                    <div class="tour-art__shortcut-row"><strong>Send to prompter</strong><span><kbd>` + '`' + `</kbd></span><span>Sends the active block</span></div>
                    <div class="tour-art__shortcut-row"><strong>Play / pause</strong><span><kbd>SPACE</kbd></span><span>Starts or pauses auto-scroll</span></div>
                    <div class="tour-art__shortcut-row"><strong>Scroll speed presets</strong><span><kbd>1–9</kbd><kbd>0</kbd></span><span>1–9 set speed; 0 pauses</span></div>
                    <div class="tour-art__shortcut-row"><strong>Scroll speed nudge</strong><span><kbd>NUMPAD +</kbd><kbd>NUMPAD −</kbd></span><span>Adjusts speed incrementally</span></div>
                    <div class="tour-art__shortcut-row"><strong>Previous / next block</strong><span><kbd>←</kbd><kbd>←</kbd> / <kbd>→</kbd><kbd>→</kbd></span><span>Double-press the same arrow within 400 ms</span></div>
                    <div class="tour-art__shortcut-row"><strong>Stage theme</strong><span><kbd>P</kbd></span><span>Toggles blue / B&amp;W stage</span></div>
                    <div class="tour-art__shortcut-row"><strong>Text size</strong><span><kbd>[</kbd><kbd>]</kbd></span><span>Makes text smaller / larger</span></div>
                    <div class="tour-art__shortcut-row"><strong>Line width</strong><span><kbd>−</kbd><kbd>=</kbd></span><span>Makes lines narrower / wider</span></div>
                    <div class="tour-art__shortcut-row"><strong>Jump to top</strong><span><kbd>T</kbd></span><span>Returns to the top when paused</span></div>
                    <div class="tour-art__shortcut-row"><strong>Manual scroll</strong><span><kbd>↑</kbd><kbd>↓</kbd></span><span>Fixed 100px step; hold repeats</span></div>
                    <div class="tour-art__shortcut-row"><strong>Scroll wheel</strong><span><kbd>WHEEL</kbd></span><span>Fixed 50px step in the preview</span></div>
                </div>`,
        },
        {
            title: 'Save or load a lineup',
            description: 'Save lineup opens a review of every tab and block. Export the full multi-tab lineup as JSON or save its titles as CSV, then use Load lineup to bring the tabs, block order, titles, and lyrics back into the workspace.',
            visual: `
                <div class="tour-art__window tour-art__save-art">
                    <div class="tour-art__save-actions"><span><i class="fa-solid fa-download"></i> Save lineup</span><span><i class="fa-solid fa-folder-open"></i> Load JSON</span></div>
                    <div class="tour-art__json"><span>{</span><span>&nbsp;&nbsp;"tabs": [</span><span>&nbsp;&nbsp;&nbsp;&nbsp;"TAB 1", "TAB 2"</span><span>&nbsp;&nbsp;]</span><span>}</span></div>
                </div>`,
        },
    ];

    const dialog = document.getElementById('workspace-tour-dialog');
    const openButton = document.getElementById('workspace-tour-btn');
    if (!dialog || !openButton) return;

    const title = document.getElementById('workspace-tour-title');
    const description = document.getElementById('workspace-tour-description');
    const controlDefinition = document.getElementById('workspace-tour-control-definition');
    const step = document.getElementById('workspace-tour-step');
    const visual = document.getElementById('workspace-tour-visual');
    const progress = document.getElementById('workspace-tour-progress');
    const previous = document.getElementById('workspace-tour-prev');
    const next = document.getElementById('workspace-tour-next');
    const close = document.getElementById('workspace-tour-close');
    let current = 0;
    let previousFocus = null;

    STEPS.forEach((_, index) => {
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'workspace-tour__dot';
        dot.setAttribute('aria-label', `Go to tour step ${index + 1}`);
        dot.addEventListener('click', () => {
            current = index;
            render();
        });
        progress.appendChild(dot);
    });

    function render() {
        const active = STEPS[current];
        title.textContent = active.title;
        if (active.descriptionHtml) {
            description.innerHTML = active.descriptionHtml;
        } else {
            description.textContent = active.description;
        }
        step.textContent = `${current + 1} of ${STEPS.length}`;
        visual.innerHTML = active.visual;
        dialog.classList.toggle('workspace-tour--controls', active.layout === 'controls');
        controlDefinition.hidden = active.layout !== 'controls';
        controlDefinition.innerHTML = '';
        const controlButtons = visual.querySelectorAll('[data-control-name]');
        controlButtons.forEach((button) => {
            button.addEventListener('click', () => {
                controlButtons.forEach((control) => {
                    control.classList.toggle('is-focused', control === button);
                });
                const shortcut = button.dataset.controlShortcut;
                controlDefinition.hidden = false;
                controlDefinition.innerHTML = `<strong>${button.dataset.controlName}</strong><span>${button.dataset.controlDescription}</span>${shortcut ? `<kbd>${shortcut}</kbd>` : ''}`;
            });
        });
        previous.disabled = current === 0;
        next.textContent = current === STEPS.length - 1 ? 'Done' : 'Next';
        progress.querySelectorAll('.workspace-tour__dot').forEach((dot, index) => {
            const isActive = index === current;
            dot.classList.toggle('is-active', isActive);
            dot.setAttribute('aria-current', isActive ? 'step' : 'false');
        });
    }

    function open() {
        previousFocus = document.activeElement;
        current = 0;
        render();
        dialog.hidden = false;
        dialog.setAttribute('aria-hidden', 'false');
        openButton.setAttribute('aria-expanded', 'true');
        close.focus();
    }

    function dismiss() {
        dialog.hidden = true;
        dialog.setAttribute('aria-hidden', 'true');
        openButton.setAttribute('aria-expanded', 'false');
        previousFocus?.focus?.({ preventScroll: true });
    }

    openButton.setAttribute('aria-haspopup', 'dialog');
    openButton.setAttribute('aria-expanded', 'false');
    openButton.addEventListener('click', open);
    close.addEventListener('click', dismiss);
    document.getElementById('workspace-tour-backdrop')?.addEventListener('click', dismiss);
    previous.addEventListener('click', () => {
        if (current > 0) {
            current -= 1;
            render();
        }
    });
    next.addEventListener('click', () => {
        if (current < STEPS.length - 1) {
            current += 1;
            render();
        } else {
            dismiss();
        }
    });
    document.addEventListener('keydown', (event) => {
        if (dialog.hidden) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            dismiss();
        } else if (event.key === 'ArrowLeft' && current > 0) {
            current -= 1;
            render();
        } else if (event.key === 'ArrowRight' && current < STEPS.length - 1) {
            current += 1;
            render();
        }
    });
})();
