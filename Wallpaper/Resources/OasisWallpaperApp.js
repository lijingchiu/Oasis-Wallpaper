(()=>{'use strict';
 let screens=[],selectedScreen='',ready=false;
 window.oasisWallpaperLoginState=value=>{const input=document.getElementById('login');input.checked=!!value?.enabled;input.disabled=value?.available===false};
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
 function mountWallpaperPages(){
  window.OasisWeather.mountSettings(document.getElementById('wallpaper-settings'));
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
   const state=window.OasisWeather.get();
   const selected=gallery.querySelector('[aria-pressed=true][data-custom-background]'),rows=state.customImages||[],term=filters.querySelector('input').value.trim().toLocaleLowerCase(),kind=filters.querySelector('select').value;
   gallery.querySelectorAll('[data-background]').forEach(card=>{const row=rows.find(item=>item.id===card.dataset.background),match=!!row&&(kind==='all'||kind==='local'&&!row.workshopID||kind==='workshop'&&!!row.workshopID);card.hidden=!match||!!term&&!card.textContent.toLocaleLowerCase().includes(term)});
   const desktop=state.settings.desktop,choice=desktop?.screens?.[selectedScreen]||'follow';
   preview.querySelector('strong').textContent=desktop?.enabled&&choice!=='off'?(selected?.querySelector('strong')?.textContent||'目前使用先前的桌布'):'未套用桌布';const image=selected?.querySelector('img'),targetImage=preview.querySelector('img');if(desktop?.enabled&&choice!=='off'&&image?.getAttribute('src')){targetImage.src=image.getAttribute('src');targetImage.hidden=false}else{targetImage.removeAttribute('src');targetImage.hidden=true}
  }
  renderTargets();refreshLibrary();
  filters.addEventListener('input',refreshLibrary);filters.addEventListener('change',refreshLibrary);new MutationObserver(refreshLibrary).observe(gallery,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-pressed']});
  let browser=null;const workshop=document.querySelector('#workshop-browser'),workshopDetail=document.createElement('div');workshopDetail.className='ow-workshop-preview';workshopDetail.hidden=true;workshopDetail.innerHTML='<img alt=""><strong></strong>';picker.querySelector('.wx-workshop-body').prepend(workshopDetail);
  ready=true;
  return function openWallpaperPage(page){
   if(page==='workshop'){
    picker.open=true;picker.querySelector('.wx-workshop').open=true;
    if(!browser){
     const mounted=window.OasisWorkshopBrowser.mount(workshop,{
      onClear:()=>{workshopDetail.hidden=true;window.OasisWeather.clearWorkshopSelection()},
      onSelect:item=>{
       const image=workshopDetail.querySelector('img');
       image.hidden=!item.preview;
       if(item.preview)image.src=item.preview;else image.removeAttribute('src');
       workshopDetail.querySelector('strong').textContent=item.title;
       workshopDetail.hidden=false;
       window.OasisWeather.inspectWorkshop(item.url);
      }
     });
     const controls=document.createElement('aside');controls.className='ow-workshop-controls';const form=workshop.querySelector('.owb-search'),filters=workshop.querySelector('.owb-filters');form.before(controls);controls.append(form,filters);mounted.search();browser=mounted;
    }
   }else if(page==='library')picker.open=true;
  };
 }
 function start(){
  const settings=document.getElementById('wallpaper-settings');
  const appearance=document.getElementById('wallpaper-appearance');
  const workshop=document.getElementById('workshop-browser');
  const status=document.getElementById('page-load-status');
  const tabs=document.querySelectorAll('[data-page-tab]');
  const descriptions={library:'選擇螢幕，點選桌布即可套用。',workshop:'探索 Steam 工作坊中的桌布。',settings:'調整電源與播放效能。',appearance:'調整 Oasis Wallpaper 的玻璃外觀。'};
  let openWallpaperPage,appearanceReady=false;
  function switchPage(tab){
   const page=tab.dataset.pageTab;
   document.body.dataset.page=page;
   for(const other of tabs){
    if(other===tab)other.setAttribute('aria-current','page');else other.removeAttribute('aria-current');
   }
   document.getElementById('page-description').textContent=descriptions[page];
   let available=page==='appearance'?appearanceReady:!!openWallpaperPage;
   if(available && page!=='appearance'){
    try{openWallpaperPage(page)}catch(error){available=false;console.error('Oasis Wallpaper:',page,error)}
   }
   workshop.hidden=!available || page!=='workshop';
   settings.hidden=!available || page==='appearance';
   appearance.hidden=!available || page!=='appearance';
   if(!available)status.querySelector('span').textContent=tab.textContent+'未能載入。';
   status.hidden=available;
   window.scrollTo({top:0,behavior:'auto'});syncChrome();
  }
  // Bind window controls before mounting independently loaded page modules.
  for(const tab of tabs)tab.addEventListener('click',()=>switchPage(tab));
  const updateButton=document.getElementById('check-update'),updateStatus=document.getElementById('update-status');
  const updateText=updateStatus.querySelector('[role=status]'),updateBar=updateStatus.querySelector('progress');
  window.oasisWallpaperUpdate=state=>{
   updateButton.disabled=!!state.busy;
   updateButton.title='Oasis Wallpaper '+state.version;
   updateStatus.hidden=!state.message;
   updateText.textContent=state.message;
   updateBar.hidden=state.phase!=='downloading';
   updateBar.value=state.progress;
  };
  updateButton.addEventListener('click',()=>{
   const bridge=window.webkit?.messageHandlers?.mole;
   if(bridge){bridge.postMessage({action:'wallpaperCheckUpdate'});return}
   updateStatus.hidden=false;updateText.textContent='請在 Oasis Wallpaper App 內檢查更新。';
  });
  window.webkit?.messageHandlers?.mole?.postMessage({action:'wallpaperUpdateState'});
  document.getElementById('login').addEventListener('change',event=>window.webkit?.messageHandlers?.mole?.postMessage({action:'loginAtStartup',enabled:event.target.checked}));
  document.body.dataset.controlsReady='true';
  try{openWallpaperPage=mountWallpaperPages()}catch(error){console.error('Oasis Wallpaper: wallpaper settings',error)}
  try{window.MoleTheme.mount(appearance);appearanceReady=true}catch(error){console.error('Oasis Wallpaper: appearance',error)}
  switchPage(document.querySelector('[data-page-tab="library"]'));
  if(openWallpaperPage&&appearanceReady)window.webkit?.messageHandlers?.mole?.postMessage({action:'wallpaperReady'});
  const chrome=document.querySelector('.wallpaper-chrome');new ResizeObserver(()=>document.documentElement.style.setProperty('--chrome-height',`${chrome.offsetHeight}px`)).observe(chrome);
  window.addEventListener('resize',syncChrome);window.addEventListener('scroll',syncChrome,{passive:true});new MutationObserver(syncChrome).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open']});
  syncChrome();window.webkit?.messageHandlers?.mole?.postMessage({action:'desktopScreens'});window.webkit?.messageHandlers?.mole?.postMessage({action:'loginAtStartupState'});
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
