/**
 * Event Prompter — US Letter 8.5×11, two columns → next page; Tahoma; prompter output single column.
 */

(function () {
  const STORAGE_KEY = 'eclyrics-event-prompter';
  const DISPLAY_WINDOW = 'eclyricsEventPrompter';

  /** All layout / typography tuning — keep in sync with event-prompter.css where noted */
  const CONFIG = {
    PAPER_WIDTH_IN: 8.5,
    PAPER_HEIGHT_IN: 11,
    PAPER_MARGIN_IN: 0.5,
    COLUMN_GUTTER_IN: 0,
    EDITOR_FONT_PT: 12,
    EDITOR_LINE_HEIGHT: 1,
    EVENT_TITLE_PT: 18,
    OUTPUT_FONT_PX: 36,
    /** Vertical rhythm in editor (em, relative to editor font) */
    SPACING_AFTER_TAKE_EM: 1,
    SPACING_AFTER_SECTION_EM: 1,
    /** Gap between section body and next take (em on section content textarea) */
    SPACING_SECTION_TEXTAREA_TO_NEXT_TAKE_EM: 0,
    /** Prompter flow (36px root) */
    SPACING_FLOW_AFTER_SECTION_EM: 1,
    SPACING_FLOW_AFTER_TAKE_EM: 1,
    /** Estimated lines reserved for the event header block above the two columns (must match real layout) */
    PAPER_HEADER_LINES: 5,
    /** Last take only: one row for +Take and +End banner (same row). Section add is inline on last section header. */
    LAST_TAKE_ACTION_ROW_LINES: 1,
    /** Minimum counted lines for section title/body chrome (matches textarea min rows) */
    MIN_SECTION_TITLE_LINES: 1,
    MIN_SECTION_CONTENT_LINES: 1,
  };

  const SECTION_BG_BLUE = '#CAEDFB';

  const LINE_HEIGHT_IN = (CONFIG.EDITOR_FONT_PT / 72) * CONFIG.EDITOR_LINE_HEIGHT;
  const USABLE_HEIGHT_IN = CONFIG.PAPER_HEIGHT_IN - 2 * CONFIG.PAPER_MARGIN_IN;
  // Reserve header lines so the packing algorithm matches “header + two columns on Letter”
  const LINES_PER_COLUMN = Math.max(
    1,
    Math.floor(USABLE_HEIGHT_IN / LINE_HEIGHT_IN) - CONFIG.PAPER_HEADER_LINES,
  );

  const EMPTY_STATE = {
    eventName: '',
    eventDateTime: '',
    endBlockText: '',
    takes: [{ num: 0, timestamp: '', sections: [{ title: '', bg: 'blue', content: '' }] }],
    hasEndBlock: false,
  };

  const SAMPLE = {
    eventName: "MCGI – INTERNATIONAL SENIORS' DAY",
    eventDateTime: 'MAR 1, 2026, SUN / 8:00 AM',
    endBlockText: "** END OF INTERNATIONAL SENIORS' DAY (03-01-26) **",
    takes: [
      { num: 0, timestamp: '8:00AM', sections: [{ title: 'REGISTRATION & OPENING', bg: 'blue', content: 'RESERVED\nHALLELUJAH, AMEN' }] },
      { num: 1, timestamp: '9:00AM', sections: [{ title: 'CONGREGATIONAL SINGING', bg: 'blue', content: "HIMNO #30 – MAGSAYA TAYO NGAYON" }] },
      { num: 2, timestamp: '9:20AM', sections: [{ title: 'OPENING PRAYER', bg: 'blue', content: '' }] },
      { num: 3, timestamp: '9:30AM', sections: [{ title: "KUYA'S MESSAGE", bg: 'blue', content: '' }] },
      { num: 4, timestamp: '10:30AM', sections: [{ title: 'END OF PROGRAM', bg: 'blue', content: '' }] },
    ],
    hasEndBlock: true,
  };

  let state = JSON.parse(JSON.stringify(EMPTY_STATE));
  let docDarkMode = false;
  let lastLayoutSignature = '';
  let layoutReflowTimer = null;

  function normalizeStateUpper() {
    state.eventName = (state.eventName ?? '').toUpperCase();
    state.eventDateTime = (state.eventDateTime ?? '').toUpperCase();
    state.endBlockText = (state.endBlockText ?? '').toUpperCase();
    state.takes = (state.takes || []).map((t) => ({
      ...t,
      timestamp: (t.timestamp ?? '').toUpperCase(),
      sections: (t.sections || []).map((s) => ({
        ...s,
        title: (s.title ?? '').toUpperCase(),
        content: (s.content ?? '').toUpperCase(),
        bg: 'blue',
      })),
    }));
  }

  let history = [];
  let histIdx = -1;
  let applyingHistory = false;
  let historyDebounceTimer = null;

  /** @param {boolean} [force] — set true before structural edits so snapshot is always stored */
  function pushHistory(force) {
    if (applyingHistory) return;
    syncStateFromForm();
    const snap = JSON.stringify(state);
    if (!force && history[histIdx] === snap) return;
    history = history.slice(0, histIdx + 1);
    history.push(snap);
    histIdx = history.length - 1;
    while (history.length > 100) {
      history.shift();
      histIdx--;
    }
  }

  function scheduleHistoryPush() {
    clearTimeout(historyDebounceTimer);
    historyDebounceTimer = setTimeout(pushHistory, 350);
  }

  function initHistory() {
    syncStateFromForm();
    const snap = JSON.stringify(state);
    history = [snap];
    histIdx = 0;
  }

  function undo() {
    if (histIdx <= 0) return;
    applyingHistory = true;
    histIdx -= 1;
    state = JSON.parse(history[histIdx]);
    applyStateToForm();
    applyingHistory = false;
    updateStripPreviewNoSync();
  }

  function redo() {
    if (histIdx >= history.length - 1) return;
    applyingHistory = true;
    histIdx += 1;
    state = JSON.parse(history[histIdx]);
    applyStateToForm();
    applyingHistory = false;
    updateStripPreviewNoSync();
  }

  function applyStateToForm() {
    const form = document.getElementById('ep-form');
    if (form) {
      const n = form.querySelector('#ep-event-name');
      const d = form.querySelector('#ep-event-datetime');
      if (n) n.value = state.eventName ?? '';
      if (d) d.value = state.eventDateTime ?? '';
    }
    renderForm();
    const endInp = document.getElementById('ep-end-block');
    if (endInp) endInp.value = state.endBlockText ?? '';
    requestAnimationFrame(() => {
      document.querySelectorAll('.ep-section-content, textarea.ep-section-input').forEach(autoResizeTextarea);
    });
  }

  function updateStripPreviewNoSync() {
    const el = document.getElementById('ep-strip-content');
    if (!el) return;
    const html = getStripHTML();
    if (!html.trim()) {
      el.className = 'ep-strip-empty';
      el.textContent = 'Add event name and takes.';
      return;
    }
    el.className = 'ep-strip-content ep-strip-flow';
    el.innerHTML = html;
  }

  function forceUpperInput(el) {
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const v = el.value.toUpperCase();
    if (el.value !== v) {
      el.value = v;
      try {
        el.setSelectionRange(start, end);
      } catch (_) {}
    }
  }

  function autoResizeTextarea(el) {
    if (!el || el.tagName !== 'TEXTAREA') return;
    el.style.height = '0';
    el.style.height = `${el.scrollHeight}px`;
  }

  function bindAutoResize(textarea) {
    const onInput = () => {
      autoResizeTextarea(textarea);
    };
    textarea.addEventListener('input', onInput);
    requestAnimationFrame(() => autoResizeTextarea(textarea));
  }

  function getPanel() {
    return document.getElementById('panel-event');
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s ?? '';
    return d.innerHTML;
  }

  /** Approximate wrapped line count using canvas + measured word wrapping */
  const MEASURE = (() => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const paperWpx = CONFIG.PAPER_WIDTH_IN * 96;
    const paperMarginPx = CONFIG.PAPER_MARGIN_IN * 96;
    const innerWpx = paperWpx - 2 * paperMarginPx;
    const colWpx = innerWpx / 2;
    // Must be close to textarea width. We subtract a small constant for paddings.
    const textMaxWpx = Math.max(120, Math.floor(colWpx - 14));
    return { ctx, textMaxWpx };
  })();

  function getWrappedLineCount(text, fontPt) {
    const s = String(text ?? '');
    if (!s.trim()) return 0;
    const font = `bold ${fontPt}pt Tahoma`;
    MEASURE.ctx.font = font;
    const maxW = MEASURE.textMaxWpx;
    const rawLines = s.replace(/\r/g, '').split('\n');

    let total = 0;
    for (const rawLine of rawLines) {
      const line = String(rawLine);
      if (!line.trim()) {
        total += 1;
        continue;
      }
      const parts = line.split(/\s+/).filter(Boolean);
      let curW = 0;
      let count = 1;
      for (let i = 0; i < parts.length; i++) {
        const word = parts[i];
        const wordW = MEASURE.ctx.measureText(word).width;
        const spaceW = i === 0 ? 0 : MEASURE.ctx.measureText(' ').width;
        if (curW + spaceW + wordW > maxW && curW > 0) {
          count += 1;
          curW = wordW;
        } else if (curW + spaceW + wordW > maxW) {
          // Very long word: split into characters by width.
          let w = 0;
          let sub = 1;
          for (const ch of word) {
            const chW = MEASURE.ctx.measureText(ch).width;
            if (w + chW > maxW) {
              sub += 1;
              w = chW;
            } else {
              w += chW;
            }
          }
          count += sub - 1;
          curW = Math.min(wordW, maxW);
        } else {
          curW += spaceW + wordW;
        }
      }
      total += count;
    }
    return total;
  }

  /** Line budget for column fill: take header + optional last-take action row + sections + spacing */
  function takeLines(t) {
    const ti = state.takes.indexOf(t);
    const isLast = ti >= 0 && ti === state.takes.length - 1;
    const actionRow = isLast && !state.hasEndBlock ? CONFIG.LAST_TAKE_ACTION_ROW_LINES : 0;
    if (!t.sections || !t.sections.length) return 1 + actionRow + Math.round(CONFIG.SPACING_AFTER_TAKE_EM);
    let n = 1 + actionRow; // header [+ Take/End row on last take when end banner not active]
    for (const s of t.sections) {
      n += Math.max(CONFIG.MIN_SECTION_TITLE_LINES, getWrappedLineCount(s.title, 11));
      n += Math.max(CONFIG.MIN_SECTION_CONTENT_LINES, getWrappedLineCount(s.content, CONFIG.EDITOR_FONT_PT));
      n += Math.round(CONFIG.SPACING_AFTER_SECTION_EM);
    }
    n += Math.round(CONFIG.SPACING_AFTER_TAKE_EM);
    return n;
  }

  /** Distribute by content: fill col1 first, then col2, then next page */
  function distributeByContent(takes, endBlockText, hasEndBlock) {
    const endLines = hasEndBlock && endBlockText ? getWrappedLineCount(endBlockText, CONFIG.EDITOR_FONT_PT) : 0;
    const cols = [];
    let idx = 0;

    while (idx < takes.length || (cols.length % 2 === 1 && endLines > 0)) {
      let lines = 0;
      const colTakes = [];
      while (idx < takes.length && lines + takeLines(takes[idx]) <= LINES_PER_COLUMN) {
        colTakes.push(takes[idx]);
        lines += takeLines(takes[idx]);
        idx++;
      }
      // One take can exceed a column; still place it so we always advance (avoids infinite loop).
      if (colTakes.length === 0 && idx < takes.length) {
        colTakes.push(takes[idx]);
        lines += takeLines(takes[idx]);
        idx++;
      }
      const atEnd = idx >= takes.length;
      const addEnd = atEnd && hasEndBlock && endBlockText && lines + endLines <= LINES_PER_COLUMN;
      cols.push({
        takes: colTakes,
        endBlock: addEnd ? endBlockText : null,
      });
      if (addEnd) break;
    }
    if (cols.length === 0 && hasEndBlock && endBlockText) {
      cols.push({ takes: [], endBlock: endBlockText });
    }
    return cols;
  }

  function renderBlock(type, content, opts = {}) {
    if (!content || !String(content).trim()) return null;
    const div = document.createElement('div');
    div.className = `ep-block-${type}`;
    div.textContent = String(content).trim();
    if (opts.bg) div.style.background = opts.bg;
    if (opts.color) div.style.color = opts.color;
    return div;
  }

  function buildColumnHTML(takes, endBlockText, hasEndBlock, isDark) {
    const frag = document.createDocumentFragment();
    const fg = isDark ? '#fff' : '#000';

    for (const t of takes) {
      const tk = renderBlock('take', `[TAKE ${t.num}] ${t.timestamp || ''}`.trim() || `[TAKE ${t.num}]`);
      if (tk) frag.appendChild(tk);
      const sections = t.sections || (t.section ? [{ title: t.section, bg: 'blue', content: (t.lines || []).join('\n') }] : []);
      for (const s of sections) {
        if (s.title && String(s.title).trim()) {
          const el = renderBlock('section', s.title, { bg: SECTION_BG_BLUE, color: '#0070C0' });
          if (el) frag.appendChild(el);
        }
        const lines = (s.content || '').split('\n').filter(Boolean);
        for (const line of lines) {
          const el = renderBlock('subitem', line.trim(), { color: fg });
          if (el) frag.appendChild(el);
        }
      }
    }
    if (hasEndBlock && endBlockText) {
      const endEl = renderBlock('end', endBlockText.replace(/\*\*/g, '').trim());
      if (endEl) frag.appendChild(endEl);
    }
    return frag;
  }

  /** Get editor columns by content fill (same packing as export + end block) */
  function getEditorColumns() {
    const cols = distributeByContent(state.takes, state.endBlockText, state.hasEndBlock);
    const result = [];
    for (let i = 0; i < cols.length; i += 2) {
      const c1 = cols[i];
      const c2 = cols[i + 1];
      result.push({
        col1: c1?.takes || [],
        col2: c2?.takes || [],
      });
    }
    if (result.length === 0) result.push({ col1: [], col2: [] });
    return result;
  }

  function computeLayoutSignature() {
    const cols = distributeByContent(state.takes, state.endBlockText, state.hasEndBlock);
    return JSON.stringify(
      cols.map((c) => ({
        takes: c.takes.map((t) => state.takes.indexOf(t)),
        end: !!c.endBlock,
      })),
    );
  }

  function scheduleLayoutReflow() {
    clearTimeout(layoutReflowTimer);
    layoutReflowTimer = setTimeout(() => {
      syncStateFromForm();
      const sig = computeLayoutSignature();
      if (sig === lastLayoutSignature) return;
      lastLayoutSignature = sig;
      renderForm();
      const endInp = document.getElementById('ep-end-block');
      if (endInp) endInp.value = state.endBlockText ?? '';
      requestAnimationFrame(() => {
        document.querySelectorAll('.ep-section-content, textarea.ep-section-input').forEach(autoResizeTextarea);
      });
      updateStripPreviewNoSync();
    }, 90);
  }

  /** Single-column flow for live preview + prompter window: 36px face, spacer after each section and after each take */
  function buildPrompterFlowFragment(isDark) {
    const frag = document.createDocumentFragment();
    const fg = isDark ? '#fff' : '#000';
    const { eventName, eventDateTime, takes, endBlockText, hasEndBlock } = state;

    const title = document.createElement('div');
    title.className = 'ep-block-title';
    title.innerHTML = `${escapeHtml(eventName)}<br>${escapeHtml(eventDateTime)}`;
    frag.appendChild(title);

    const sp0 = document.createElement('div');
    sp0.className = 'ep-flow-spacer';
    frag.appendChild(sp0);

    for (const t of takes) {
      const takeEl = renderBlock('take', `[TAKE ${t.num}] ${t.timestamp || ''}`.trim() || `[TAKE ${t.num}]`);
      if (takeEl) frag.appendChild(takeEl);
      const sections = t.sections || (t.section ? [{ title: t.section, bg: 'blue', content: (t.lines || []).join('\n') }] : []);
      for (const s of sections) {
        if (s.title && String(s.title).trim()) {
          const el = renderBlock('section', s.title, { bg: SECTION_BG_BLUE, color: '#0070C0' });
          if (el) frag.appendChild(el);
        }
        const lines = (s.content || '').split('\n').filter(Boolean);
        for (const line of lines) {
          const el = renderBlock('subitem', line.trim(), { color: fg });
          if (el) frag.appendChild(el);
        }
        const spSec = document.createElement('div');
        spSec.className = 'ep-flow-spacer';
        frag.appendChild(spSec);
      }
      const spTake = document.createElement('div');
      spTake.className = 'ep-flow-spacer';
      frag.appendChild(spTake);
    }

    if (hasEndBlock && endBlockText) {
      const endEl = renderBlock('end', endBlockText.replace(/\*\*/g, '').trim());
      if (endEl) frag.appendChild(endEl);
    }
    return frag;
  }

  function getStripHTML() {
    const wrap = document.createElement('div');
    wrap.appendChild(buildPrompterFlowFragment(true));
    return wrap.innerHTML;
  }

  function updateStripPreview() {
    syncStateFromForm();
    const el = document.getElementById('ep-strip-content');
    if (!el) return;
    const html = getStripHTML();
    if (!html.trim()) {
      el.className = 'ep-strip-empty';
      el.textContent = 'Add event name and takes.';
      scheduleHistoryPush();
      scheduleLayoutReflow();
      return;
    }
    el.className = 'ep-strip-content ep-strip-flow';
    el.innerHTML = html;
    scheduleHistoryPush();
    scheduleLayoutReflow();
  }

  function syncStateFromForm() {
    const form = document.getElementById('ep-form');
    if (!form) return;

    state.eventName = (form.querySelector('#ep-event-name')?.value ?? '').toUpperCase().trim();
    state.eventDateTime = (form.querySelector('#ep-event-datetime')?.value ?? '').toUpperCase().trim();
    state.endBlockText = (form.querySelector('#ep-end-block')?.value ?? '').toUpperCase().trim();
    state.hasEndBlock = !!state.endBlockText;

    state.takes = [];
    form.querySelectorAll('.ep-take-card').forEach((card, idx) => {
      const num = parseInt(card.querySelector('.take-num')?.value ?? idx, 10);
      const ts = (card.querySelector('.take-timestamp')?.value ?? '').toUpperCase().trim();
      const sections = [];
      card.querySelectorAll('.ep-section-block').forEach((blk) => {
        const title = (blk.querySelector('.ep-section-input')?.value ?? '').toUpperCase().trim();
        const content = (blk.querySelector('.ep-section-content')?.value ?? '').toUpperCase();
        sections.push({ title, bg: 'blue', content });
      });
      if (sections.length === 0) sections.push({ title: '', bg: 'blue', content: '' });
      state.takes.push({ num, timestamp: ts, sections });
    });
  }

  function createSectionBlock(section, opts) {
    const takeIdx = opts?.takeIdx ?? 0;
    const isLastSection = !!opts?.isLastSection;

    const blk = document.createElement('div');
    blk.className = 'ep-section-block';
    blk.dataset.bg = 'blue';

    const titleInp = document.createElement('textarea');
    titleInp.className = 'ep-section-input';
    titleInp.placeholder = 'SECTION TITLE…';
    titleInp.rows = 1;
    titleInp.wrap = 'soft';
    titleInp.value = (section.title ?? '').toUpperCase();
    titleInp.addEventListener('input', () => {
      forceUpperInput(titleInp);
      autoResizeTextarea(titleInp);
      updateStripPreview();
    });
    bindAutoResize(titleInp);

    const contentArea = document.createElement('textarea');
    contentArea.className = 'ep-section-content';
    contentArea.placeholder = ' ';
    contentArea.rows = 1;
    contentArea.value = (section.content ?? '').toUpperCase();
    contentArea.addEventListener('input', () => {
      forceUpperInput(contentArea);
      autoResizeTextarea(contentArea);
      updateStripPreview();
    });
    bindAutoResize(contentArea);

    const header = document.createElement('div');
    header.className = 'ep-section-header';
    header.appendChild(titleInp);

    if (isLastSection) {
      const addSecBtn = document.createElement('button');
      addSecBtn.type = 'button';
      addSecBtn.className = 'ep-section-add';
      addSecBtn.textContent = '+';
      addSecBtn.title = 'Add section';
      addSecBtn.setAttribute('aria-label', 'Add section');
      addSecBtn.onclick = () => {
        clearTimeout(historyDebounceTimer);
        pushHistory(true);
        syncStateFromForm();
        const tk = state.takes[takeIdx];
        if (!tk) return;
        tk.sections = tk.sections || [];
        tk.sections.push({ title: '', bg: 'blue', content: '' });
        renderForm();
        updateStripPreview();
      };
      header.appendChild(addSecBtn);
    }

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'ep-delete-section';
    delBtn.textContent = '×';
    delBtn.title = 'Remove section';
    delBtn.onclick = () => {
      if (blk.closest('.ep-sections-wrap')?.querySelectorAll('.ep-section-block').length <= 1) return;
      clearTimeout(historyDebounceTimer);
      pushHistory(true);
      blk.remove();
      updateStripPreview();
    };

    header.appendChild(delBtn);
    blk.append(header, contentArea);
    return blk;
  }

  function createTakeCard(take, idx) {
    const card = document.createElement('div');
    card.className = 'ep-take-card';
    card.dataset.takeIdx = String(idx);

    const isLastTake = idx === state.takes.length - 1;

    const head = document.createElement('div');
    head.className = 'ep-take-head';
    const handle = document.createElement('span');
    handle.className = 'ep-drag-handle';
    handle.draggable = true;
    handle.title = 'Drag to reorder';
    handle.textContent = '⋮⋮';
    head.appendChild(handle);

    const labelOpen = document.createElement('span');
    labelOpen.className = 'ep-take-label';
    labelOpen.textContent = '[TAKE ';
    head.appendChild(labelOpen);

    const numInp = document.createElement('input');
    numInp.type = 'number';
    numInp.className = 'take-num';
    numInp.min = '0';
    numInp.value = String(take.num ?? 0);
    numInp.addEventListener('input', updateStripPreview);
    head.appendChild(numInp);

    const labelClose = document.createElement('span');
    labelClose.className = 'ep-take-label';
    labelClose.textContent = ']';
    head.appendChild(labelClose);

    const tsInp = document.createElement('input');
    tsInp.type = 'text';
    tsInp.className = 'take-timestamp';
    tsInp.placeholder = '8:00AM';
    tsInp.value = (take.timestamp ?? '').toUpperCase();
    tsInp.addEventListener('input', (e) => {
      forceUpperInput(e.target);
      updateStripPreview();
    });
    head.appendChild(tsInp);

    const delTakeBtn = document.createElement('button');
    delTakeBtn.type = 'button';
    delTakeBtn.className = 'ep-take-delete';
    delTakeBtn.title = 'Delete take';
    delTakeBtn.textContent = '×';
    delTakeBtn.onclick = () => deleteTake(idx);
    head.appendChild(delTakeBtn);

    const sectionsWrap = document.createElement('div');
    sectionsWrap.className = 'ep-sections-wrap';
    const sections = take.sections || (take.section ? [{ title: take.section, bg: 'blue', content: (take.lines || []).join('\n') }] : [{ title: '', bg: 'blue', content: '' }]);
    sections.forEach((s, si) => {
      sectionsWrap.appendChild(
        createSectionBlock(s, {
          takeIdx: idx,
          isLastSection: si === sections.length - 1,
        }),
      );
    });

    if (isLastTake && !state.hasEndBlock) {
      const actionsWrap = document.createElement('div');
      actionsWrap.className = 'ep-take-actions-wrap';
      const endRow = document.createElement('div');
      endRow.className = 'ep-take-actions-end';
      const addTakeBtn = document.createElement('button');
      addTakeBtn.type = 'button';
      addTakeBtn.className = 'ep-take-action ep-take-action--take';
      addTakeBtn.textContent = 'Take';
      addTakeBtn.title = 'Add a new take';
      addTakeBtn.onclick = () => addTake();
      const addEndBtn = document.createElement('button');
      addEndBtn.type = 'button';
      addEndBtn.className = 'ep-take-action ep-take-action--end';
      addEndBtn.textContent = 'End banner';
      addEndBtn.title = 'Add end-of-event banner';
      addEndBtn.onclick = () => addEndBlock();
      endRow.append(addTakeBtn, addEndBtn);
      actionsWrap.appendChild(endRow);
      sectionsWrap.appendChild(actionsWrap);
    }

    if (isLastTake && state.hasEndBlock) {
      card.classList.add('ep-take-card--concealed');
    }

    card.append(head, sectionsWrap);

    handle.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(idx));
      card.classList.add('ep-dragging');
    });
    card.addEventListener('dragend', () => card.classList.remove('ep-dragging'));
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      card.classList.add('ep-drag-over');
    });
    card.addEventListener('dragleave', () => card.classList.remove('ep-drag-over'));
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      card.classList.remove('ep-drag-over');
      const fromIdx = parseInt(e.dataTransfer.getData('text/plain'), 10);
      if (fromIdx === idx || isNaN(fromIdx)) return;
      clearTimeout(historyDebounceTimer);
      pushHistory(true);
      const arr = [...state.takes];
      const [item] = arr.splice(fromIdx, 1);
      const insertIdx = fromIdx < idx ? idx - 1 : idx;
      arr.splice(insertIdx, 0, item);
      state.takes = arr;
      renderForm();
      updateStripPreview();
    });

    return card;
  }

  function deleteTake(idx) {
    clearTimeout(historyDebounceTimer);
    pushHistory(true);
    state.takes.splice(idx, 1);
    renderForm();
    updateStripPreview();
  }

  /** Which distributed column (0=left page col, 1=right, …) holds the closing banner */
  function getEndBlockColumnIndex() {
    if (!state.hasEndBlock || !String(state.endBlockText || '').trim()) return -1;
    const distCols = distributeByContent(state.takes, state.endBlockText, true);
    for (let i = 0; i < distCols.length; i++) {
      if (distCols[i].endBlock) return i;
    }
    return -1;
  }

  function ensureEndBlockWrap() {
    const wrap = document.createElement('div');
    wrap.id = 'ep-end-wrap';
    wrap.className = 'ep-end-block-editor';
    const head = document.createElement('div');
    head.className = 'ep-end-block-head';
    const lab = document.createElement('span');
    lab.className = 'ep-end-block-label';
    lab.textContent = 'End of event';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'ep-end-close';
    closeBtn.title = 'Remove end banner';
    closeBtn.setAttribute('aria-label', 'Remove end banner');
    closeBtn.textContent = '×';
    closeBtn.onclick = (e) => {
      e.preventDefault();
      removeEndBlock();
    };
    head.append(lab, closeBtn);
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.id = 'ep-end-block';
    inp.placeholder = '** END OF EVENT (DATE) **';
    inp.value = (state.endBlockText ?? '').toUpperCase();
    wrap.append(head, inp);
    return wrap;
  }

  function removeEndBlock() {
    clearTimeout(historyDebounceTimer);
    pushHistory(true);
    state.hasEndBlock = false;
    state.endBlockText = '';
    renderForm();
    updateStripPreview();
  }

  function renderForm() {
    const container = document.getElementById('ep-pages-container');
    const form = document.getElementById('ep-form');
    if (!container) return;

    const oldEnd = document.getElementById('ep-end-wrap');
    if (oldEnd) oldEnd.remove();

    const pages = getEditorColumns();
    let globalIdx = 0;
    container.innerHTML = '';

    const endColIdx = state.hasEndBlock ? getEndBlockColumnIndex() : -1;
    const endPageIdx = endColIdx >= 0 ? Math.floor(endColIdx / 2) : -1;
    const endOnLeft = endColIdx >= 0 ? endColIdx % 2 === 0 : false;

    pages.forEach((page, pageNum) => {
      const header = document.createElement('div');
      header.className = 'ep-event-info';
      if (pageNum === 0) {
        const nameInp = document.createElement('input');
        nameInp.type = 'text';
        nameInp.id = 'ep-event-name';
        nameInp.className = 'ep-event-name';
        nameInp.placeholder = 'Event name';
        nameInp.value = escapeHtml(state.eventName ?? '');
        header.appendChild(nameInp);

        const dtInp = document.createElement('input');
        dtInp.type = 'text';
        dtInp.id = 'ep-event-datetime';
        dtInp.className = 'ep-event-datetime';
        dtInp.placeholder = 'Event date & time';
        dtInp.value = escapeHtml(state.eventDateTime ?? '');
        header.appendChild(dtInp);
      } else {
        const nameDiv = document.createElement('div');
        nameDiv.className = 'ep-event-name';
        nameDiv.textContent = state.eventName ?? '';
        header.appendChild(nameDiv);

        const dtDiv = document.createElement('div');
        dtDiv.className = 'ep-event-datetime';
        dtDiv.textContent = state.eventDateTime ?? '';
        header.appendChild(dtDiv);
      }

      const row = document.createElement('div');
      row.className = 'ep-two-col-editor';
      const c1 = document.createElement('div');
      c1.className = 'ep-col-editor';
      const c2 = document.createElement('div');
      c2.className = 'ep-col-editor';
      page.col1.forEach((t) => { c1.appendChild(createTakeCard(t, globalIdx++)); });
      page.col2.forEach((t) => { c2.appendChild(createTakeCard(t, globalIdx++)); });

      if (state.hasEndBlock && endColIdx >= 0 && pageNum === endPageIdx) {
        const endEl = ensureEndBlockWrap();
        if (endOnLeft) c1.appendChild(endEl);
        else c2.appendChild(endEl);
      }

      row.append(c1, c2);
      const pageWrap = document.createElement('div');
      pageWrap.className = 'ep-paper-page';
      if (pageNum > 0) pageWrap.classList.add('ep-paper-page-gap');
      pageWrap.append(header, row);
      container.appendChild(pageWrap);
    });

    if (state.hasEndBlock && endColIdx < 0) {
      const endEl = ensureEndBlockWrap();
      const lastRow = container.querySelector('.ep-paper-page:last-of-type .ep-two-col-editor');
      if (lastRow) {
        const editors = lastRow.querySelectorAll('.ep-col-editor');
        const target = editors[editors.length - 1];
        if (target) target.appendChild(endEl);
      } else if (form) {
        form.appendChild(endEl);
      }
    }

    const wrapEl = document.getElementById('ep-end-wrap');
    if (wrapEl) {
      wrapEl.style.display = state.hasEndBlock ? 'block' : 'none';
    }
    lastLayoutSignature = computeLayoutSignature();
  }

  function addTake() {
    clearTimeout(historyDebounceTimer);
    pushHistory(true);
    const next = state.takes.length ? Math.max(...state.takes.map((t) => t.num)) + 1 : 0;
    state.takes.push({ num: next, timestamp: '', sections: [{ title: '', bg: 'blue', content: '' }] });
    renderForm();
    updateStripPreview();
  }

  function addEndBlock() {
    clearTimeout(historyDebounceTimer);
    pushHistory(true);
    state.hasEndBlock = true;
    if (!state.endBlockText && state.eventName) {
      const d = state.eventDateTime?.replace(/\D/g, '').slice(-6) || '';
      state.endBlockText = `** END OF ${state.eventName.replace(/^.*–\s*/, '').toUpperCase().replace(/\s+/g, ' ')} (${d || 'DATE'}) **`;
    }
    renderForm();
    updateStripPreview();
    requestAnimationFrame(() => {
      document.getElementById('ep-end-block')?.focus();
    });
  }

  function syncDocThemeButton() {
    const btn = document.getElementById('ep-doc-theme');
    if (!btn) return;
    btn.textContent = docDarkMode ? 'Light paper' : 'Dark paper';
    btn.setAttribute('aria-pressed', docDarkMode ? 'true' : 'false');
    btn.setAttribute(
      'aria-label',
      docDarkMode ? 'Letter paper is dark; switch to light' : 'Letter paper is light; switch to dark',
    );
    btn.classList.toggle('is-pressed', docDarkMode);
  }

  function toggleDocTheme() {
    docDarkMode = !docDarkMode;
    const form = document.getElementById('ep-form');
    if (form) {
      form.classList.toggle('ep-doc-dark-mode', docDarkMode);
      form.classList.toggle('ep-doc-light', !docDarkMode);
    }
    syncDocThemeButton();
  }

  function buildPageDOM(col1Takes, col2Takes, endBlock, pageNum) {
    const wrap = document.createElement('div');
    wrap.className = 'ep-export-page';
    const pxW = Math.round(CONFIG.PAPER_WIDTH_IN * 96);
    const pxH = Math.round(CONFIG.PAPER_HEIGHT_IN * 96);
    const pad = Math.round(CONFIG.PAPER_MARGIN_IN * 96);
    wrap.style.cssText = `width:${pxW}px;height:${pxH}px;padding:${pad}px;background:#fff;font-family:Tahoma,Geneva,sans-serif;font-size:${CONFIG.EDITOR_FONT_PT}pt;font-weight:bold;line-height:${CONFIG.EDITOR_LINE_HEIGHT};box-sizing:border-box;`;
    if (pageNum > 1) wrap.style.marginTop = '16px';

    const title = document.getElementById('ep-event-name')?.value || '';
    const dt = document.getElementById('ep-event-datetime')?.value || '';
    wrap.innerHTML = `
      <div style="font-size:${CONFIG.EVENT_TITLE_PT}pt;font-weight:bold;color:#0070C0;margin-bottom:8px;line-height:1.0">${escapeHtml(title)}</div>
      <div style="font-size:${CONFIG.EDITOR_FONT_PT}pt;font-weight:bold;color:#0070C0;margin-bottom:16px;line-height:1.0">${escapeHtml(dt)}</div>
      <div style="display:flex;gap:0">
        <div style="flex:1;padding-right:12px" id="ep-exp-c1"></div>
        <div style="flex:1;padding-left:12px" id="ep-exp-c2"></div>
      </div>
    `;

    const c1 = wrap.querySelector('#ep-exp-c1');
    const c2 = wrap.querySelector('#ep-exp-c2');
    c1.appendChild(buildColumnHTML(col1Takes, null, false, false));
    c2.appendChild(buildColumnHTML(col2Takes, endBlock, !!endBlock, false));
    return wrap;
  }

  function exportPng() {
    syncStateFromForm();
    const cols = distributeByContent(state.takes, state.endBlockText, state.hasEndBlock);
    const pages = [];
    for (let i = 0; i < cols.length; i += 2) {
      const c1 = cols[i];
      const c2 = cols[i + 1];
      pages.push({
        col1: c1?.takes || [],
        col2: c2?.takes || [],
        endBlock: (c2?.endBlock || c1?.endBlock) || null,
      });
    }
    if (pages.length === 0 && state.hasEndBlock && state.endBlockText) {
      pages.push({ col1: [], col2: [], endBlock: state.endBlockText });
    }

    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
    script.onload = () => {
      const baseName = (state.eventName || 'prompter').replace(/\s+/g, '-');
      pages.forEach((p, i) => {
        const pageEl = buildPageDOM(p.col1, p.col2, p.endBlock, i + 1);
        pageEl.style.position = 'absolute';
        pageEl.style.left = '-9999px';
        document.body.appendChild(pageEl);

        html2canvas(pageEl, {
          scale: 2,
          useCORS: true,
          backgroundColor: '#ffffff',
          logging: false,
        }).then((canvas) => {
          document.body.removeChild(pageEl);
          const a = document.createElement('a');
          a.href = canvas.toDataURL('image/png');
          a.download = `${baseName}-page-${i + 1}.png`;
          a.click();
        }).catch((e) => {
          document.body.removeChild(pageEl);
          console.error('PNG export failed:', e);
          alert('Export failed.');
        });
      });
    };
    document.head.appendChild(script);
  }

  function openPrompterWindow() {
    syncStateFromForm();
    const key = `${STORAGE_KEY}-display-${Date.now()}`;
    localStorage.setItem(key, getStripHTML());
    const title = state.eventName || 'Event Prompter';
    const url = `event-prompter-display.html?key=${encodeURIComponent(key)}&title=${encodeURIComponent(title)}`;
    window.open(url, DISPLAY_WINDOW, `width=900,height=700,left=${Math.max(0,(screen.availWidth-900)/2)},top=${Math.max(0,(screen.availHeight-700)/2)}`);
  }

  function savePreset() {
    syncStateFromForm();
    const name = prompt('Preset name:', state.eventName || 'Event Prompter');
    if (!name) return;
    const key = `${STORAGE_KEY}-preset-${name.replace(/\s+/g, '_')}`;
    localStorage.setItem(key, JSON.stringify({ name, data: JSON.parse(JSON.stringify(state)), savedAt: Date.now() }));
    refreshPresets();
  }

  function loadPreset(key) {
    const raw = localStorage.getItem(key);
    if (!raw) return;
    try {
      const { data } = JSON.parse(raw);
      state = JSON.parse(JSON.stringify(data));
      state.takes = (state.takes || []).map((t) => {
        if (t.sections && t.sections.length) {
          return {
            ...t,
            sections: t.sections.map((s) => ({ ...s, bg: 'blue' })),
          };
        }
        const title = t.section || '';
        const content = (t.lines || []).concat((t.subitems || []).map((s) => (s.text || '').trim())).filter(Boolean).join('\n');
        return { num: t.num, timestamp: t.timestamp || '', sections: [{ title, bg: 'blue', content }] };
      });
      normalizeStateUpper();
      const form = document.getElementById('ep-form');
      if (form) {
        form.querySelector('#ep-event-name').value = state.eventName ?? '';
        form.querySelector('#ep-event-datetime').value = state.eventDateTime ?? '';
      }
      renderForm();
      if (form) {
        const endInp = form.querySelector('#ep-end-block');
        if (endInp) endInp.value = state.endBlockText ?? '';
      }
      updateStripPreview();
      clearTimeout(historyDebounceTimer);
      initHistory();
    } catch (e) {
      console.error('Load preset failed:', e);
    }
  }

  function refreshPresets() {
    const sel = document.getElementById('ep-preset-select');
    if (!sel) return;
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(STORAGE_KEY + '-preset-'));
    sel.innerHTML = '<option value="">Load…</option>';
    keys.forEach((k) => {
      try {
        const { name } = JSON.parse(localStorage.getItem(k));
        const o = document.createElement('option');
        o.value = k;
        o.textContent = name || k;
        sel.appendChild(o);
      } catch (_) {}
    });
  }

  function loadSample() {
    state = JSON.parse(JSON.stringify(SAMPLE));
    normalizeStateUpper();
    const form = document.getElementById('ep-form');
    if (form) {
      form.querySelector('#ep-event-name').value = state.eventName;
      form.querySelector('#ep-event-datetime').value = state.eventDateTime;
    }
    renderForm();
    if (form) {
      const endInp = form.querySelector('#ep-end-block');
      if (endInp) endInp.value = state.endBlockText;
    }
    updateStripPreview();
    clearTimeout(historyDebounceTimer);
    initHistory();
    refreshPresets();
  }

  function buildHTML() {
    return `
      <div class="workspace" id="ep-workspace">
        <div class="workspace-editor">
          <div class="lyrics-toolbar ep-event-toolbar">
            <div class="tabs-toolbar-row ep-toolbar-row">
              <div class="ep-toolbar-cluster">
                <label class="ep-toolbar-label" for="ep-preset-select">Preset</label>
                <select id="ep-preset-select" class="ep-toolbar-select"><option value="">Load…</option></select>
              </div>
              <div class="ep-toolbar-cluster ep-toolbar-cluster-mid">
                <button type="button" class="btn-toolbar" id="ep-load-sample" title="Load sample event"><i class="fa-solid fa-flask" aria-hidden="true"></i><span>Sample</span></button>
                <button type="button" class="btn-toolbar btn-toolbar-toggle" id="ep-doc-theme" title="Switch letter paper between light and dark" aria-pressed="false" aria-label="Letter paper: light theme">Dark paper</button>
                <label class="ep-toolbar-label" for="ep-zoom">Zoom</label>
                <select id="ep-zoom" class="ep-toolbar-select" title="Document zoom">
                  <option value="70">70%</option>
                  <option value="85">85%</option>
                  <option value="100" selected>100%</option>
                </select>
              </div>
              <div class="toolbar-actions">
                <button type="button" class="btn-toolbar" id="ep-save-preset" title="Save preset"><i class="fa-solid fa-bookmark" aria-hidden="true"></i><span>Save</span></button>
                <button type="button" class="btn-toolbar" id="ep-export-png" title="Export PNG"><i class="fa-solid fa-file-image" aria-hidden="true"></i><span>PNG</span></button>
                <button type="button" class="btn-toolbar btn-toolbar-primary btn-toolbar-cta" id="ep-send-prompter" title="Open prompter window">Send to prompter</button>
              </div>
            </div>
          </div>
          <div class="ep-editor-scroll">
            <form id="ep-form" class="ep-form-doc ep-doc-light">
              <div id="ep-pages-container"></div>
            </form>
          </div>
        </div>
        <aside class="workspace-preview" aria-label="Preview">
          <div class="ep-preview-header">Prompter preview</div>
          <p class="ep-preview-sub">Single column, large type — matches the prompter window.</p>
          <div class="ep-preview-frame">
            <div class="ep-strip-body">
              <div id="ep-strip-content" class="ep-strip-empty">Add event name and takes.</div>
            </div>
          </div>
        </aside>
      </div>
    `;
  }

  function init() {
    const panel = getPanel();
    if (!panel) return;

    panel.innerHTML = buildHTML();

    // Event-name/date/end-block live inside regenerated paper pages, so use delegation.
    document.getElementById('ep-form')?.addEventListener('input', (e) => {
      const t = e.target;
      if (!t || !t.id) return;
      if (t.id === 'ep-event-name' || t.id === 'ep-event-datetime' || t.id === 'ep-end-block') {
        forceUpperInput(t);
        updateStripPreview();
      }
    });
    document.getElementById('ep-workspace')?.addEventListener('keydown', (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
        e.preventDefault();
        redo();
      }
    });
    document.getElementById('ep-export-png')?.addEventListener('click', exportPng);
    document.getElementById('ep-send-prompter')?.addEventListener('click', openPrompterWindow);
    document.getElementById('ep-save-preset')?.addEventListener('click', savePreset);
    document.getElementById('ep-load-sample')?.addEventListener('click', loadSample);
    document.getElementById('ep-doc-theme')?.addEventListener('click', toggleDocTheme);
    document.getElementById('ep-zoom')?.addEventListener('change', (e) => {
      const form = document.getElementById('ep-form');
      if (form) {
        const pct = parseInt(e.target.value, 10) || 100;
        form.style.transform = pct === 100 ? 'none' : `scale(${pct / 100})`;
        form.style.transformOrigin = 'top center';
      }
    });
    document.getElementById('ep-preset-select')?.addEventListener('change', (e) => {
      const v = e.target.value;
      if (v) loadPreset(v);
      e.target.value = '';
    });

    renderForm();
    syncDocThemeButton();
    updateStripPreview();
    clearTimeout(historyDebounceTimer);
    initHistory();
    refreshPresets();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
