const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

test('image lyrics uses a separate popup page and message namespace from text prompter', () => {
    const editor = read('public/js/features/image-lyrics/index.js');
    const imagePrompter = read('public/js/features/image-prompter/prompter.js');
    const imageHtml = read('public/image-prompter.html');

    assert.match(editor, /image-prompter\.html/);
    assert.match(editor, /eclyricsImagePrompter/);
    assert.match(editor, /prefix='eclyrics-image-prompter-'/);
    assert.match(imagePrompter, /eclyrics-image-prompter-(?:init|ready|control|state)/);
    assert.doesNotMatch(editor, /eclyrics-prompter-control/);
    assert.doesNotMatch(imagePrompter, /eclyrics-prompter-(?:init|ready|control|state)/);
    assert.match(imageHtml, /js\/features\/image-prompter\/prompter\.js/);
    assert.doesNotMatch(imageHtml, /js\/features\/prompter\/prompter\.js/);
});

test('image blocks accept image files and validate picker and dropped files', () => {
    const editor = read('public/js/features/image-lyrics/index.js');
    const html = read('public/index.html');
    const workspaceCss = read('public/assets/css/image-lyrics.css');
    const dropzone = workspaceCss.match(/\.image-lyrics-dropzone\s*\{([^}]+)\}/)?.[1];
    const thumbnail = workspaceCss.match(/\.image-lyrics-block__image\s*\{([^}]+)\}/)?.[1];

    assert.match(html, /type="file" accept="image\/\*"/);
    assert.match(editor, /input\.type='file';input\.accept='image\/\*'/);
    assert.match(editor, /file\.type\?\.startsWith\('image\/'\)/);
    assert.match(editor, /input\.onchange=e=>assign\(i,e\.target\.files\?\.\[0\]\)/);
    assert.match(editor, /label\.addEventListener\('drop',e=>assign\(i,e\.dataTransfer\?\.files\?\.\[0\]\)\)/);
    assert.match(editor, /\['dragenter','dragover'\]/);
    assert.match(editor, /\['dragleave','drop'\]/);
    assert.ok(dropzone, 'expected image dropzone styles');
    assert.match(dropzone, /aspect-ratio:\s*16\s*\/\s*9/);
    assert.match(dropzone, /height:\s*auto/);
    assert.doesNotMatch(dropzone, /height:\s*260px/);
    assert.ok(thumbnail, 'expected populated image thumbnail styles');
    assert.match(thumbnail, /object-fit:\s*cover/);
    assert.match(thumbnail, /object-position:\s*top\s+center/);
    assert.match(editor, /title\.textContent=b\.file\?\.name\|\|\('Block '\+\(i\+1\)\)/);
    assert.match(editor, /input\.disabled=!!b\.file/);
    const assign = editor.match(/function assign\(i,file\)\{([\s\S]*?)\nfunction clearBlock/ )?.[1];
    assert.ok(assign, 'expected image assignment function');
    assert.match(assign, /if\(!file\)return/);
    assert.match(assign, /if\(!file\.type\?\.startsWith\('image\/'\)\)\{status\('Choose an image file to fill this block\.',true\);return\}/);
    assert.doesNotMatch(assign, /status\([^)]*added to block/);
    assert.match(assign, /b\.file=file;b\.url=URL\.createObjectURL\(file\);selected=i/);
    assert.match(assign, /render\(\);sync\(\)/);
    assert.match(editor, /function clearBlock\(i\)\{const b=tab\(\)\?\.blocks\[i\];if\(!b\?\.file\)return;revoke\(b\);b\.file=null;b\.url='';/);
    assert.match(editor, /function removeBlock\(i\)\{const t=tab\(\);if\(t\.blocks\.length<=1\)return;revoke\(t\.blocks\[i\]\);t\.blocks\.splice\(i,1\);if\(i<selected\)selected--;else if\(selected>=t\.blocks\.length\)selected=t\.blocks\.length-1;/);
    assert.match(editor, /x\.onclick=e=>\{e\.stopPropagation\(\);if\(b\.file\)clearBlock\(i\);else removeBlock\(i\)\}/);
    assert.match(editor, /preview\.onerror=\(\)=>\{if\(preview\.dataset\.previewUrl!==sourceUrl\|\|block\(\)\?\.url!==sourceUrl\)return;preview\.dataset\.previewFailedUrl=sourceUrl;preview\.hidden=true;empty\.hidden=false;/);
});

test('image lineups save and load the versioned JSON format with embedded image data', () => {
    const editor = read('public/js/features/image-lyrics/index.js');

    assert.match(editor, /function fileToBase64\(file\)/);
    assert.match(editor, /async function saveLineup\(\)/);
    assert.match(editor, /const payload=\{format:'eclyrics-image-lineup',version:1,tabs:savedTabs\}/);
    assert.match(editor, /name:b\.file\.name,type:b\.file\.type,data:await fileToBase64\(b\.file\)/);
    assert.match(editor, /_image_lineup\.json/);
    assert.match(editor, /async function loadLineup\(file\)/);
    assert.match(editor, /payload\?\.format!=='eclyrics-image-lineup'\|\|payload\.version!==1/);
    assert.match(editor, /payload\.tabs\.length>10/);
    assert.match(editor, /savedBlock\.type\.startsWith\('image\/'\)/);
    assert.match(editor, /const raw=atob\(savedBlock\.data\)/);
    assert.match(editor, /new File\(\[bytes\]/);
    assert.match(editor, /while\(blocks\.length<Math\.max\(2,savedTab\.blocks\.length\+1\)\)blocks\.push\(\{file:null,url:''\}\)/);
    assert.match(editor, /if\(file\)loadLineup\(file\)/);
});

test('image workspace exposes only controls and shortcuts relevant to image prompting', () => {
    const html = read('public/index.html');
    const editor = read('public/js/features/image-lyrics/index.js');
    const imagePrompter = read('public/js/features/image-prompter/prompter.js');
    const imagePanelMatch = html.match(/<section id="panel-image"[\s\S]*?(?=<section id="panel-video")/);
    assert.ok(imagePanelMatch, 'expected image panel markup');
    const imagePanel = imagePanelMatch[0];
    assert.equal((imagePanel.match(/data-image-block="\d+"/g) || []).length, 2, 'initial image panel should contain exactly two blocks');
    assert.match(imagePanel, /<span class="image-lyrics-toolbar-label"><strong id="image-lyrics-selected-title">Block 1<\/strong><\/span>/);
    assert.doesNotMatch(imagePanel.match(/<div class="image-lyrics-toolbar-meta">([\s\S]*?)<\/div>/)?.[1] || '', /Editing\s*:/i);
    assert.equal((editor.match(/blocks:Array\.from\(\{length:2\},\(\)=>\(\{file:null,url:''\}\)\)/g) || []).length, 2, 'initial and added tabs should each start with two blocks');

    for (const id of [
        'image-lyrics-send', 'image-lyrics-play', 'image-lyrics-prev', 'image-lyrics-next',
        'image-lyrics-scroll-up', 'image-lyrics-scroll-down', 'image-lyrics-scroll-top', 'image-lyrics-speed',
    ]) {
        assert.ok(imagePanel.includes(`id="${id}"`), `expected image control ${id}`);
    }
    assert.doesNotMatch(imagePanel, /fontSize|lineWidth/i);
    assert.doesNotMatch(editor, /fontSize|lineWidth|theme/i);
    assert.doesNotMatch(imagePrompter, /fontSize|lineWidth|theme/i);
    assert.match(editor, /event\.code === 'Backquote'/);
    assert.match(editor, /event\.code === 'Space'/);
    assert.match(editor, /event\.code === 'ArrowLeft'/);
    assert.match(editor, /event\.code === 'ArrowRight'/);
    assert.match(editor, /event\.code === 'ArrowUp' \|\| event\.code === 'ArrowDown'/);
    assert.match(editor, /event\.code === 'KeyT'/);
    assert.match(editor, /event\.code === 'Digit0'/);
    assert.match(editor, /\^Digit\[1-9\]\$/);
    assert.match(editor, /event\.code === 'NumpadAdd' \|\| event\.code === 'NumpadSubtract'/);
    assert.match(editor, /event\.target\.closest\('button, a, input, textarea, select, \[role="tab"\], \[contenteditable="true"\]'\)/);
    assert.doesNotMatch(editor.match(/const isInteractive = event\.target\.closest\(([^;]+)\)/)?.[1] || '', /\.image-lyrics-block/,
        'an Image block article should not swallow the double-arrow navigation shortcut');
    assert.match(editor, /event\.defaultPrevented \|\| event\.ctrlKey/);
    assert.match(imagePrompter, /case 'NumpadAdd'/);
    assert.match(imagePrompter, /case 'NumpadSubtract'/);
});

test('image right panel reuses the Text Lyrics viewer and dock structure', () => {
    const html = read('public/index.html');
    const textStart = html.indexOf('<aside class="workspace-preview preview-stage--lyrics"');
    const imageStart = html.indexOf('<aside class="image-lyrics-preview workspace-preview preview-stage--lyrics"');
    const videoStart = html.indexOf('<section id="panel-video"');
    assert.ok(textStart >= 0 && imageStart > textStart && videoStart > imageStart, 'expected Text and Image Lyrics preview markup');
    const textPreview = html.slice(textStart, html.indexOf('</aside>', textStart) + '</aside>'.length);
    const imagePreview = html.slice(imageStart, videoStart);

    const classTokens = markup => new Set([...markup.matchAll(/class="([^"]+)"/g)].flatMap(match => match[1].split(/\s+/)));
    const textClasses = classTokens(textPreview);
    const imageClasses = classTokens(imagePreview);
    for (const className of [
        'workspace-preview', 'preview-stage--lyrics', 'preview-frame', 'preview-frame--prompter-focus',
        'preview-viewfinder-heading', 'preview-viewfinder-label', 'preview-viewfinder-format',
        'preview-viewfinder-slot', 'preview-viewfinder-16x9', 'preview-prompter-dock',
        'preview-shortcuts-strip', 'preview-prompter-toolbar', 'preview-toolbar-group',
        'preview-speed-control', 'preview-speed-label', 'preview-speed-value',
    ]) {
        assert.ok(textClasses.has(className), `Text Lyrics should use ${className}`);
        assert.ok(imageClasses.has(className), `Image Lyrics should use shared ${className} hook`);
    }
    assert.match(imagePreview, /id="image-lyrics-preview-stage"/);
    assert.match(imagePreview, /id="image-lyrics-dock"/);
    assert.match(imagePreview, /class="image-lyrics-preview workspace-preview preview-stage--lyrics"/);
    assert.match(imagePreview, /class="preview-viewfinder-16x9 image-lyrics-preview__stage"/);
    assert.match(imagePreview, /class="preview-prompter-toolbar"/);
});

test('image shortcut reference documents the current Image Lyrics keyboard handler and popup controls', () => {
    const html = read('public/index.html');
    const editor = read('public/js/features/image-lyrics/index.js');
    const prompter = read('public/js/features/image-prompter/prompter.js');
    const dialog = html.match(/<dl class="preview-shortcuts-dialog__list">([\s\S]*?)<\/dl>/)?.[1];
    const handler = editor.match(/document\.addEventListener\('keydown',[\s\S]*?\n\}, true\);/)?.[0];
    const popupHandler = prompter.match(/window\.addEventListener\('keydown',\s*\(event\)\s*=>\s*\{([\s\S]*?)\n    \}\);/)?.[1];
    assert.ok(dialog, 'expected Image Lyrics shortcut reference');
    assert.ok(handler, 'expected Image Lyrics key handler');
    assert.ok(popupHandler, 'expected Image prompter key handler');

    for (const [label, keyText] of [
        ['Send to prompter', '<kbd>`</kbd>'],
        ['Play / pause', '<kbd>Space</kbd>'],
        ['Previous / next image', 'Double-press the same <kbd>←</kbd> or <kbd>→</kbd> key within 400 ms'],
        ['Manual scroll', '<kbd>↑</kbd> <kbd>↓</kbd> — 100px per step'],
        ['Jump to top', '<kbd>T</kbd>'],
        ['Scroll speed', '<kbd>1</kbd>–<kbd>9</kbd> presets; <kbd>0</kbd> pauses'],
        ['Speed increments', 'Numpad <kbd>+</kbd> / <kbd>−</kbd>'],
    ]) {
        const row = dialog.match(new RegExp(`<div><dt>${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<\\/dt><dd>([\\s\\S]*?)<\\/dd><\\/div>`))?.[0];
        assert.ok(row, `shortcut reference should include ${label}`);
        assert.ok(row.includes(keyText), `${label} should show ${keyText}`);
    }
    assert.match(handler, /event\.code === 'Backquote'\) action = 'send'/);
    assert.match(handler, /event\.code === 'Space'\) action = 'playPause'/);
    assert.match(handler, /event\.code === 'ArrowLeft' \|\| event\.code === 'ArrowRight'[\s\S]*?if \(!matchImageArrow\(event\.code, event\.repeat\)\) \{ event\.preventDefault\(\); return; \}[\s\S]*?action = event\.code === 'ArrowLeft' \? 'previous' : 'next'/);
    assert.match(handler, /event\.code === 'ArrowUp' \|\| event\.code === 'ArrowDown'[\s\S]*?values\.delta = event\.code === 'ArrowUp' \? 100 : -100/);
    assert.match(handler, /event\.code === 'KeyT'\) action = 'top'/);
    assert.match(handler, /event\.code === 'Digit0'\) action = 'pause'/);
    assert.match(handler, /\^Digit\[1-9\]\$[\s\S]*?speed = Number\(event\.code\.slice\(-1\)\) \* 0\.5[\s\S]*?action = 'speed'/);
    assert.match(handler, /event\.code === 'NumpadAdd' \|\| event\.code === 'NumpadSubtract'[\s\S]*?action = 'speedNudge'/);
    assert.match(handler, /if \(event\.repeat && event\.code !== 'ArrowUp' && event\.code !== 'ArrowDown'\) \{ resetImageArrow\(\); return; \}/);
    assert.match(popupHandler, /if \(event\.repeat && event\.code !== 'ArrowUp' && event\.code !== 'ArrowDown'\) \{ resetNavigationArrow\(\); return; \}\s*if \(event\.code !== 'ArrowLeft' && event\.code !== 'ArrowRight'\) resetNavigationArrow\(\);\s*switch \(event\.code\)/);
    for (const action of ['playPause', 'pause', 'previous', 'next', 'scrollBy', 'top', 'speed', 'speedNudge']) {
        assert.match(prompter, new RegExp(`case '${action}'\\s*:`), `Image prompter should handle ${action}`);
    }
    assert.match(handler, /if \(action === 'send'\) open\(\);\s*else control\(action, values\)/);
    assert.doesNotMatch(dialog, /Smaller text|Larger text|Narrower lines|Wider lines|theme/i);
});

test('image shortcut dialog opens, closes, restores focus, and handles Escape', () => {
    const html = read('public/index.html');
    const editor = read('public/js/features/image-lyrics/index.js');
    const imagePanel = html.match(/<section id="panel-image"[\s\S]*?(?=<section id="panel-video")/)?.[0];
    assert.ok(imagePanel, 'expected Image Lyrics panel');
    assert.match(imagePanel, /id="image-lyrics-shortcuts-help-btn"[^>]*aria-haspopup="dialog"[^>]*aria-controls="image-lyrics-shortcuts-dialog"[^>]*aria-expanded="false"/);
    assert.match(imagePanel, /id="image-lyrics-shortcuts-dialog"[^>]*hidden role="dialog" aria-modal="true" aria-labelledby="image-lyrics-shortcuts-dialog-title"/);
    assert.match(imagePanel, /id="image-lyrics-shortcuts-dialog-close" aria-label="Close"/);
    assert.match(imagePanel, /id="image-lyrics-shortcuts-dialog-backdrop" tabindex="-1"/);

    assert.match(editor, /function closeShortcuts\(\)\{shortcutsDialog\.hidden=true;shortcutsButton\.setAttribute\('aria-expanded','false'\);shortcutsButton\.focus\(\)\}/);
    assert.match(editor, /shortcutsButton\.onclick=\(\)=>\{shortcutsDialog\.hidden=false;shortcutsButton\.setAttribute\('aria-expanded','true'\);shortcutsClose\.focus\(\)\}/);
    assert.match(editor, /shortcutsClose\.onclick=closeShortcuts;shortcutsBackdrop\.onclick=closeShortcuts/);
    assert.match(editor, /if \(!shortcutsDialog\.hidden\) \{\s*resetImageArrow\(\);\s*event\.stopImmediatePropagation\(\);\s*if \(event\.code === 'Escape'\) \{ event\.preventDefault\(\); closeShortcuts\(\); \}/);
    assert.match(editor, /if \(event\.code === 'Tab'\) \{[\s\S]*?shortcutsDialog\.querySelectorAll\('button:not\(:disabled\), a\[href\], input:not\(:disabled\), select:not\(:disabled\), textarea:not\(:disabled\), \[tabindex\]:not\(\[tabindex="-1"\]\)'\)/);
    assert.match(editor, /if \(event\.shiftKey && \(document\.activeElement === first \|\| !shortcutsDialog\.contains\(document\.activeElement\)\)\) last\.focus\(\)/);
    assert.match(editor, /else if \(!event\.shiftKey && \(document\.activeElement === last \|\| !shortcutsDialog\.contains\(document\.activeElement\)\)\) first\.focus\(\)/);
});

test('image preview follows the Text Lyrics responsive right-panel ordering', () => {
    const html = read('public/index.html');
    const workspaceCss = read('public/assets/css/image-lyrics.css');
    const panel = html.match(/<section id="panel-image"[\s\S]*?(?=<section id="panel-video")/)?.[0];
    const workspaceRule = workspaceCss.match(/\.image-lyrics-workspace\s*\{([^}]+)\}/)?.[1];
    const responsive = workspaceCss.match(/@media\s*\(max-width:\s*1200px\)\s*\{([\s\S]*?)(?=@media|$)/)?.[1];
    assert.ok(panel, 'expected Image Lyrics panel markup');
    assert.ok(workspaceRule, 'expected desktop Image Lyrics grid styles');
    assert.ok(responsive, 'expected the Image Lyrics compact workspace breakpoint');
    const toolbarPosition = panel.indexOf('<header class="image-lyrics-toolbar">');
    const previewPosition = panel.indexOf('<aside class="image-lyrics-preview');
    const blocksPosition = panel.indexOf('<section class="image-lyrics-blocks"');
    assert.ok(toolbarPosition >= 0 && previewPosition > toolbarPosition && blocksPosition > previewPosition,
        'Image DOM order should be toolbar, preview, then blocks for compact layouts');
    assert.match(workspaceCss, /\.image-lyrics-workspace\s*\{[^}]*display:\s*grid/s);
    assert.match(workspaceRule, /grid-template-columns:\s*minmax\(0,\s*48fr\)\s+minmax\(0,\s*52fr\)/);
    assert.match(workspaceRule, /grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)/);
    assert.match(workspaceRule, /grid-template-areas:\s*"toolbar preview"\s+"blocks preview"/);
    assert.match(responsive, /\.image-lyrics-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
    assert.match(responsive, /grid-template-areas:\s*"toolbar"\s+"preview"\s+"blocks"/);
    assert.match(responsive, /\.image-lyrics-preview\s*\{[^}]*width:\s*100%/s);
});

test('image blocks show filenames and lock uploaded images until cleared', () => {
    const editor = read('public/js/features/image-lyrics/index.js');
    const workspaceCss = read('public/assets/css/image-lyrics.css');

    assert.match(editor, /title\.textContent=b\.file\?\.name\|\|\('Block '\+\(i\+1\)\)/);
    assert.match(editor, /if\(!b\|\|b\.file\)return/);
    assert.match(editor, /input\.disabled=!!b\.file/);
    assert.match(editor, /function clearBlock\(i\)[\s\S]*?b\.file=null;b\.url=''/);
    assert.match(editor, /if\(b\.file\)clearBlock\(i\);else removeBlock\(i\)/);
    assert.match(workspaceCss, /\.image-lyrics-block__header h3\s*\{[^}]*font-size:\s*0\.66rem/);
    assert.match(workspaceCss, /\.image-lyrics-block\.is-selected \.image-lyrics-block__header h3/);
});

test('image preview and popup stage keep responsive 16:9 sizing', () => {
    const workspaceCss = read('public/assets/css/image-lyrics.css');
    const popupCss = read('public/assets/css/image-prompter.css');
    const blockGrid = workspaceCss.match(/\.image-lyrics-blocks\s*\{([^}]+)\}/)?.[1];
    const previewStage = workspaceCss.match(/\.image-lyrics-preview__stage\s*\{([^}]+)\}/)?.[1];
    const popupStage = popupCss.match(/\.image-prompter-stage\s*\{([^}]+)\}/)?.[1];

    assert.ok(blockGrid, 'expected image block grid styles');
    assert.match(blockGrid, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    assert.match(workspaceCss, /@media\s*\(max-width:\s*720px\)\s*\{[^}]*\.image-lyrics-blocks\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
    assert.match(workspaceCss, /@media\s*\(max-width:\s*480px\)\s*\{[^}]*\.image-lyrics-blocks\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
    assert.match(workspaceCss, /\.image-lyrics-dropzone\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9/);
    assert.doesNotMatch(workspaceCss.match(/\.image-lyrics-dropzone\s*\{([^}]+)\}/)?.[1] || '', /height:\s*260px/);
    assert.match(workspaceCss, /\.image-lyrics-preview__stage\s*>\s*img\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
    assert.ok(previewStage, 'expected image preview stage styles');
    assert.match(previewStage, /overflow:\s*hidden/);
    const compactWorkspace = workspaceCss.match(/@media\s*\(max-width:\s*1200px\)\s*\{([\s\S]*?)(?=@media|$)/)?.[1];
    assert.ok(compactWorkspace, 'expected compact Image Lyrics layout');
    assert.match(compactWorkspace, /\.image-lyrics-workspace\s*\{[^}]*grid-template-areas:\s*"toolbar"\s+"preview"\s+"blocks"/s);
    assert.ok(popupStage, 'expected fixed 16:9 popup stage styles');
    assert.match(popupStage, /width:\s*1920px/);
    assert.match(popupStage, /height:\s*1080px/);
    assert.match(popupCss, /\.image-prompter-content img\s*\{[^}]*width:\s*1920px;[^}]*height:\s*auto/s);
});

test('image preview stays synchronized with popup scrolling without rebuilding or reloading unchanged images', () => {
    const editor = read('public/js/features/image-lyrics/index.js');
    const prompter = read('public/js/features/image-prompter/prompter.js');
    const workspaceCss = read('public/assets/css/image-lyrics.css');
    const tick = prompter.match(/function tick\(timestamp\)\s*\{([\s\S]*?)\n    \}/)?.[1];
    const updatePreview = editor.match(/function updatePreview\(\)\s*\{([\s\S]*?)\nfunction render\(\)/)?.[1];
    const updatePreviewPosition = editor.match(/function updatePreviewPosition\(\)\s*\{([^}]+)\}/)?.[1];
    const previewStage = workspaceCss.match(/\.image-lyrics-preview__stage\s*\{([^}]+)\}/)?.[1];
    const popupCss = read('public/assets/css/image-prompter.css');
    const popupStage = popupCss.match(/\.image-prompter-stage\s*\{([^}]+)\}/)?.[1];

    assert.ok(tick, 'expected popup animation tick');
    assert.match(tick, /requestAnimationFrame\(tick\)/);
    assert.match(tick, /notifyState\(\)/);
    assert.match(editor, /const item=lineup\(\)\[e\.data\.currentIndex\],nextSelected=item\?item\.blockIndex:selected/);
    assert.match(editor, /if\(selectionChanged\)renderBlocks\(\);updatePreview\(\)/);
    assert.ok(updatePreview, 'expected preview update function');
    assert.match(updatePreview, /if\(preview\.dataset\.previewUrl!==sourceUrl\)\{[\s\S]*?preview\.src=sourceUrl\}/);
    assert.match(updatePreview, /preview\.dataset\.previewUrl=sourceUrl/);
    assert.ok(updatePreviewPosition, 'expected preview positioning function');
    assert.match(updatePreviewPosition, /renderedHeight=preview\.naturalHeight\*stage\.clientWidth\/preview\.naturalWidth/);
    assert.match(updatePreviewPosition, /scrollScale=stage\.clientWidth\/1920/);
    assert.match(updatePreviewPosition, /renderedHeight<=stage\.clientHeight\?\(stage\.clientHeight-renderedHeight\)\/2/);
    assert.match(updatePreviewPosition, /Math\.min\(maxPreviewScroll,Math\.max\(0,scrollTop\*scrollScale\)\)/);
    assert.match(updatePreviewPosition, /preview\.style\.top=/);
    assert.ok(previewStage, 'expected preview stage styles');
    assert.match(previewStage, /overflow:\s*hidden/);
    assert.match(editor, /stage\.addEventListener\('wheel',event=>/);
    assert.match(editor, /event\.preventDefault\(\)/);
    assert.match(editor, /const logicalDelta=event\.deltaY\*1920\/stage\.clientWidth/);
    assert.match(editor, /control\('scrollBy',\{delta:-logicalDelta\}\)/);
    assert.match(editor, /maxLogicalScroll=Math\.max\(0,\(renderedHeight-stage\.clientHeight\)\*1920\/stage\.clientWidth\)/);
    assert.match(editor, /scrollTop=Math\.max\(0,Math\.min\(maxLogicalScroll,scrollTop\+logicalDelta\)\);updatePreviewPosition\(\)/);
    assert.match(editor, /\},\{passive:false\}\)/);
    assert.match(prompter, /pendingScrollTop = requestedScrollTop;/);
    assert.doesNotMatch(prompter, /if \(paused\) pendingScrollTop = null/);
    assert.match(prompter, /if \(pendingScrollTop !== null\)\s*\{\s*scrollTop = pendingScrollTop;\s*pendingScrollTop = null;/);
    assert.match(prompter, /let renderGeneration = 0/);
    assert.match(prompter, /generation !== renderGeneration \|\| content\.querySelector\('img'\) !== image/);
    assert.match(prompter, /function maxScrollTop\(\)\s*\{\s*return Math\.max\(0,\s*content\.scrollHeight\s*-\s*STAGE_HEIGHT\);\s*\}/);
    assert.match(prompter, /content\.style\.transform\s*=\s*`translateY\(\$\{-scrollTop\}px\)`/);
    assert.ok(popupStage, 'expected independent popup stage styles');
    assert.match(popupStage, /overflow:\s*hidden/);
});

test('image tab close matches the Text Lyrics close glyph dimensions', () => {
    const editor = read('public/js/features/image-lyrics/index.js');
    const workspaceCss = read('public/assets/css/image-lyrics.css');

    assert.match(editor, /close\.textContent='×'/);
    assert.match(workspaceCss, /\.image-lyrics-tabs \.image-lyrics-tab-close\s*\{[^}]*right:\s*4px;[^}]*font-size:\s*1rem;[^}]*line-height:\s*1;[^}]*text-align:\s*center/s);
    assert.match(workspaceCss, /\.image-lyrics-tabs \.image-lyrics-tab-edit,\s*\.image-lyrics-tabs \.image-lyrics-tab-close\s*\{[^}]*width:\s*1\.35rem;[^}]*height:\s*1\.35rem/s);
});

test('Electron opens image prompter popups at the same 16:9 stage size as text', async () => {
    const source = read('electron/main.js');
    let onReady;
    let popupHandler;
    let createdWindow;

    class MockBrowserWindow {
        constructor(options) {
            this.options = options;
            this.webContents = {
                setWindowOpenHandler(handler) { popupHandler = handler; },
                on() {},
            };
            createdWindow = this;
        }
        loadURL() {}
        isDestroyed() { return false; }
        on() {}
        static getAllWindows() { return []; }
    }

    const app = {
        commandLine: { appendSwitch() {} },
        whenReady() { return { then(callback) { onReady = callback; } }; },
        on() {},
    };
    const powerSaveBlocker = { start() { return 1; }, stop() {} };
    const context = {
        require(name) {
            if (name !== 'electron') throw new Error(`Unexpected require: ${name}`);
            return { app, BrowserWindow: MockBrowserWindow, powerSaveBlocker };
        },
        process: { env: {}, platform: 'linux' },
        console,
    };
    vm.runInNewContext(source, context, { filename: 'electron/main.js' });
    onReady();
    await Promise.resolve();

    assert.ok(createdWindow);
    const imageResult = popupHandler({ url: 'https://eclyrics.web.app/image-prompter.html' });
    const textResult = popupHandler({ url: 'https://eclyrics.web.app/prompter.html?title=lyrics' });
    const unrelatedResult = popupHandler({ url: 'https://eclyrics.web.app/image-prompter.html.evil' });

    for (const result of [imageResult, textResult]) {
        assert.equal(result.action, 'allow');
        assert.equal(result.overrideBrowserWindowOptions.width, 1920);
        assert.equal(result.overrideBrowserWindowOptions.height, 1080);
    }
    assert.equal(unrelatedResult.action, 'allow');
    assert.equal(unrelatedResult.overrideBrowserWindowOptions, undefined);
});
