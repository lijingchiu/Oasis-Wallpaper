(()=>{'use strict';
 let screens=[],selectedScreen='',ready=false;
 window.oasisWallpaperLoginState=value=>{const input=document.getElementById('login');input.checked=!!value?.enabled;input.disabled=value?.available===false};
 window.oasisWallpaperImportResult=value=>{const status=document.getElementById('import-status'),button=document.getElementById('import-oasis');button.disabled=false;status.hidden=false;status.textContent=value?.ok?'已匯入 Oasis 桌布，請選擇螢幕及桌布。':value?.error==='already-configured'?'獨立版已有桌布設定，為保留目前內容，未覆寫。':value?.error==='source-unavailable'?'找不到可匯入的 Oasis 桌布設定。':value?.error==='import-busy'?'桌布正在處理中，請稍後重試。':'無法安全複製桌布，請使用上傳或 Steam 連結新增。';if(value?.ok)window.OasisWeather.refresh()};
 const originalScreens=window.oasisDesktopScreens;
 window.oasisDesktopScreens=rows=>{
  screens=Array.isArray(rows)?rows.filter(row=>row&&typeof row.id==='string'&&typeof row.name==='string'):[];
  if(!screens.some(row=>row.id===selectedScreen))selectedScreen=screens[0]?.id||'';
  originalScreens?.(rows);
  const warning=document.getElementById('owner-warning');if(warning)warning.hidden=!screens.some(row=>row.desktopOwnershipBlocked);
  if(ready)renderTargets();
 };
 function targetMarkup(){return '<label class="ow-target"><span>套用螢幕</span><select aria-label="套用螢幕"></select></label>'}
 function renderTargets(){
  for(const select of document.querySelectorAll('.ow-target select')){
   const key=JSON.stringify(screens.map(row=>[row.id,row.name,row.width,row.height]));
   if(select.dataset.key!==key){select.dataset.key=key;select.replaceChildren();if(!screens.length){const option=document.createElement('option');option.textContent='找不到螢幕';select.append(option)}for(const row of screens){const option=document.createElement('option');option.value=row.id;option.textContent=row.name;select.append(option)}}
   select.disabled=!screens.length;select.value=selectedScreen;
  }
  document.querySelectorAll('.ow-clear-display').forEach(button=>button.disabled=!selectedScreen);
  if(selectedScreen)window.OasisWeather.selectDesktopScreen(selectedScreen);
 }
 function syncChrome(){
  const bridge=window.webkit?.messageHandlers?.mole,header=document.querySelector('.wallpaper-header');if(!bridge||!header)return;
  const bounds=header.getBoundingClientRect(),control=document.querySelector('.startup-toggle').getBoundingClientRect();
  bridge.postMessage({action:'windowChrome',modal:!!document.querySelector('dialog[open]'),drag:{height:Math.max(0,Math.min(120,bounds.bottom)),exclusions:[{x:control.x,y:control.y,width:control.width,height:control.height}]}});
 }
 function start(){
  window.OasisWeather.mountSettings(document.getElementById('wallpaper-settings'));
  window.MoleTheme.mount(document.getElementById('wallpaper-appearance'));
  const desktop=document.querySelector('.wx-desktop-settings');desktop.open=true;
  const picker=document.querySelector('.wx-background-picker'),body=picker.querySelector('.wx-background-body'),gallery=body.querySelector('.wx-scenery-grid');
  const target=document.createElement('div');target.className='ow-library-target';target.innerHTML=targetMarkup()+'<button type="button" class="btn ow-clear-display">此螢幕不套用</button>';
  const filters=document.createElement('aside');filters.className='ow-library-filters';filters.innerHTML='<label>搜尋<input type="search" aria-label="搜尋桌布庫" placeholder="搜尋桌布"></label><label>來源<select aria-label="桌布來源"><option value="all">全部桌布</option><option value="local">自行上傳</option><option value="workshop">Steam 工作坊</option></select></label>';
  const preview=document.createElement('aside');preview.className='ow-selected-preview';preview.innerHTML='<span>此螢幕目前的桌布</span><img alt="" hidden><strong></strong>';
  const controls=document.createElement('aside');controls.className='ow-library-controls';gallery.before(controls);
  const progress=desktop.querySelector('.wx-desktop-download');progress.classList.add('ow-library-progress');controls.append(target,filters,body.querySelector('.wx-upload-bar'),progress);
  const sidebar=document.createElement('aside');sidebar.className='ow-library-sidebar';sidebar.append(preview,body.querySelector('.wx-wallpaper-adjustments'),body.querySelector('.wx-archived'));body.append(sidebar);
  const workshopTarget=document.createElement('div');workshopTarget.className='ow-workshop-target';workshopTarget.innerHTML=targetMarkup();picker.querySelector('.wx-workshop-actions').before(workshopTarget);
  document.querySelectorAll('.ow-target select').forEach(select=>select.addEventListener('change',event=>{selectedScreen=event.target.value;renderTargets();refreshLibrary()}));
  target.querySelector('.ow-clear-display').addEventListener('click',()=>window.OasisWeather.clearDesktopWallpaper(selectedScreen).catch(()=>{}));
  function refreshLibrary(){
   const selected=gallery.querySelector('[aria-pressed=true][data-custom-background]'),rows=window.OasisWeather.get().customImages||[],term=filters.querySelector('input').value.trim().toLocaleLowerCase(),kind=filters.querySelector('select').value;
   gallery.querySelectorAll('[data-background]').forEach(card=>{const row=rows.find(item=>item.id===card.dataset.background),match=!!row&&(kind==='all'||kind==='local'&&!row.workshopID||kind==='workshop'&&!!row.workshopID);card.hidden=!match||!!term&&!card.textContent.toLocaleLowerCase().includes(term)});
   const desktop=window.OasisWeather.get().settings.desktop,choice=desktop?.screens?.[selectedScreen]||'follow';
   preview.querySelector('strong').textContent=desktop?.enabled&&choice!=='off'?(selected?.querySelector('strong')?.textContent||'目前使用先前的桌布'):'未套用桌布';const image=selected?.querySelector('img'),targetImage=preview.querySelector('img');if(desktop?.enabled&&choice!=='off'&&image?.getAttribute('src')){targetImage.src=image.getAttribute('src');targetImage.hidden=false}else{targetImage.removeAttribute('src');targetImage.hidden=true}
  }
  filters.addEventListener('input',refreshLibrary);filters.addEventListener('change',refreshLibrary);new MutationObserver(refreshLibrary).observe(gallery,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-pressed']});
  ready=true;renderTargets();refreshLibrary();
  let browser=null;const workshop=document.querySelector('#workshop-browser'),workshopDetail=document.createElement('div');workshopDetail.className='ow-workshop-preview';workshopDetail.hidden=true;workshopDetail.innerHTML='<img alt=""><strong></strong>';picker.querySelector('.wx-workshop-body').prepend(workshopDetail);
  function switchPage(page){
   document.body.dataset.page=page;document.querySelectorAll('[data-page-tab]').forEach(button=>{if(button.dataset.pageTab===page)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current')});
   workshop.hidden=page!=='workshop';document.getElementById('wallpaper-settings').hidden=page==='appearance';document.getElementById('wallpaper-appearance').hidden=page!=='appearance';document.getElementById('page-description').textContent=page==='workshop'?'探索 Steam 工作坊中的桌布。':page==='settings'?'調整電源與播放效能。':page==='appearance'?'調整 Oasis Wallpaper 的玻璃外觀。':'選擇螢幕，點選桌布即可套用。';
   if(page==='workshop'){
    picker.open=true;picker.querySelector('.wx-workshop').open=true;
    if(!browser){
     browser=window.OasisWorkshopBrowser.mount(workshop,{onClear:()=>{workshopDetail.hidden=true;window.OasisWeather.clearWorkshopSelection()},onSelect:item=>{workshopDetail.hidden=false;workshopDetail.querySelector('img').src=item.preview;workshopDetail.querySelector('strong').textContent=item.title;window.OasisWeather.inspectWorkshop(item.url)}});
     const controls=document.createElement('aside');controls.className='ow-workshop-controls';const form=workshop.querySelector('.owb-search'),filters=workshop.querySelector('.owb-filters');form.before(controls);controls.append(form,filters);browser.search();
    }
   }else if(page==='library')picker.open=true;
   window.scrollTo({top:0,behavior:'auto'});syncChrome();
  }
  document.querySelectorAll('[data-page-tab]').forEach(button=>button.onclick=()=>switchPage(button.dataset.pageTab));
  document.getElementById('login').addEventListener('change',event=>window.webkit?.messageHandlers?.mole?.postMessage({action:'loginAtStartup',enabled:event.target.checked}));
  document.getElementById('import-oasis').addEventListener('click',event=>{const bridge=window.webkit?.messageHandlers?.mole;if(!bridge)return;event.currentTarget.disabled=true;const status=document.getElementById('import-status');status.hidden=false;status.textContent='正在匯入 Oasis 桌布…';bridge.postMessage({action:'importOasis'})});
  const chrome=document.querySelector('.wallpaper-chrome');new ResizeObserver(()=>document.documentElement.style.setProperty('--chrome-height',`${chrome.offsetHeight}px`)).observe(chrome);
  window.addEventListener('resize',syncChrome);window.addEventListener('scroll',syncChrome,{passive:true});new MutationObserver(syncChrome).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open']});
  syncChrome();window.webkit?.messageHandlers?.mole?.postMessage({action:'desktopScreens'});window.webkit?.messageHandlers?.mole?.postMessage({action:'loginAtStartupState'});
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
