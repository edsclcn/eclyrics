(() => {
const panel=document.getElementById('panel-image'); if(!panel)return;
const $=id=>document.getElementById(id), tabsEl=$('image-lyrics-tabs'), blocksEl=$('image-lyrics-blocks');
const add=$('image-lyrics-add-tab'), sendBtn=$('image-lyrics-send'), preview=$('image-lyrics-preview-image');
const exportButton=$('image-lyrics-export'), importButton=$('image-lyrics-import-trigger'), importInput=$('image-lyrics-import-file');
const shortcutsButton=$('image-lyrics-shortcuts-help-btn'), shortcutsDialog=$('image-lyrics-shortcuts-dialog');
const shortcutsClose=$('image-lyrics-shortcuts-dialog-close'), shortcutsBackdrop=$('image-lyrics-shortcuts-dialog-backdrop');
const empty=$('image-lyrics-preview-empty'), stage=$('image-lyrics-preview-stage'), prefix='eclyrics-image-prompter-';
const ids={play:'image-lyrics-play',prev:'image-lyrics-prev',next:'image-lyrics-next',up:'image-lyrics-scroll-up',down:'image-lyrics-scroll-down',top:'image-lyrics-scroll-top',speed:'image-lyrics-speed'};
const controls=Object.fromEntries(Object.entries(ids).map(([key,id])=>[key,$(id)]));
let tabs=[], tabId=0, active=0, selected=0, popup=null, ready=false, paused=true, speed=.5, scrollTop=0;
let pendingImageArrow='', pendingImageArrowAt=0;
function matchImageArrow(code,repeat=false){if(repeat)return false;if(code!=='ArrowLeft'&&code!=='ArrowRight'){pendingImageArrow='';pendingImageArrowAt=0;return false}const now=Date.now(),matched=pendingImageArrow===code&&now-pendingImageArrowAt<=400;pendingImageArrow=matched?'':code;pendingImageArrowAt=matched?0:now;return matched}
function resetImageArrow(){pendingImageArrow='';pendingImageArrowAt=0}
const tab=()=>tabs.find(t=>t.id===active), block=()=>tab()?.blocks[selected];
const lineup=()=>tab()?.blocks.flatMap((b,i)=>b.file?[{name:b.file.name,type:b.file.type,blob:b.file,blockIndex:i}]:[])||[];
function status(text,error=false){let e=$('image-lyrics-status');if(!text&&!e)return;if(!e){e=document.createElement('p');e.id='image-lyrics-status';e.className='image-lyrics-hint image-lyrics-status';e.setAttribute('role','status');e.setAttribute('aria-live','polite');document.querySelector('.image-lyrics-toolbar-meta')?.append(e)}e.textContent=text;e.classList.toggle('is-error',error)}
function revoke(b){if(b?.url)URL.revokeObjectURL(b.url)}
function startTabRename(t,li,label){
    const input=document.createElement('input');
    input.className='image-lyrics-tab-rename-input';input.value=t.name;input.setAttribute('aria-label','Rename '+t.name);
    input.onclick=e=>e.stopPropagation();
    let finished=false;
    const finish=save=>{
        if(finished)return;finished=true;
        if(save&&input.value.trim())t.name=input.value.trim();
        renderTabs();
    };
    input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();finish(true)}else if(e.key==='Escape'){e.preventDefault();finish(false)}};
    input.onblur=()=>finish(true);
    li.classList.add('is-renaming');label.hidden=true;li.append(input);input.focus();input.select();
}
function renderTabs(){
    tabsEl.replaceChildren();
    tabs.forEach(t=>{
        const li=document.createElement('li'),select=document.createElement('button'),label=document.createElement('span');
        li.className='image-lyrics-tab'+(t.id===active?' is-active':'');li.title=t.name;
        select.type='button';select.className='image-lyrics-tab-select';select.setAttribute('aria-label',t.name);select.setAttribute('aria-selected',String(t.id===active));
        label.className='image-lyrics-tab-label';label.textContent=t.name;select.append(label);li.append(select);
        select.onclick=()=>{active=t.id;selected=0;scrollTop=0;render();sync()};
        select.ondblclick=()=>startTabRename(t,li,label);
        const edit=document.createElement('button');edit.type='button';edit.className='image-lyrics-tab-edit';edit.title='Rename tab';edit.setAttribute('aria-label','Rename '+t.name);edit.innerHTML='<i class="fa-solid fa-pen" aria-hidden="true"></i>';
        edit.onclick=e=>{e.stopPropagation();startTabRename(t,li,label)};li.append(edit);
        const close=document.createElement('button');close.type='button';close.className='image-lyrics-tab-close';close.title='Close tab';close.setAttribute('aria-label','Close '+t.name);close.disabled=tabs.length<=1;close.textContent='×';
        close.onclick=e=>{e.stopPropagation();const i=tabs.indexOf(t);t.blocks.forEach(revoke);tabs=tabs.filter(v=>v!==t);if(active===t.id){active=tabs[Math.max(0,i-1)].id;selected=0}render();sync()};li.append(close);
        tabsEl.append(li);
    });
    add.disabled=tabs.length>=10;
}
function choose(i){selected=i;scrollTop=0;renderBlocks();updatePreview();sync()}
function assign(i,file){if(!file)return;const b=tab()?.blocks[i];if(!b||b.file)return;if(!file.type?.startsWith('image/')){status('Choose an image file to fill this block.',true);return}b.file=file;b.url=URL.createObjectURL(file);selected=i;if(i===tab().blocks.length-1)tab().blocks.push({file:null,url:''});status('');render();sync()}
function clearBlock(i){const b=tab()?.blocks[i];if(!b?.file)return;revoke(b);b.file=null;b.url='';selected=i;scrollTop=0;status('Image cleared from block '+(i+1)+'.');render();sync()}
function removeBlock(i){const t=tab();if(t.blocks.length<=1)return;revoke(t.blocks[i]);t.blocks.splice(i,1);if(i<selected)selected--;else if(selected>=t.blocks.length)selected=t.blocks.length-1;render();sync()}
function makeBlock(b,i,count){const a=document.createElement('article');a.className='image-lyrics-block'+(selected===i?' is-selected':'');a.tabIndex=0;a.setAttribute('aria-label','Image block '+(i+1));
const h=document.createElement('header');h.className='image-lyrics-block__header';const title=document.createElement('h3');title.textContent=b.file?.name||('Block '+(i+1));title.title=title.textContent;h.append(title);
if(count>1||b.file){const x=document.createElement('button');x.type='button';x.className='image-lyrics-block__remove';x.title=b.file?'Clear image':'Remove empty block';x.setAttribute('aria-label',b.file?'Clear image from block '+(i+1):'Remove empty block '+(i+1));x.innerHTML='<i class="fa-solid fa-xmark" aria-hidden="true"></i>';x.onclick=e=>{e.stopPropagation();if(b.file)clearBlock(i);else removeBlock(i)};h.append(x)}a.append(h);
const label=document.createElement('label');label.className='image-lyrics-dropzone';label.dataset.imageDropzone=i;
const input=document.createElement('input');input.type='file';input.accept='image/*';input.className='image-lyrics-file-input';input.disabled=!!b.file;input.setAttribute('aria-label','Choose an image for block '+(i+1));input.onchange=e=>assign(i,e.target.files?.[0]);
const help=document.createElement('span');help.className='image-lyrics-dropzone__content';help.innerHTML='<i class="fa-solid fa-cloud-arrow-up" aria-hidden="true"></i><strong>Drop an image here</strong><span>or choose a file</span>';
const img=document.createElement('img');img.className='image-lyrics-block__image';img.alt='';img.hidden=!b.url;if(b.url)img.src=b.url;label.append(input,help,img);
label.addEventListener('click',e=>{if(b.file){e.preventDefault();choose(i)}});
['dragenter','dragover'].forEach(k=>label.addEventListener(k,e=>{e.preventDefault();label.classList.add('is-dragging')}));
['dragleave','drop'].forEach(k=>label.addEventListener(k,e=>{e.preventDefault();label.classList.remove('is-dragging')}));
label.addEventListener('drop',e=>assign(i,e.dataTransfer?.files?.[0]));a.onclick=e=>{if(e.target.closest('button,label,input'))return;choose(i)};a.onkeydown=e=>{if(e.target===a&&['Enter',' '].includes(e.key)){e.preventDefault();choose(i)}};a.append(label);return a}
function renderBlocks(){blocksEl.replaceChildren();tab().blocks.forEach((b,i)=>blocksEl.append(makeBlock(b,i,tab().blocks.length)));$('image-lyrics-selected-title').textContent=block()?.file?.name||('Block '+(selected+1))}
function updatePreviewPosition(){if(preview.hidden||!preview.naturalWidth||!stage.clientWidth)return;const renderedHeight=preview.naturalHeight*stage.clientWidth/preview.naturalWidth,scrollScale=stage.clientWidth/1920,maxPreviewScroll=Math.max(0,renderedHeight-stage.clientHeight);preview.style.position='absolute';preview.style.left='0';preview.style.top=renderedHeight<=stage.clientHeight?(stage.clientHeight-renderedHeight)/2+'px':-Math.min(maxPreviewScroll,Math.max(0,scrollTop*scrollScale))+'px';preview.style.margin='0';preview.style.transform=''}
function updatePreview(){const b=block(),sourceUrl=b?.url||'',visible=!!sourceUrl&&preview.dataset.previewFailedUrl!==sourceUrl;preview.hidden=!visible;empty.hidden=visible;if(visible){if(preview.dataset.previewUrl!==sourceUrl){preview.dataset.previewUrl=sourceUrl;preview.dataset.previewFailedUrl='';preview.onload=updatePreviewPosition;preview.onerror=()=>{if(preview.dataset.previewUrl!==sourceUrl||block()?.url!==sourceUrl)return;preview.dataset.previewFailedUrl=sourceUrl;preview.hidden=true;empty.hidden=false;preview.removeAttribute('src');status('Unable to preview this image. Choose another file.',true)};preview.src=sourceUrl}updatePreviewPosition()}else{preview.dataset.previewUrl='';preview.onload=null;preview.onerror=null;if(preview.hasAttribute('src'))preview.removeAttribute('src');preview.style.transform=''}
const has=lineup().length>0;sendBtn.disabled=!has;const enabled=has&&popup&&!popup.closed;Object.values(controls).forEach(e=>e.disabled=!enabled);controls.play.setAttribute('aria-pressed',String(!paused));const icon=controls.play.querySelector('i');if(icon)icon.className=paused?'fa-solid fa-play':'fa-solid fa-pause'}
function render(){renderTabs();renderBlocks();updatePreview()}
function send(m){if(popup&&!popup.closed)popup.postMessage(m,location.origin==='null'?'*':location.origin)}
function sendInit(){const l=lineup();send({type:prefix+'init',lineup:l,currentIndex:Math.max(0,l.findIndex(x=>x.blockIndex===selected)),speed,paused,scrollTop})}
function sync(){if(ready&&popup&&!popup.closed)sendInit()}
function fileToBase64(file){
    return file.arrayBuffer().then(buffer=>{
        const bytes=new Uint8Array(buffer);let binary='';
        for(let offset=0;offset<bytes.length;offset+=0x8000)binary+=String.fromCharCode(...bytes.subarray(offset,offset+0x8000));
        return btoa(binary);
    });
}
async function saveLineup(){
    const savedTabs=await Promise.all(tabs.map(async t=>({
        name:t.name,
        blocks:await Promise.all(t.blocks.filter(b=>b.file).map(async b=>({
            name:b.file.name,type:b.file.type,data:await fileToBase64(b.file)
        })))
    })));
    if(!savedTabs.some(t=>t.blocks.length)){status('Image lineup is empty. Save was unsuccessful.',true);return}
    const payload={format:'eclyrics-image-lineup',version:1,tabs:savedTabs};
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    const filename=(tab()?.name||'Image Lineup').replace(/[^a-z0-9_-]+/gi,'_').slice(0,60)||'Image_Lineup';
    link.href=url;link.download=filename+'_image_lineup.json';link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    status('Image lineup saved as JSON.');
}
async function loadLineup(file){
    const created=[];
    try{
        const payload=JSON.parse(await file.text());
        if(payload?.format!=='eclyrics-image-lineup'||payload.version!==1||!Array.isArray(payload.tabs)||!payload.tabs.length||payload.tabs.length>10)throw new Error('Invalid image lineup');
        const restored=payload.tabs.map((savedTab,index)=>{
            if(!Array.isArray(savedTab.blocks))throw new Error('Invalid image blocks');
            const blocks=savedTab.blocks.map((savedBlock,blockIndex)=>{
                if(typeof savedBlock?.type!=='string'||!savedBlock.type.startsWith('image/')||typeof savedBlock.data!=='string')throw new Error('Invalid image data');
                const raw=atob(savedBlock.data),bytes=new Uint8Array(raw.length);
                for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
                const imageFile=new File([bytes],typeof savedBlock.name==='string'?savedBlock.name:('Image '+(blockIndex+1)),{type:savedBlock.type});
                const url=URL.createObjectURL(imageFile);created.push(url);
                return {file:imageFile,url};
            });
            while(blocks.length<Math.max(2,savedTab.blocks.length+1))blocks.push({file:null,url:''});
            return {id:index+1,name:typeof savedTab.name==='string'&&savedTab.name.trim()?savedTab.name.trim():('Tab '+(index+1)),blocks};
        });
        tabs.forEach(t=>t.blocks.forEach(revoke));
        tabs=restored;tabId=restored.length;active=restored[0].id;selected=0;scrollTop=0;
        render();sync();status('Image lineup loaded.');
    }catch(error){
        created.forEach(url=>URL.revokeObjectURL(url));
        status('That file is not a valid Image Lyrics lineup JSON.',true);
    }
}
function control(action,extra={}){send({type:prefix+'control',action,...extra})}
function open(){if(!lineup().length){status('Add at least one image before sending it to the prompter.',true);return}popup=window.open(new URL('image-prompter.html',location.href).href,'eclyricsImagePrompter','width=1920,height=1080,resizable=yes');if(!popup){status('Allow pop-ups to open the image prompter.',true);return}ready=false;popup.focus();setTimeout(sendInit,300);updatePreview()}
exportButton.addEventListener('click',saveLineup);
importButton.addEventListener('click',()=>importInput.click());
importInput.addEventListener('change',event=>{
    const file=event.target.files?.[0];
    if(file)loadLineup(file);
    event.target.value='';
});
add.onclick=()=>{if(tabs.length>=10)return;const id=++tabId;tabs.push({id,name:'Tab '+id,blocks:Array.from({length:2},()=>({file:null,url:''}))});active=id;selected=0;render()};
sendBtn.onclick=open;controls.play.onclick=()=>control('playPause');controls.prev.onclick=()=>control('previous');controls.next.onclick=()=>control('next');controls.up.onclick=()=>control('scrollBy',{delta:100});controls.down.onclick=()=>control('scrollBy',{delta:-100});controls.top.onclick=()=>control('top');
controls.speed.oninput=()=>{speed=Number(controls.speed.value);$('image-lyrics-speed-value').value=speed.toFixed(1);control('speed',{speed})};
function closeShortcuts(){shortcutsDialog.hidden=true;shortcutsButton.setAttribute('aria-expanded','false');shortcutsButton.focus()}
shortcutsButton.onclick=()=>{shortcutsDialog.hidden=false;shortcutsButton.setAttribute('aria-expanded','true');shortcutsClose.focus()};
shortcutsClose.onclick=closeShortcuts;shortcutsBackdrop.onclick=closeShortcuts;
window.addEventListener('message',e=>{if(e.source!==popup||typeof e.data?.type!=='string'||!e.data.type.startsWith(prefix))return;if(e.data.type===prefix+'ready'){ready=true;sendInit();return}if(e.data.type!==prefix+'state')return;const item=lineup()[e.data.currentIndex],nextSelected=item?item.blockIndex:selected,selectionChanged=nextSelected!==selected;if(item)selected=nextSelected;if(Number.isFinite(e.data.scrollTop))scrollTop=e.data.scrollTop;if(typeof e.data.paused==='boolean')paused=e.data.paused;if(Number.isFinite(e.data.speed)){speed=e.data.speed;controls.speed.value=String(speed);$('image-lyrics-speed-value').value=speed.toFixed(1)}if(selectionChanged)renderBlocks();updatePreview()});
window.addEventListener('resize', updatePreview);if(typeof ResizeObserver==='function')new ResizeObserver(updatePreviewPosition).observe(stage);stage.addEventListener('wheel',event=>{if(event.ctrlKey||event.metaKey)return;event.preventDefault();if(!preview.naturalWidth)return;const logicalDelta=event.deltaY*1920/stage.clientWidth;if(popup&&!popup.closed){control('scrollBy',{delta:-logicalDelta});return}const renderedHeight=preview.naturalHeight*stage.clientWidth/preview.naturalWidth,maxLogicalScroll=Math.max(0,(renderedHeight-stage.clientHeight)*1920/stage.clientWidth);scrollTop=Math.max(0,Math.min(maxLogicalScroll,scrollTop+logicalDelta));updatePreviewPosition()},{passive:false});setInterval(()=>{if(popup?.closed){popup=null;ready=false;paused=true;updatePreview()}},1000);
document.addEventListener('keydown', (event) => {
    if (!shortcutsDialog.hidden) {
        resetImageArrow();
        event.stopImmediatePropagation();
        if (event.code === 'Escape') { event.preventDefault(); closeShortcuts(); }
        if (event.code === 'Tab') {
            const focusable = [...shortcutsDialog.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')]
                .filter(element => element.getClientRects().length);
            if (focusable.length) {
                event.preventDefault();
                const first = focusable[0], last = focusable[focusable.length - 1];
                if (event.shiftKey && (document.activeElement === first || !shortcutsDialog.contains(document.activeElement))) last.focus();
                else if (!event.shiftKey && (document.activeElement === last || !shortcutsDialog.contains(document.activeElement))) first.focus();
            }
        }
        return;
    }
    if (event.code !== 'ArrowLeft' && event.code !== 'ArrowRight') resetImageArrow();
    if (event.repeat && event.code !== 'ArrowUp' && event.code !== 'ArrowDown') { resetImageArrow(); return; }
    const isInteractive = event.target.closest('button, a, input, textarea, select, [role="tab"], [contenteditable="true"]');
    if (!panel.classList.contains('is-active') || event.defaultPrevented || event.ctrlKey ||
        event.metaKey || event.altKey || isInteractive) { resetImageArrow(); return; }

    let action = null;
    let values = {};
    if (event.code === 'Backquote') action = 'send';
    else if (event.code === 'Space') action = 'playPause';
    else if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
        if (!matchImageArrow(event.code, event.repeat)) { event.preventDefault(); return; }
        action = event.code === 'ArrowLeft' ? 'previous' : 'next';
    }
    else if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
        action = 'scrollBy';
        values.delta = event.code === 'ArrowUp' ? 100 : -100;
    } else if (event.code === 'KeyT') action = 'top';
    else if (event.code === 'Digit0') action = 'pause';
    else if (/^Digit[1-9]$/.test(event.code)) {
        speed = Number(event.code.slice(-1)) * 0.5;
        controls.speed.value = String(speed);
        $('image-lyrics-speed-value').value = speed.toFixed(1);
        action = 'speed';
        values.speed = speed;
    } else if (event.code === 'NumpadAdd' || event.code === 'NumpadSubtract') {
        action = 'speedNudge';
        values.delta = event.code === 'NumpadAdd' ? 0.1 : -0.1;
    }
    if (!action) return;
    event.preventDefault();
    if (action === 'send') open();
    else control(action, values);
}, true);
const id=++tabId;tabs.push({id,name:'Tab '+id,blocks:Array.from({length:2},()=>({file:null,url:''}))});active=id;render();
})();
