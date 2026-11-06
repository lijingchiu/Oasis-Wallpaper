// Wallpaper Engine compatibility uses only this package's isolated origin.
function installRuntime(){
 'use strict';let properties={},last={},lastListener=null,paused=false,fps=30,audio=null,audioTimer=0;
 const raf=requestAnimationFrame.bind(window),caf=cancelAnimationFrame.bind(window),frames=new Map();let next=0,pending=0,previous=0;
 const invoke=(fn,...args)=>{try{return fn?.(...args)}catch(error){setTimeout(()=>{throw error})}};
 function tick(time){pending=0;if(!paused&&!document.hidden&&time-previous>=1000/fps-.5){previous=time;const work=[...frames.values()];frames.clear();for(const fn of work)invoke(fn,time)}schedule()}
 function schedule(){if(frames.size&&!pending&&!paused&&!document.hidden)pending=raf(tick)}
 window.requestAnimationFrame=fn=>{const id=++next;frames.set(id,fn);schedule();return id};window.cancelAnimationFrame=id=>{frames.delete(id);if(!frames.size&&pending){caf(pending);pending=0}};
 function audioState(){clearInterval(audioTimer);audioTimer=0;if(audio&&!paused&&!document.hidden)audioTimer=setInterval(()=>invoke(audio,Array(128).fill(0)),1000/fps)}
 window.wallpaperRegisterAudioListener=fn=>{audio=typeof fn==='function'?fn:null;audioState()};
 // No system audio or media-session access is granted to downloaded pages.
 window.wallpaperRegisterMediaStatusListener=fn=>{if(typeof fn==='function')queueMicrotask(()=>invoke(fn,{enabled:false}))};
 for(const name of ['wallpaperRegisterMediaPropertiesListener','wallpaperRegisterMediaPlaybackListener','wallpaperRegisterMediaThumbnailListener','wallpaperRegisterMediaTimelineListener'])window[name]=()=>{};
 const match=location.pathname.match(/^\/[a-f0-9]{48}\/custom-[a-f0-9-]{36}\//),root=match?location.origin+match[0]:new URL('.',location.href).href;
 const directoryCache=new Map(),sentDirectories=new Map(),directoryVersions=new Map();function directory(key){const row=properties[key];if(!row||row.type!=='directory'||!row.value)return Promise.resolve([]);const identity=key+'\0'+row.value;if(!directoryCache.has(identity)){const url=new URL('_oasis/directory/'+encodeURIComponent(key),root),match=String(row.value).match(/^_oasis\/user\/[a-f0-9]{32}\/([a-f0-9]{32})(?:\/|$)/);url.searchParams.set('selection',match?.[1]||'none');directoryCache.set(identity,fetch(url).then(r=>r.ok?r.json():[]).catch(()=>[]))}return directoryCache.get(identity)}
 window.wallpaperRequestRandomFileForProperty=(key,callback)=>{if(typeof callback!=='function')return;directory(key).then(files=>invoke(callback,key,files.length?files[Math.floor(Math.random()*files.length)]:''))};
 function apply(){const listener=window.wallpaperPropertyListener;if(!listener||typeof listener.applyUserProperties!=='function'&&typeof listener.userDirectoryFilesAddedOrChanged!=='function')return;if(lastListener!==listener){last={};lastListener=listener;sentDirectories.clear();directoryVersions.clear();invoke(listener.setPaused?.bind(listener),paused)}const changed={};for(const [key,row] of Object.entries(properties)){const encoded=JSON.stringify(row);if(last[key]!==encoded){changed[key]=row;last[key]=encoded}}
  invoke(listener.applyGeneralProperties?.bind(listener),{fps});if(Object.keys(changed).length)invoke(listener.applyUserProperties?.bind(listener),changed);
  for(const [key,row] of Object.entries(changed))if(row.type==='directory'&&row.mode==='fetchall'){const version=(directoryVersions.get(key)||0)+1;directoryVersions.set(key,version);directory(key).then(files=>{if(lastListener!==listener||directoryVersions.get(key)!==version)return;const previous=sentDirectories.get(key)||[],removed=previous.filter(file=>!files.includes(file));if(removed.length)invoke(listener.userDirectoryFilesRemoved?.bind(listener),key,removed);sentDirectories.set(key,files);if(files.length)invoke(listener.userDirectoryFilesAddedOrChanged?.bind(listener),key,files)})}
 }
 window.addEventListener('message',event=>{if(event.source!==parent||!event.data||event.data.type!=='oasis-wallpaper-control')return;const body=event.data;
  if(Number.isFinite(body.fps)){const next=Math.max(5,Math.min(144,Math.round(body.fps)));if(fps!==next){fps=next;invoke(window.wallpaperPropertyListener?.applyGeneralProperties?.bind(window.wallpaperPropertyListener),{fps});audioState()}}
  if(body.properties&&typeof body.properties==='object'){properties=body.properties;apply()}
  if(typeof body.paused==='boolean'&&paused!==body.paused){paused=body.paused;invoke(window.wallpaperPropertyListener?.setPaused?.bind(window.wallpaperPropertyListener),paused);if(paused&&pending){caf(pending);pending=0}else schedule();audioState()}
  if(body.pointer&&Number.isFinite(body.pointer.x)&&Number.isFinite(body.pointer.y))window.dispatchEvent(new MouseEvent('mousemove',{clientX:body.pointer.x*innerWidth,clientY:body.pointer.y*innerHeight,bubbles:true}));
 });
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&pending){caf(pending);pending=0}else schedule();audioState()});
 for(const [mouse,pointer]of [['mousemove','pointermove'],['mousedown','pointerdown'],['mouseup','pointerup']])document.addEventListener(mouse,event=>{if(event.isTrusted||!window.PointerEvent)return;event.target.dispatchEvent(new PointerEvent(pointer,{bubbles:true,clientX:event.clientX,clientY:event.clientY,button:event.button,buttons:pointer==='pointerup'?0:event.buttons,pointerId:1,pointerType:'mouse',isPrimary:true}))},true);
 let listener=window.wallpaperPropertyListener;try{Object.defineProperty(window,'wallpaperPropertyListener',{configurable:true,get:()=>listener,set:value=>{listener=value;queueMicrotask(apply)}})}catch{}
 window.addEventListener('load',apply);
}
export const workshopRuntime='('+installRuntime.toString()+')();';
