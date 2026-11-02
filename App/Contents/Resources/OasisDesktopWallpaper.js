// A trusted, click-through host. Downloaded Web wallpapers remain on their
// isolated origin and never receive the Oasis application bridge.
(()=>{'use strict';let scene=null,paused=false,last='',busy=false;
 const screen=String(window.oasisDesktopScreen||'');
 function render(state){
  const desktop=state.settings?.desktop||{},selection=desktop.screens?.[screen]||'follow',id=selection==='follow'?state.settings.background:selection,row=state.customImages?.find(x=>x.id===id),unavailable=!!row?.workshopID&&row.cached===false;
  window.OasisWeatherLandscapes?.registerCustom((state.customImages||[]).map(x=>({...x,revision:0,properties:x.desktopProperties?.[screen]||x.desktopDefaultProperties||x.properties,...(x.id===id?{archived:false}:{})})));window.OasisWeatherLandscapes?.registerCity(state.cityScene?.photo);
  const scenic=window.OasisWeatherLandscapes?.conditions[id],current=scenic||state.forecast?.current,key=row?.workshopID?'workshop-'+row.workshopID:id;
  const adjusted={x:0,y:0,scale:100,brightness:100,saturation:100,hue:0,audio:true,volume:100,...(state.settings.wallpaperDesktop?.[screen]?.[key]??state.settings.wallpaperDesktopBase?.[key])},appearance={...adjusted,audio:desktop.audio===true&&adjusted.audio!==false,volume:(desktop.volume??50)*(adjusted.volume??100)/100};
  const signature=JSON.stringify([id,row?.properties,state.forecast?.fetchedAt,state.cityScene?.photo?.id,desktop.enabled,desktop.fps,appearance]);
  if(signature!==last){last=signature;scene.set(current,{...state.settings,background:id,desktopMode:true,desktopFPS:desktop.fps||30,enabled:desktop.enabled===true&&id!=='off'&&!unavailable,intensity:100,wallpaperDisplay:appearance});scene.setVisible(!paused)}
 }
 async function refresh(){if(busy)return;busy=true;try{const response=await fetch('/api/weather',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'snapshot'}),signal:AbortSignal.timeout(10000)});if(response.ok)render(await response.json())}catch{}finally{busy=false}}
 window.OasisWeather={refresh};window.oasisDesktopDiagnostics=()=>scene?.diagnostics()||null;window.oasisDesktopSetPaused=value=>{paused=!!value;scene?.setVisible(!paused)};
 window.oasisDesktopPointer=(x,y)=>{if(!Number.isFinite(x)||!Number.isFinite(y))return;window.dispatchEvent(new MouseEvent('pointermove',{clientX:x*innerWidth,clientY:y*innerHeight,bubbles:true}))};
 function start(){scene=new window.OasisWeatherScene();refresh();setInterval(refresh,2000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()})}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
