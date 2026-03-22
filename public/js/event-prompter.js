/**
 * Event Prompter — Letter 8.5×11, fill col1→col2→page2, Tahoma 12 bold, 1.0 line-height
 */

(function () {
  const STORAGE_KEY = 'eclyrics-event-prompter';
  const DISPLAY_WINDOW = 'eclyricsEventPrompter';
  // 8.5×11 Letter: ~10" usable, 12pt @ 1.0 line-height ≈ 60 lines; conservative for headers/spacing
  const LINES_PER_COLUMN = 28;

  const SECTION_BGS = { green: '#D9F2D0', blue: '#CAEDFB' };

  const EMPTY_STATE = {
    eventName: '',
    eventDateTime: '',
    endBlockText: '',
    takes: [{ num: 0, timestamp: '', sections: [{ title: '', bg: 'green', content: '' }] }],
    hasEndBlock: false,
  };

  const SAMPLE = {
    eventName: "MCGI – INTERNATIONAL SENIORS' DAY",
    eventDateTime: 'MAR 1, 2026, SUN / 8:00 AM',
    endBlockText: "** END OF INTERNATIONAL SENIORS' DAY (03-01-26) **",
    takes: [
      { num: 0, timestamp: '8:00AM', sections: [{ title: 'REGISTRATION & OPENING', bg: 'green', content: 'RESERVED\nHALLELUJAH, AMEN' }] },
      { num: 1, timestamp: '9:00AM', sections: [{ title: 'CONGREGATIONAL SINGING', bg: 'blue', content: "HIMNO #30 – MAGSAYA TAYO NGAYON" }] },
      { num: 2, timestamp: '9:20AM', sections: [{ title: 'OPENING PRAYER', bg: 'green', content: '' }] },
      { num: 3, timestamp: '9:30AM', sections: [{ title: "KUYA'S MESSAGE", bg: 'blue', content: '' }] },
      { num: 4, timestamp: '10:30AM', sections: [{ title: 'END OF PROGRAM', bg: 'green', content: '' }] },
    ],
    hasEndBlock: true,
  };

  let state = JSON.parse(JSON.stringify(EMPTY_STATE));
  let docDarkMode = false;

  function getPanel() {
    return document.getElementById('panel-event');
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s ?? '';
    return d.innerHTML;
  }

  /** Estimate lines for a take: header(1) + sum(section + contentLines) per section */
  function takeLines(t) {
    if (t.sections && t.sections.length) {
      let n = 1; // header
      for (const s of t.sections) {
        n += 1; // section title
        const lines = (s.content || '').split('\n').filter(Boolean).length;
        n += lines;
      }
      return n;
    }
    // legacy: section + lines
    return 2 + (t.lines?.length || 0);
  }

  /** Distribute by content: fill col1 first, then col2, then next page */
  function distributeByContent(takes, endBlockText, hasEndBlock) {
    const endLines = hasEndBlock && endBlockText ? 2 : 0;
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
      frag.appendChild(renderBlock('take', `[TAKE ${t.num}] ${t.timestamp || ''}`.trim() || `[TAKE ${t.num}]`));
      const sections = t.sections || (t.section ? [{ title: t.section, bg: 'green', content: (t.lines || []).join('\n') }] : []);
      for (const s of sections) {
        if (s.title && String(s.title).trim()) {
          const bg = SECTION_BGS[s.bg === 'blue' ? 'blue' : 'green'] || SECTION_BGS.green;
          const el = renderBlock('section', s.title, { bg, color: '#0070C0' });
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
      frag.appendChild(renderBlock('end', endBlockText.replace(/\*\*/g, '').trim()));
    }
    return frag;
  }

  /** Get editor columns by content fill */
  function getEditorColumns() {
    const cols = distributeByContent(state.takes, null, false);
    const result = [];
    for (let i = 0; i < cols.length; i += 2) {
      const c1 = cols[i];
      const c2 = cols[i + 1];
      result.push({
        col1: c1?.takes || [],
        col2: (c2?.takes || []),
      });
    }
    if (result.length === 0) result.push({ col1: [], col2: [] });
    return result;
  }

  function getStripHTML() {
    const { eventName, eventDateTime, takes, endBlockText, hasEndBlock } = state;
    const cols = distributeByContent(takes, endBlockText, hasEndBlock);
    const wrap = document.createElement('div');
    wrap.className = 'ep-strip-content';

    const title = document.createElement('div');
    title.className = 'ep-block-title';
    title.innerHTML = `${escapeHtml(eventName)}<br>${escapeHtml(eventDateTime)}`;
    wrap.appendChild(title);

    for (const c of cols) {
      const f = document.createDocumentFragment();
      f.appendChild(buildColumnHTML(c.takes, c.endBlock || '', !!c.endBlock, true));
      wrap.appendChild(f);
    }
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
      return;
    }
    el.className = 'ep-strip-content';
    el.innerHTML = html;
  }

  function syncStateFromForm() {
    const form = document.getElementById('ep-form');
    if (!form) return;

    state.eventName = form.querySelector('#ep-event-name')?.value?.trim() ?? '';
    state.eventDateTime = form.querySelector('#ep-event-datetime')?.value?.trim() ?? '';
    state.endBlockText = form.querySelector('#ep-end-block')?.value?.trim() ?? '';
    state.hasEndBlock = !!state.endBlockText;

    state.takes = [];
    form.querySelectorAll('.ep-take-card').forEach((card, idx) => {
      const num = parseInt(card.querySelector('.take-num')?.value ?? idx, 10);
      const ts = card.querySelector('.take-timestamp')?.value?.trim() ?? '';
      const sections = [];
      card.querySelectorAll('.ep-section-block').forEach((blk) => {
        const title = blk.querySelector('.ep-section-input')?.value?.trim() ?? '';
        const bg = blk.querySelector('.ep-section-bg')?.value === 'blue' ? 'blue' : 'green';
        const content = blk.querySelector('.ep-section-content')?.value ?? '';
        sections.push({ title, bg, content });
      });
      if (sections.length === 0) sections.push({ title: '', bg: 'green', content: '' });
      state.takes.push({ num, timestamp: ts, sections });
    });
  }

  function createSectionBlock(section) {
    const blk = document.createElement('div');
    blk.className = 'ep-section-block';
    blk.dataset.bg = section.bg === 'blue' ? 'blue' : 'green';

    const titleInp = document.createElement('input');
    titleInp.type = 'text';
    titleInp.className = 'ep-section-input';
    titleInp.placeholder = 'Section…';
    titleInp.value = section.title ?? '';
    titleInp.addEventListener('input', updateStripPreview);

    const bgSel = document.createElement('select');
    bgSel.className = 'ep-section-bg';
    bgSel.title = 'Section color';
    bgSel.innerHTML = '<option value="green">Green</option><option value="blue">Blue</option>';
    bgSel.value = section.bg === 'blue' ? 'blue' : 'green';
    bgSel.addEventListener('change', () => { blk.dataset.bg = bgSel.value; updateStripPreview(); });

    const contentArea = document.createElement('textarea');
    contentArea.className = 'ep-section-content';
    contentArea.placeholder = 'Enter text, press Enter for new line…';
    contentArea.rows = 2;
    contentArea.value = section.content ?? '';
    contentArea.addEventListener('input', updateStripPreview);

    const header = document.createElement('div');
    header.className = 'ep-section-header';
    header.append(titleInp, bgSel);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'ep-delete-section';
    delBtn.textContent = '×';
    delBtn.title = 'Remove section';
    delBtn.onclick = () => {
      if (blk.closest('.ep-sections-wrap')?.querySelectorAll('.ep-section-block').length <= 1) return;
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

    const head = document.createElement('div');
    head.className = 'ep-take-head';
    const handle = document.createElement('span');
    handle.className = 'ep-drag-handle';
    handle.draggable = true;
    handle.title = 'Drag to reorder';
    handle.textContent = '⋮⋮';
    head.innerHTML = `
      <input type="number" class="take-num" value="${take.num}" min="0" />
      <input type="text" class="take-timestamp" placeholder="8:00AM" value="${escapeHtml(take.timestamp)}" />
      <button type="button" class="ep-take-delete" title="Delete take">×</button>
    `;
    head.insertBefore(handle, head.firstChild);
    head.querySelector('.take-num').addEventListener('input', updateStripPreview);
    head.querySelector('.take-timestamp').addEventListener('input', updateStripPreview);
    head.querySelector('.ep-take-delete').onclick = () => deleteTake(idx);

    const sectionsWrap = document.createElement('div');
    sectionsWrap.className = 'ep-sections-wrap';
    const sections = take.sections || (take.section ? [{ title: take.section, bg: 'green', content: (take.lines || []).join('\n') }] : [{ title: '', bg: 'green', content: '' }]);
    sections.forEach((s) => sectionsWrap.appendChild(createSectionBlock(s)));
    const addSecBtn = document.createElement('button');
    addSecBtn.type = 'button';
    addSecBtn.className = 'ep-add-section';
    addSecBtn.textContent = '+ section';
    addSecBtn.onclick = () => {
      sectionsWrap.insertBefore(createSectionBlock({ title: '', bg: 'green', content: '' }), addSecBtn);
      updateStripPreview();
    };
    sectionsWrap.appendChild(addSecBtn);

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
    state.takes.splice(idx, 1);
    renderForm();
    updateStripPreview();
  }

  function renderForm() {
    const container = document.getElementById('ep-pages-container');
    const endWrap = document.getElementById('ep-end-wrap');
    if (!container) return;

    const pages = getEditorColumns();
    let globalIdx = 0;
    container.innerHTML = '';
    pages.forEach((page, pageNum) => {
      const row = document.createElement('div');
      row.className = 'ep-two-col-editor';
      if (pageNum > 0) row.style.marginTop = '1rem';
      const c1 = document.createElement('div');
      c1.className = 'ep-col-editor';
      const c2 = document.createElement('div');
      c2.className = 'ep-col-editor';
      page.col1.forEach((t) => { c1.appendChild(createTakeCard(t, globalIdx++)); });
      page.col2.forEach((t) => { c2.appendChild(createTakeCard(t, globalIdx++)); });
      row.append(c1, c2);
      container.appendChild(row);
    });

    if (endWrap) {
      endWrap.style.display = state.hasEndBlock ? 'block' : 'none';
      const inp = endWrap.querySelector('#ep-end-block');
      if (inp) inp.value = state.endBlockText ?? '';
    }
  }

  function addTake() {
    const next = state.takes.length ? Math.max(...state.takes.map((t) => t.num)) + 1 : 0;
    state.takes.push({ num: next, timestamp: '', sections: [{ title: '', bg: 'green', content: '' }] });
    renderForm();
    updateStripPreview();
  }

  function addEndBlock() {
    state.hasEndBlock = true;
    if (!state.endBlockText && state.eventName) {
      const d = state.eventDateTime?.replace(/\D/g, '').slice(-6) || '';
      state.endBlockText = `** END OF ${state.eventName.replace(/^.*–\s*/, '').toUpperCase().replace(/\s+/g, ' ')} (${d || 'DATE'}) **`;
    }
    renderForm();
    updateStripPreview();
  }

  function toggleDocTheme() {
    docDarkMode = !docDarkMode;
    const form = document.getElementById('ep-form');
    if (form) {
      form.classList.toggle('ep-doc-dark-mode', docDarkMode);
      form.classList.toggle('ep-doc-light', !docDarkMode);
    }
    const btn = document.getElementById('ep-doc-theme');
    if (btn) btn.textContent = docDarkMode ? 'Light' : 'Dark';
  }

  function buildPageDOM(col1Takes, col2Takes, endBlock, pageNum) {
    const wrap = document.createElement('div');
    wrap.className = 'ep-export-page';
    wrap.style.cssText = 'width:816px;height:1056px;padding:48px;background:#fff;font-family:Tahoma,Geneva,sans-serif;font-size:12pt;font-weight:bold;line-height:1.0;box-sizing:border-box;';
    if (pageNum > 1) wrap.style.marginTop = '16px';

    const title = document.getElementById('ep-event-name')?.value || '';
    const dt = document.getElementById('ep-event-datetime')?.value || '';
    wrap.innerHTML = `
      <div style="font-size:18pt;font-weight:bold;color:#0070C0;margin-bottom:8px;line-height:1.0">${escapeHtml(title)}</div>
      <div style="font-size:12pt;font-weight:bold;color:#0070C0;margin-bottom:16px;line-height:1.0">${escapeHtml(dt)}</div>
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
        if (t.sections && t.sections.length) return t;
        const title = t.section || '';
        const content = (t.lines || []).concat((t.subitems || []).map((s) => (s.text || '').trim())).filter(Boolean).join('\n');
        return { num: t.num, timestamp: t.timestamp || '', sections: [{ title, bg: 'green', content }] };
      });
      const form = document.getElementById('ep-form');
      if (form) {
        form.querySelector('#ep-event-name').value = state.eventName ?? '';
        form.querySelector('#ep-event-datetime').value = state.eventDateTime ?? '';
        form.querySelector('#ep-end-block').value = state.endBlockText ?? '';
      }
      renderForm();
      updateStripPreview();
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
    const form = document.getElementById('ep-form');
    if (form) {
      form.querySelector('#ep-event-name').value = state.eventName;
      form.querySelector('#ep-event-datetime').value = state.eventDateTime;
      form.querySelector('#ep-end-block').value = state.endBlockText;
    }
    renderForm();
    updateStripPreview();
    refreshPresets();
  }

  function buildHTML() {
    return `
      <div class="workspace" id="ep-workspace">
        <div class="workspace-editor">
          <div class="ep-toolbar">
            <select id="ep-preset-select" class="ep-toolbar-select"><option value="">Load…</option></select>
            <button type="button" id="ep-load-sample">Sample</button>
            <button type="button" id="ep-doc-theme">Dark</button>
            <select id="ep-zoom" class="ep-toolbar-select" title="Document zoom">
              <option value="70">70%</option>
              <option value="85">85%</option>
              <option value="100" selected>100%</option>
            </select>
            <div class="ep-toolbar-btns">
              <button type="button" id="ep-save-preset" title="Save preset">Save</button>
              <button type="button" id="ep-export-png" title="Export PNG">PNG</button>
              <button type="button" class="ep-primary" id="ep-send-prompter" title="Open prompter window">Send</button>
            </div>
          </div>
          <div class="ep-editor-scroll">
            <form id="ep-form" class="ep-form-doc ep-doc-light">
              <div class="ep-event-info">
                <input type="text" id="ep-event-name" class="ep-event-name" placeholder="Event name" value="${escapeHtml(state.eventName)}" />
                <input type="text" id="ep-event-datetime" class="ep-event-datetime" placeholder="Event Date (e.g. MAR 1, 2026, SUN / 8:00 AM)" value="${escapeHtml(state.eventDateTime)}" />
              </div>
              <div id="ep-pages-container"></div>
              <button type="button" class="ep-add-take" id="ep-add-take">+ take</button>
              <button type="button" class="ep-add-end-block" id="ep-add-end-block">+ end block</button>
              <div id="ep-end-wrap" class="ep-end-block-editor" style="display:${state.hasEndBlock ? 'block' : 'none'}">
                <input type="text" id="ep-end-block" placeholder="** END OF EVENT (DATE) **" value="${escapeHtml(state.endBlockText)}" />
              </div>
            </form>
          </div>
        </div>
        <aside class="workspace-preview" aria-label="Preview">
          <div class="ep-preview-header">Live preview</div>
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

    document.getElementById('ep-event-name')?.addEventListener('input', updateStripPreview);
    document.getElementById('ep-event-datetime')?.addEventListener('input', updateStripPreview);
    document.getElementById('ep-end-block')?.addEventListener('input', updateStripPreview);
    document.getElementById('ep-add-take')?.addEventListener('click', addTake);
    document.getElementById('ep-add-end-block')?.addEventListener('click', addEndBlock);
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
    updateStripPreview();
    refreshPresets();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
