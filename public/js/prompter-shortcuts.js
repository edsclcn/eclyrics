/**
 * Canonical prompter keyboard shortcuts for the main workspace.
 * Preview dock, global handlers, and the shortcuts dialog all derive from this registry.
 * The projected prompter window receives keys remotely — it must not define a second mapping.
 */
(function (global) {
    /** @typedef {'workspace' | 'prompter'} PrompterShortcutScope */

    /**
     * @typedef {object} PrompterShortcutDef
     * @property {string} id
     * @property {string} label
     * @property {string} [description]
     * @property {string[]} [codes] Event.code values handled by the workspace
     * @property {PrompterShortcutScope} scope
     * @property {boolean} [requiresPrompter] Needs an open prompter popup (default true for prompter scope)
     * @property {boolean} [allowRepeat]
     */

    /** Single source of truth — keep preview dialog and handlers aligned. */
    const PROMPTER_SHORTCUT_REGISTRY = [
        {
            id: 'send',
            label: 'Send to prompter',
            description: 'backtick — works anywhere except inside a text field',
            codes: ['Backquote'],
            scope: 'workspace',
            requiresPrompter: false,
            allowRepeat: false,
        },
        {
            id: 'playPause',
            label: 'Play / pause',
            codes: ['Space'],
            scope: 'prompter',
        },
        {
            id: 'speedPreset',
            label: 'Scroll speed',
            description: '1–9 presets, 0 pauses',
            codes: [
                'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5',
                'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0',
            ],
            scope: 'prompter',
        },
        {
            id: 'speedNudge',
            label: 'Scroll increments',
            codes: ['NumpadAdd', 'NumpadSubtract'],
            scope: 'prompter',
        },
        {
            id: 'adjacentBlock',
            label: 'Prev / Next block',
            codes: ['ArrowLeft', 'ArrowRight'],
            scope: 'workspace',
            requiresPrompter: false,
        },
        {
            id: 'theme',
            label: 'Theme',
            description: 'blue lyrics vs black & white',
            codes: ['KeyP'],
            scope: 'prompter',
        },
        {
            id: 'fontSize',
            label: 'Text size',
            codes: ['BracketLeft', 'BracketRight'],
            scope: 'prompter',
        },
        {
            id: 'lineWidth',
            label: 'Line width',
            description: 'main row keys',
            codes: ['Minus', 'Equal'],
            scope: 'prompter',
        },
        {
            id: 'scrollTop',
            label: 'Jump to top',
            description: 'when not auto-scrolling',
            codes: ['KeyT'],
            scope: 'prompter',
        },
        {
            id: 'manualScroll',
            label: 'Manual scroll',
            description: 'up / down — 100px per keypress (fixed)',
            codes: ['ArrowUp', 'ArrowDown'],
            scope: 'prompter',
        },
    ];

    const MODAL_BLOCK_IDS = ['preview-shortcuts-dialog', 'block-source-dialog'];

    const CODE_TO_SHORTCUT = new Map();
    for (const def of PROMPTER_SHORTCUT_REGISTRY) {
        for (const code of def.codes || []) {
            if (CODE_TO_SHORTCUT.has(code)) {
                throw new Error(
                    `prompter-shortcuts: duplicate code "${code}" (${CODE_TO_SHORTCUT.get(code).id} vs ${def.id})`,
                );
            }
            CODE_TO_SHORTCUT.set(code, def);
        }
    }

    function isTypingInEditableField(target) {
        if (!target || typeof target.closest !== 'function') return false;
        const el = target.nodeType === Node.ELEMENT_NODE ? target : null;
        if (!el) return false;
        if (el.isContentEditable) return true;
        const tag = el.tagName;
        if (tag === 'TEXTAREA') return true;
        if (tag === 'SELECT') return true;
        if (tag === 'INPUT') {
            const type = (el.getAttribute('type') || 'text').toLowerCase();
            const nonText = new Set([
                'button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'file', 'hidden', 'image',
            ]);
            return !nonText.has(type);
        }
        return false;
    }

    /** Block shortcuts when focus is on lyric editors or prompter dock controls. */
    function isPrompterShortcutTargetBlocked(target) {
        if (isTypingInEditableField(target)) return true;
        if (!target || typeof target.closest !== 'function') return false;
        if (target.closest('.textarea-cell textarea, .block-tab-editor')) return true;
        if (target.closest('.preview-prompter-dock button, .preview-prompter-dock input, .preview-prompter-dock select')) {
            return true;
        }
        return false;
    }

    function isModalBlockingPrompterShortcuts() {
        for (const id of MODAL_BLOCK_IDS) {
            const dlg = document.getElementById(id);
            if (dlg && !dlg.hidden) return true;
        }
        return false;
    }

    /**
     * @param {KeyboardEvent} event
     * @param {{ prompterOpen?: boolean }} [ctx]
     */
    function shouldIgnorePrompterShortcut(event, ctx = {}) {
        if (!event || typeof event.code !== 'string') return true;
        if (event.ctrlKey || event.metaKey || event.altKey) return true;
        if (isModalBlockingPrompterShortcuts()) return true;
        if (isPrompterShortcutTargetBlocked(event.target)) return true;

        const def = CODE_TO_SHORTCUT.get(event.code);
        if (!def) return true;
        if (event.repeat && !def.allowRepeat) return true;

        const needsPrompter = def.requiresPrompter !== false && def.scope === 'prompter';
        if (needsPrompter && !ctx.prompterOpen) return true;

        return false;
    }

    /**
     * @param {KeyboardEvent} event
     * @returns {{ id: string, def: PrompterShortcutDef, code: string, key: string } | null}
     */
    function resolvePrompterShortcut(event) {
        const def = CODE_TO_SHORTCUT.get(event.code);
        if (!def) return null;
        return { id: def.id, def, code: event.code, key: event.key || '' };
    }

    /** Keys the prompter popup may receive via postMessage — must match registry prompter codes. */
    function getRemotePrompterKeyCodes() {
        const codes = new Set();
        for (const def of PROMPTER_SHORTCUT_REGISTRY) {
            if (def.scope !== 'prompter') continue;
            if (def.id === 'manualScroll') continue;
            for (const code of def.codes || []) codes.add(code);
        }
        return codes;
    }

    function assertRemotePrompterKeySupported(code) {
        if (!getRemotePrompterKeyCodes().has(code)) {
            console.warn(`[eclyrics] Ignoring unsupported remote prompter key: ${code}`);
            return false;
        }
        return true;
    }

    function formatShortcutKeys(def) {
        const map = {
            Backquote: '`',
            Space: 'Space',
            ArrowLeft: '←',
            ArrowRight: '→',
            ArrowUp: '↑',
            ArrowDown: '↓',
            BracketLeft: '[',
            BracketRight: ']',
            Minus: '-',
            Equal: '=',
            KeyP: 'P',
            KeyT: 'T',
            NumpadAdd: 'Numpad +',
            NumpadSubtract: 'Numpad −',
        };
        const codes = def.codes || [];
        if (def.id === 'speedPreset') {
            return '<kbd>1</kbd>–<kbd>9</kbd>, <kbd>0</kbd>';
        }
        return codes.map((c) => `<kbd>${map[c] || c.replace(/^Digit/, '').replace(/^Key/, '')}</kbd>`).join(' ');
    }

    function formatShortcutKeysPlain(def) {
        const map = {
            Backquote: '`',
            Space: 'Space',
            ArrowLeft: '←',
            ArrowRight: '→',
            ArrowUp: '↑',
            ArrowDown: '↓',
            BracketLeft: '[',
            BracketRight: ']',
            Minus: '-',
            Equal: '=',
            KeyP: 'P',
            KeyT: 'T',
            NumpadAdd: 'Numpad +',
            NumpadSubtract: 'Numpad −',
        };
        const codes = def.codes || [];
        if (def.id === 'speedPreset') return '1–9, 0';
        return codes.map((c) => map[c] || c.replace(/^Digit/, '').replace(/^Key/, '')).join(' / ');
    }

    function renderPrompterHelpTable(tbody) {
        if (!tbody) return;
        tbody.replaceChildren();
        for (const def of PROMPTER_SHORTCUT_REGISTRY) {
            const tr = document.createElement('tr');
            const tdKey = document.createElement('td');
            tdKey.textContent = formatShortcutKeysPlain(def);
            const tdFn = document.createElement('td');
            let fn = def.label;
            if (def.description) fn += ` — ${def.description}`;
            tdFn.textContent = fn;
            tr.appendChild(tdKey);
            tr.appendChild(tdFn);
            tbody.appendChild(tr);
        }
    }

    function renderPreviewShortcutsList(container) {
        if (!container) return;
        container.replaceChildren();
        for (const def of PROMPTER_SHORTCUT_REGISTRY) {
            const row = document.createElement('div');
            const dt = document.createElement('dt');
            dt.textContent = def.label;
            const dd = document.createElement('dd');
            dd.innerHTML = formatShortcutKeys(def);
            if (def.description) {
                dd.appendChild(document.createTextNode(` — ${def.description}`));
            }
            row.appendChild(dt);
            row.appendChild(dd);
            container.appendChild(row);
        }
    }

    function assertPrompterShortcutParity() {
        const handlerCodes = new Set(CODE_TO_SHORTCUT.keys());
        const registryCodes = new Set();
        for (const def of PROMPTER_SHORTCUT_REGISTRY) {
            for (const code of def.codes || []) registryCodes.add(code);
        }
        if (handlerCodes.size !== registryCodes.size) {
            throw new Error('prompter-shortcuts: registry/handler code set mismatch');
        }
        for (const code of registryCodes) {
            if (!handlerCodes.has(code)) {
                throw new Error(`prompter-shortcuts: missing handler for ${code}`);
            }
        }
    }

    const api = {
        PROMPTER_SHORTCUT_REGISTRY,
        isTypingInEditableField,
        isPrompterShortcutTargetBlocked,
        isModalBlockingPrompterShortcuts,
        shouldIgnorePrompterShortcut,
        resolvePrompterShortcut,
        getRemotePrompterKeyCodes,
        assertRemotePrompterKeySupported,
        renderPreviewShortcutsList,
        renderPrompterHelpTable,
        assertPrompterShortcutParity,
    };

    assertPrompterShortcutParity();

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        global.EclyricsPrompterShortcuts = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : window);
