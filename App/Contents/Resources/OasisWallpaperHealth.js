// Shared by native WKWebView and the isolated package server. No Oasis API bridge.
(()=>{'use strict';if(window.__oasisWallpaperHealth)return;window.__oasisWallpaperHealth=true;
 let done=false,drawn=new WeakSet(),loaded=0,failure=null,visibleSince=document.hidden?null:performance.now();
 let audioEnabled=false,volume=0,paused=false;const gains=new Map(),desiredVolume=new WeakMap(),desiredMuted=new WeakMap(),resumeMedia=new Set(),resumeContexts=new Set();let pauseStyle=null;
 // Hide recognizable wallpaper controls only in the App/Menu Bar background.
 // The original layout and the wallpaper's own styles remain intact so the
 // controls reappear when the user opens the interaction mode.
 let hideUI=window.__oasisHideWallpaperUI===true,uiStyle=null;
 function updateUI(){
  if(!hideUI){uiStyle?.remove();uiStyle=null;return}
  if(uiStyle||!document.documentElement)return;uiStyle=document.createElement('style');uiStyle.textContent='body .interface:not(:has(video,canvas,>img)),body :is(.wallpaper-ui,[data-wallpaper-ui],.settings-panel,.control-panel,.toolbar,.controls,.hud,nav):not(:has(video,canvas)):has(button,input,select,textarea,[role="button"],[role="slider"]),body :is(button,input,select,textarea,[role="button"],[role="slider"],[role="switch"],[contenteditable="true"]):not(:has(video,canvas)){visibility:hidden!important;pointer-events:none!important}';(document.head||document.documentElement).append(uiStyle);
 }
 if(document.documentElement)updateUI();else document.addEventListener('DOMContentLoaded',updateUI,{once:true});
 const volumeProperty=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'volume'),muteProperty=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'muted');
 const applyAudio=node=>{if(!(node instanceof HTMLMediaElement))return;if(!desiredVolume.has(node))desiredVolume.set(node,volumeProperty?.get?.call(node)??1);const wanted=desiredVolume.get(node);if(volumeProperty?.set)volumeProperty.set.call(node,audioEnabled?wanted*volume:0);else node.volume=audioEnabled?wanted*volume:0;if(muteProperty?.set)muteProperty.set.call(node,!audioEnabled||desiredMuted.get(node)===true);else node.muted=!audioEnabled||desiredMuted.get(node)===true};
 if(volumeProperty?.configurable&&volumeProperty.get&&volumeProperty.set)Object.defineProperty(HTMLMediaElement.prototype,'volume',{...volumeProperty,get(){return desiredVolume.has(this)?desiredVolume.get(this):volumeProperty.get.call(this)},set(value){volumeProperty.set.call(this,value);desiredVolume.set(this,value);applyAudio(this)}});
 if(muteProperty?.configurable&&muteProperty.get&&muteProperty.set)Object.defineProperty(HTMLMediaElement.prototype,'muted',{...muteProperty,get(){return desiredMuted.has(this)?desiredMuted.get(this):muteProperty.get.call(this)},set(value){desiredMuted.set(this,!!value);applyAudio(this)}});
 const play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){applyAudio(this);if(paused){resumeMedia.add(this);return Promise.resolve()}return play.apply(this,arguments)};
 document.addEventListener('loadstart',event=>applyAudio(event.target),true);
 const connect=window.AudioNode?.prototype.connect;if(connect)AudioNode.prototype.connect=function(destination,...args){if(destination instanceof AudioDestinationNode){let gain=gains.get(this.context);if(!gain){gain=this.context.createGain();gain.gain.value=audioEnabled?volume:0;connect.call(gain,destination);gains.set(this.context,gain)}destination=gain}return connect.call(this,destination,...args)};
 window.addEventListener('message',event=>{const data=event.data;if(event.source!==parent||!data||data.type!=='oasis-wallpaper-control')return;
  if(typeof data.hideUI==='boolean'&&hideUI!==data.hideUI){hideUI=data.hideUI;updateUI()}
  if(typeof data.audio==='boolean'){audioEnabled=data.audio;volume=Math.max(0,Math.min(1,Number(data.volume)/100||0));for(const node of document.querySelectorAll('video,audio'))applyAudio(node);for(const [context,gain]of gains){gain.gain.value=audioEnabled?volume:0;if(audioEnabled&&!paused&&context.state==='suspended')context.resume().catch(()=>{})}}
  if(typeof data.paused==='boolean'&&paused!==data.paused){paused=data.paused;if(paused){for(const node of document.querySelectorAll('video,audio'))if(!node.paused){resumeMedia.add(node);node.pause()}for(const [context]of gains)if(context.state==='running'){resumeContexts.add(context);context.suspend().catch(()=>{})}pauseStyle=document.createElement('style');pauseStyle.textContent='*,*::before,*::after{animation-play-state:paused!important;transition:none!important}';document.documentElement?.append(pauseStyle)}else{pauseStyle?.remove();pauseStyle=null;for(const node of resumeMedia){applyAudio(node);play.call(node).catch(()=>{})}resumeMedia.clear();for(const context of resumeContexts)context.resume().catch(()=>{});resumeContexts.clear()}}
 });
 const report=(ready,reason)=>{if(done)return;done=true;clearInterval(timer);clearTimeout(watchdog);const value={ready,...(reason?{reason}:{})};window.webkit?.messageHandlers?.oasisWallpaperReady?.postMessage(value);parent.postMessage({type:ready?'oasis-wallpaper-ready':'oasis-wallpaper-error',reason},'*')};
 for(const name of ['WebGLRenderingContext','WebGL2RenderingContext','CanvasRenderingContext2D']){const type=window[name];if(!type)continue;for(const key of name==='CanvasRenderingContext2D'?['drawImage','putImageData','fillRect','fillText','stroke']:['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced']){const original=type.prototype[key];if(!original)continue;type.prototype[key]=function(...args){const result=original.apply(this,args);if(this.canvas)drawn.add(this.canvas);return result}}}
 window.addEventListener('error',event=>{
  const target=event.target;
  // Wallpaper authors sometimes leave an optional <source src=""> in the
  // page. WebKit emits an error for it even when another renderer is valid.
  if(target?.tagName==='SOURCE'&&!target.getAttribute('src')?.trim()&&!target.getAttribute('srcset')?.trim())return;
  failure=target instanceof HTMLMediaElement?'web-media':event.error?'web-script':'web-resource';
 },true);
 window.addEventListener('unhandledrejection',()=>{failure='web-script'});
 const visible=node=>{const r=node.getBoundingClientRect();return r.width>1&&r.height>1&&getComputedStyle(node).visibility!=='hidden'};
 function inspect(){if(done||!loaded||performance.now()-loaded<150)return;
  const videos=[...document.querySelectorAll('video')].filter(visible),canvases=[...document.querySelectorAll('canvas')].filter(visible),images=[...document.images].filter(visible);
  if(videos.some(v=>v.readyState>=2&&v.videoWidth>0&&!v.error)||canvases.some(canvas=>drawn.has(canvas))||!videos.length&&!canvases.length&&(images.some(i=>i.complete&&i.naturalWidth>0)||!failure&&images.length===0)){report(true);return}
  if(failure&&performance.now()-loaded>(failure==='web-resource'?10000:2000))report(false,failure);
 }
 window.addEventListener('load',()=>{loaded=performance.now();for(const node of document.querySelectorAll('video,audio'))applyAudio(node);inspect()});
 // WebKit may suspend rendering while the Oasis window is hidden or occluded.
 // Give the wallpaper its full startup window after it becomes visible again.
 document.addEventListener('visibilitychange',()=>{visibleSince=document.hidden?null:performance.now();if(visibleSince!==null&&loaded){loaded=visibleSince;inspect()}});
 const timer=setInterval(inspect,100);let watchdog=setTimeout(checkWatchdog,90000);
 function checkWatchdog(){
  if(done)return;
  if(document.hidden){watchdog=setTimeout(checkWatchdog,1000);return}
  if(visibleSince===null)visibleSince=performance.now();
  const remaining=90000-(performance.now()-visibleSince);
  if(remaining>0){watchdog=setTimeout(checkWatchdog,remaining);return}
  report(false,failure||'web-render-timeout');
 }
})();
