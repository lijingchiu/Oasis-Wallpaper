/* Shared forecast store. All times are Unix seconds; formatting belongs to the
   selected location's IANA time zone, never to the Mac's current time zone. */
import {readFile, writeFile, mkdir, rename} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createWorkshopPackages,workshopProject} from './OasisWorkshopPackages.mjs';
import {createWallpaperFiles} from './OasisWallpaperFiles.mjs';
import {createCityScenery} from './OasisCityScenery.mjs';
import {backgroundScenes,createWeatherImages,validateCustomImages,normalizeSceneryEffects,validCustomID} from './OasisWeatherImages.mjs';
export {backgroundScenes};

const FRESH=15*60*1000, MAX_STALE=72*60*60*1000;
const desktopDefaults={enabled:false,fps:30,ac:'play',battery:'pause',focused:'play',maximized:'pause',fullscreen:'pause',sleep:'pause',otherAudio:'ignore',audio:false,volume:50,screens:{}};
const defaults={enabled:true,intensity:45,unit:'celsius',background:'live',effects:{},wallpaper:{},wallpaperMenu:{},wallpaperDesktopBase:{},wallpaperDesktop:{},desktop:desktopDefaults,location:null};
const wallpaperDefaults={x:0,y:0,scale:100,brightness:100,saturation:100,hue:0,audio:false,volume:50};
const wallpaperLimits={x:[-100,100],y:[-100,100],scale:[50,200],brightness:[0,200],saturation:[0,200],hue:[-180,180],volume:[0,100]};
function wallpaperKey(id,rows){const row=rows.find(x=>x.id===id);return row?.workshopID?'workshop-'+row.workshopID:id}
export function normalizeDesktop(value,rows=[]){
 const v=value&&typeof value==='object'&&!Array.isArray(value)?value:{},out={...desktopDefaults,screens:{}};
 if(typeof v.enabled==='boolean')out.enabled=v.enabled;if(typeof v.audio==='boolean')out.audio=v.audio;
 if(Number.isFinite(v.fps))out.fps=Math.round(Math.max(5,Math.min(144,v.fps)));if(Number.isFinite(v.volume))out.volume=Math.round(Math.max(0,Math.min(100,v.volume)));
 for(const key of ['ac','battery','focused','maximized','fullscreen','sleep'])if(['play','pause','stop'].includes(v[key]))out[key]=v[key];
 if(['ignore','mute'].includes(v.otherAudio))out.otherAudio=v.otherAudio;
 const allowed=new Set(['follow','off',...backgroundScenes,...rows.map(x=>x.id)]);for(const [screen,background] of Object.entries(v.screens&&typeof v.screens==='object'&&!Array.isArray(v.screens)?v.screens:{}).slice(0,32))if(validScreen(screen)&&allowed.has(background))out.screens[screen]=background;
 return out;
}
function normalizeWallpaper(value,rows){
 const keys=new Set([...backgroundScenes,...rows.map(row=>wallpaperKey(row.id,rows))]),result={};
 if(!value||typeof value!=='object'||Array.isArray(value))return result;
 for(const [id,raw] of Object.entries(value)){if(!keys.has(id)||!raw||typeof raw!=='object'||Array.isArray(raw))continue;
  const entry={};for(const [key,[min,max]] of Object.entries(wallpaperLimits))if(Number.isFinite(raw[key]))entry[key]=Math.max(min,Math.min(max,raw[key]));
  if(typeof raw.audio==='boolean')entry.audio=raw.audio;
  if(raw.properties&&typeof raw.properties==='object'&&!Array.isArray(raw.properties))entry.properties=Object.fromEntries(Object.entries(raw.properties).filter(([k,v])=>k.length<=128&&(['boolean','number'].includes(typeof v)&&!(typeof v==='number'&&!Number.isFinite(v))||typeof v==='string'&&v.length<=1024)).slice(0,1024));
  result[id]=entry;
 }return result;
}
const validScreen=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(value)&&!['__proto__','prototype','constructor'].includes(value);
function normalizeDesktopWallpapers(value,rows){
 const result={};if(!value||typeof value!=='object'||Array.isArray(value))return result;
 for(const [screen,wallpapers] of Object.entries(value).slice(0,32))if(validScreen(screen))result[screen]=normalizeWallpaper(wallpapers,rows);
 return result;
}
function desktopMigration(value,rows){const result=normalizeWallpaper(value,rows);for(const entry of Object.values(result)){delete entry.audio;delete entry.volume}return result}
const finite=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const text=v=>String(v??'').replace(/[\u0000-\u001f]/g,'').trim().slice(0,120);
export function condition(code){
 if(code===0)return 'clear';if(code===1||code===2)return 'partly';if(code===3)return 'cloudy';
 if([45,48].includes(code))return 'fog';if([71,73,75,77,85,86].includes(code))return 'snow';
 if([95,96,99].includes(code))return 'storm';if([51,53,55,56,57,61,63,65,66,67,80,81,82].includes(code))return 'rain';
 return 'unknown';
}
export function validateLocation(value){
 const latitude=finite(value?.latitude),longitude=finite(value?.longitude);
 if(latitude===null||longitude===null||latitude< -90||latitude>90||longitude< -180||longitude>180)throw Error('invalid-location');
 return{latitude:Math.round(latitude*1000)/1000,longitude:Math.round(longitude*1000)/1000,name:text(value.name)||'目前位置',region:text(value.region),country:text(value.country),mode:value.mode==='current'?'current':'city'};
}
const key=l=>l?`${l.latitude},${l.longitude}`:'';
function validCachedForecast(value,location,now){
 if(!value||!location||key(value.location)!==key(location)||finite(value.fetchedAt)===null||value.fetchedAt>now+60000)return false;
 try{new Intl.DateTimeFormat('en',{timeZone:value.timezone})}catch{return false}
 const current=value.current;
 if(!current||finite(current.time)===null||finite(current.temperature)===null||typeof current.isDay!=='boolean')return false;
 if(!['feelsLike','code','humidity','precipitation','wind','windDirection','gusts','pressure','cloudCover','visibility','uv'].every(k=>current[k]===null||finite(current[k])!==null))return false;
 return Array.isArray(value.hourly)&&value.hourly.length>=12&&value.hourly.length<=1000&&value.hourly.every(row=>row&&finite(row.time)!==null&&finite(row.temperature)!==null)
  &&Array.isArray(value.daily)&&value.daily.length>=2&&value.daily.length<=10&&value.daily.every(row=>row&&finite(row.time)!==null&&finite(row.high)!==null&&finite(row.low)!==null);
}
export function normalizeForecast(raw,location,now=Date.now()){
 const c=raw?.current,h=raw?.hourly,d=raw?.daily;
 if(!c||finite(c.time)===null||finite(c.temperature_2m)===null||!Array.isArray(h?.time)||!Array.isArray(d?.time))throw Error('invalid-forecast');
 let timezone=raw.timezone||'UTC';try{new Intl.DateTimeFormat('en',{timeZone:timezone})}catch{timezone='UTC'}
 const hourly=h.time.map((time,i)=>({time:finite(time),temperature:finite(h.temperature_2m?.[i]),feelsLike:finite(h.apparent_temperature?.[i]),code:finite(h.weather_code?.[i]),probability:finite(h.precipitation_probability?.[i]),precipitation:finite(h.precipitation?.[i]),wind:finite(h.wind_speed_10m?.[i]),humidity:finite(h.relative_humidity_2m?.[i]),visibility:finite(h.visibility?.[i]),uv:finite(h.uv_index?.[i]),isDay:h.is_day?.[i]===1})).filter(x=>x.time!==null&&x.temperature!==null);
 const daily=d.time.map((time,i)=>({time:finite(time),code:finite(d.weather_code?.[i]),high:finite(d.temperature_2m_max?.[i]),low:finite(d.temperature_2m_min?.[i]),sunrise:finite(d.sunrise?.[i]),sunset:finite(d.sunset?.[i]),uv:finite(d.uv_index_max?.[i]),probability:finite(d.precipitation_probability_max?.[i]),precipitation:finite(d.precipitation_sum?.[i]),wind:finite(d.wind_speed_10m_max?.[i])})).filter(x=>x.time!==null&&x.high!==null&&x.low!==null).slice(0,10);
 if(hourly.length<12||daily.length<2)throw Error('incomplete-forecast');
 const nearest=hourly.reduce((a,b)=>Math.abs(b.time-c.time)<Math.abs(a.time-c.time)?b:a,hourly[0]);
 return{location,timezone,fetchedAt:now,current:{time:c.time,temperature:c.temperature_2m,feelsLike:finite(c.apparent_temperature),code:finite(c.weather_code),scene:condition(c.weather_code),isDay:c.is_day===1,humidity:finite(c.relative_humidity_2m),precipitation:finite(c.precipitation),wind:finite(c.wind_speed_10m),windDirection:finite(c.wind_direction_10m),gusts:finite(c.wind_gusts_10m),pressure:finite(c.surface_pressure),cloudCover:finite(c.cloud_cover),visibility:nearest.visibility,uv:nearest.uv},hourly,daily,source:{name:'Open-Meteo',url:'https://open-meteo.com/',license:'CC BY 4.0'}};
}
export function forecastURL(location,{apiKey=process.env.OASIS_WEATHER_API_KEY}={}){
 const u=new URL(apiKey?'https://customer-api.open-meteo.com/v1/forecast':'https://api.open-meteo.com/v1/forecast');
 const params={latitude:location.latitude,longitude:location.longitude,timezone:'auto',timeformat:'unixtime',forecast_days:10,
 current:'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m',
 hourly:'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,precipitation,weather_code,visibility,wind_speed_10m,uv_index,is_day',
 daily:'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_sum,precipitation_probability_max,wind_speed_10m_max'};
 if(apiKey)params.apikey=apiKey;for(const [k,v] of Object.entries(params))u.searchParams.set(k,String(v));return u;
}
export function citySearchNames(query){
 const name=text(query),[place,...qualifier]=name.split(/[,，]/),normalized=place.trim().replace(/臺/g,'台');
 // Two characters require an exact provider match. City suffixes therefore
 // need one bounded retry (台北 → 台北市); preserve the user's region qualifier.
 const expanded=/^\p{Script=Han}{2}$/u.test(normalized)?normalized+'市':normalized;
 const fallback=[expanded,...qualifier.map(x=>x.trim())].join(', ');
 return [...new Set([name,fallback])];
}
export function createWeather({path,fetchImpl=globalThis.fetch,now=Date.now,mediaProcessor,desktopHostEnabled=true}={}){
 const images=createWeatherImages(path,{mediaProcessor}),cityScenery=createCityScenery({path,fetchImpl,now}),userFiles=createWallpaperFiles(path);let customImages=[],importing=false,scenePending=null,stagingWallpaperID=null,nativeWebHostAt=0;const packages=path?createWorkshopPackages({settingsPath:path,images,fetchImpl,userFiles}):null;packages?.setRecords(()=>customImages);
 let wallpaperIssue=null,wallpaperRevision=0,assetRevision=0,detectedScreensKnown=false;const knownScreens=new Set();let settings={...defaults,effects:{},wallpaper:{},wallpaperMenu:{},wallpaperDesktopBase:{},wallpaperDesktop:{},desktop:normalizeDesktop()},cached=null,loaded=false,loading=null,pending=null,retryAfter=0,writeQueue=Promise.resolve();
 async function load(){if(loaded)return;if(loading)return loading;loading=(async()=>{try{const saved=JSON.parse(await readFile(path,'utf8'));customImages=validateCustomImages(saved.customImages);const legacy=normalizeWallpaper(saved.settings?.wallpaper,customImages);settings={...defaults,enabled:saved.settings?.enabled!==false,intensity:Math.max(10,Math.min(80,finite(saved.settings?.intensity)??45)),unit:saved.settings?.unit==='fahrenheit'?'fahrenheit':'celsius',background:backgroundScenes.includes(saved.settings?.background)||customImages.some(x=>x.id===saved.settings?.background&&!x.archived)?saved.settings.background:'live',effects:normalizeSceneryEffects(saved.settings?.effects,customImages),wallpaper:legacy,wallpaperMenu:normalizeWallpaper(saved.settings?.wallpaperMenu??legacy,customImages),wallpaperDesktopBase:saved.settings?.wallpaperDesktopBase===undefined?desktopMigration(legacy,customImages):normalizeWallpaper(saved.settings.wallpaperDesktopBase,customImages),wallpaperDesktop:normalizeDesktopWallpapers(saved.settings?.wallpaperDesktop,customImages),desktop:normalizeDesktop(saved.settings?.desktop,customImages),location:saved.settings?.location?validateLocation(saved.settings.location):null};if(validCachedForecast(saved.forecast,settings.location,now())){cached=saved.forecast;cached.location={...settings.location};cached.current.scene=condition(cached.current.code)}}catch{}await userFiles.load();await cityScenery.load();await auditCaches();await evictInactive();if(customImages.some(x=>x.mediaType==='web'&&x.cached!==false))await packages?.start();loaded=true})();return loading}
 function target(value={}){const surface=value.surface??'app',screen=value.screen??'';if(!['app','menu','desktop'].includes(surface)||surface==='desktop'&&!validScreen(screen))throw Error('wallpaper-scope');return{surface,screen:surface==='desktop'?screen:''}}
 function selection(screen){const value=settings.desktop.screens[screen]||'follow';return value==='follow'?settings.background:value}
 function scopeName(surface,screen){return surface==='desktop'?'desktop:'+(screen||'base'):surface}
 function wallpaper(id,surface='app',screen=''){const key=wallpaperKey(id,customImages),entry=surface==='menu'?settings.wallpaperMenu[key]:surface==='desktop'?(settings.wallpaperDesktop[screen]?.[key]??settings.wallpaperDesktopBase[key]):settings.wallpaper[key];return {...wallpaperDefaults,...(surface==='desktop'?{audio:true,volume:100}:{}),...entry}}
 function writeWallpaper(id,scope,patch){const key=wallpaperKey(id,customImages),{surface,screen}=scope;if(surface==='desktop'){if(!settings.wallpaperDesktop[screen]&&Object.keys(settings.wallpaperDesktop).length>=32)throw Error('wallpaper-scope');const old=settings.wallpaperDesktop[screen]||{},entry=old[key]??settings.wallpaperDesktopBase[key]??{};settings.wallpaperDesktop[screen]=normalizeWallpaper({...old,[key]:{...entry,...patch}},customImages);knownScreens.add(screen)}else{const name=surface==='menu'?'wallpaperMenu':'wallpaper';settings[name]=normalizeWallpaper({...settings[name],[key]:{...settings[name][key],...patch}},customImages)}}
 function properties(row,{native=false,surface='app',screen=''}={}){const values=wallpaper(row.id,surface,screen).properties||{},scope=scopeName(surface,screen);return Object.fromEntries(Object.entries(row.properties||{}).map(([key,value])=>[key,userFiles.property(row,key,{...value,...(Object.hasOwn(values,key)?{value:values[key]}:{})},{native,scope})]))}
 function sceneDisplay(row,surface='app',screen=''){const value=wallpaper(row.id,surface,screen),overrides={...value.properties},scope=scopeName(surface,screen);for(const [key,definition] of Object.entries(row.properties||{})){if(!['texture','scenetexture'].includes(definition.type))continue;const selected=userFiles.property(row,key,definition,{native:true,scope});if(selected!==definition)overrides[key]=selected.value}return {...value,properties:overrides}}
 async function save(){if(!path)return;const value=JSON.stringify({settings,forecast:cached,customImages:customImages.filter(x=>x.id!==stagingWallpaperID)});writeQueue=writeQueue.catch(()=>{}).then(async()=>{await mkdir(dirname(path),{recursive:true});const tmp=path+'.'+randomUUID()+'.tmp';await writeFile(tmp,value,{mode:0o600});await rename(tmp,path)});await writeQueue}
 async function json(url,signal=AbortSignal.timeout(12000)){const response=await fetchImpl(url,{signal,headers:{Accept:'application/json','User-Agent':'Oasis-Weather/1.0'}});if(!response.ok)throw Error(response.status===429?'rate-limit':'unavailable');return response.json()}
 function snapshot(error=null,{prepareCity=true}={}){if(prepareCity&&(settings.enabled&&settings.background==='city'||settings.desktop.enabled&&Object.values(settings.desktop.screens).includes('city')))void cityScenery.ensure(settings.location);const forecast=cached&&now()-cached.fetchedAt<MAX_STALE?cached:null,screens=new Set([...Object.keys(settings.desktop.screens),...knownScreens]);return{ok:true,wallpaperRevision,settings:structuredClone(settings),customImages:customImages.filter(x=>x.id!==stagingWallpaperID).map(x=>({...x,revision:wallpaperRevision,...(['web','scene'].includes(x.mediaType)?{properties:properties(x),menuProperties:properties(x,{surface:'menu'}),desktopDefaultProperties:properties(x,{surface:'desktop'}),desktopProperties:Object.fromEntries([...screens].filter(screen=>selection(screen)===x.id).map(screen=>[screen,properties(x,{surface:'desktop',screen})]))}:{}),...(x.mediaType==='web'?{webURL:packages?.url(x)}:{})})),cityScene:settings.enabled||settings.desktop.enabled?cityScenery.view(settings.location):{...cityScenery.view(settings.location),status:'disabled'},...(wallpaperIssue?{wallpaperIssue}:{}),forecast,stale:!!forecast&&now()-forecast.fetchedAt>=FRESH,error,needsLocation:!settings.location}}
 // Widget backgrounds mirror the already selected App scene. Reading this
 // metadata must not refresh a forecast, pick another photo, or start a search.
 async function presentationSnapshot(){await load();return snapshot(null,{prepareCity:false})}
 async function refresh(force=false){
  if(!settings.location)return snapshot();
  if(cached&&key(cached.location)===key(settings.location)&&now()-cached.fetchedAt<FRESH&&!force)return snapshot();
  if(pending&&pending.key===key(settings.location))return pending.promise;
  if(now()<retryAfter)return snapshot('unavailable');
  const location={...settings.location},requestKey=key(location);
  const promise=(async()=>{try{const raw=await json(forecastURL(location));const result=normalizeForecast(raw,location,now());if(key(settings.location)===requestKey){cached=result;retryAfter=0;await save()}return snapshot()}catch(e){if(key(settings.location)===requestKey)retryAfter=now()+60000;return snapshot(e.message==='rate-limit'?'rate-limit':'unavailable')}finally{if(pending?.key===requestKey)pending=null}})();pending={key:requestKey,promise};return promise;
 }
 async function auditCaches(){
  let changed=false;for(const row of customImages){if(!row.workshopID||row.cached===false)continue;const exists=['web','scene'].includes(row.mediaType)?await packages.cached(row):await images.cached(row.id);if(!exists){row.cached=false;changed=true;if(settings.background===row.id){settings.background='live';wallpaperIssue='cache-missing'}}}if(changed)await save();
 }
 async function evictInactive(){
  const retained=new Set([settings.background,stagingWallpaperID,...Object.values(settings.desktop.screens)]);let changed=false;for(const row of customImages){if(!row.workshopID||retained.has(row.id))continue;await images.evict(row.id);if(['web','scene'].includes(row.mediaType))await packages?.evict(row.id);if(row.cached!==false){row.cached=false;changed=true}}
  if(changed)await save();
 }
 function replaceDesktopBackground(oldID,newID){if(!oldID)return;for(const [screen,id] of Object.entries(settings.desktop.screens))if(id===oldID)settings.desktop.screens[screen]=newID}
 function importTargetAvailable(target){return !target||((settings.desktop.screens[target.screen]||'follow')===target.expected&&(typeof target.expectedEnabled!=='boolean'||settings.desktop.enabled===target.expectedEnabled))}
 function assignImported(row,existing,target){
  if(!importTargetAvailable(target))throw Error('workshop-selection-changed');
  if(existing?.id===settings.background)settings.background=row.id;
  replaceDesktopBackground(existing?.id,row.id);
  if(target){if(target.enable===true&&!settings.desktop.enabled){for(const screen of new Set([...knownScreens,...(target.displays||[])]))if(!Object.hasOwn(settings.desktop.screens,screen))settings.desktop.screens[screen]='off'}settings.desktop.screens[target.screen]=row.id;if(target.enable===true)settings.desktop.enabled=true}else settings.background=row.id;
 }
 async function action(body={}){
  await load();
  if(body.action==='search'){
   const query=text(body.query);if(query.length<2)return{ok:true,results:[]};
   const u=new URL('https://geocoding-api.open-meteo.com/v1/search');u.searchParams.set('count','8');u.searchParams.set('language',body.language==='ja'?'ja':body.language==='en'?'en':'zh');
   const signal=AbortSignal.timeout(12000);let rows=[];
   for(const name of citySearchNames(query)){u.searchParams.set('name',name);const data=await json(u,signal);rows=data.results||[];if(rows.length)break}
   return{ok:true,results:rows.map(x=>validateLocation({latitude:x.latitude,longitude:x.longitude,name:x.name,region:x.admin1,country:x.country,mode:'city'}))};
  }
  if(body.action==='location'){
   const location=validateLocation(body.location);if(body.onlyIfCurrent&&settings.location?.mode==='city')return snapshot();
   const changed=key(location)!==key(settings.location);settings.location=location;if(changed){cached=null;retryAfter=0}else if(cached)cached.location=location;await save();return refresh(changed);
  }
  if(body.action==='settings'){
   if(importing&&body.settings&&'background' in body.settings)throw Error('image-busy');
   const input=body.settings||{};if(typeof input.enabled==='boolean')settings.enabled=input.enabled;
   if(finite(input.intensity)!==null)settings.intensity=Math.round(Math.min(80,Math.max(10,input.intensity)));
   if(['celsius','fahrenheit'].includes(input.unit))settings.unit=input.unit;
   const chosen=customImages.find(x=>x.id===input.background&&!x.archived);if(chosen?.workshopID&&(!chosen.cached||chosen.mediaType==='video'&&!await images.cached(chosen.id)))throw Error('image-not-cached');if(backgroundScenes.includes(input.background)||chosen){settings.background=input.background;wallpaperIssue=null;wallpaperRevision++;}
   if(body.sceneEffect){const {id,...effect}=body.sceneEffect;if(backgroundScenes.includes(id)||customImages.some(x=>x.id===id&&!x.archived))settings.effects=normalizeSceneryEffects({...settings.effects,[id]:{...(settings.effects[id]||{}),...effect}},customImages)}
   if(body.wallpaper&&(backgroundScenes.includes(body.wallpaper.id)||customImages.some(x=>x.id===body.wallpaper.id))){const change=body.wallpaper,scope=target(change);if(scope.surface==='desktop'&&selection(scope.screen)!==change.id)throw Error('wallpaper-selection-changed');writeWallpaper(change.id,scope,Object.fromEntries(Object.keys(wallpaperDefaults).filter(k=>Object.hasOwn(change,k)).map(k=>[k,change[k]])))}
   if(body.desktop&&typeof body.desktop==='object'&&!Array.isArray(body.desktop))settings.desktop=normalizeDesktop({...settings.desktop,...body.desktop,...(body.desktop.screens?{screens:{...settings.desktop.screens,...body.desktop.screens}}:{})},customImages);
   if(body.wallpaperProperty){const change=body.wallpaperProperty,scope=target(change),chosen=scope.surface==='desktop'?selection(scope.screen):settings.background,row=customImages.find(x=>x.id===chosen&&x.id===change.id),definition=row?.properties?.[change.key];let v=change.value,valid=false;
    if(definition&&['bool','boolean'].includes(definition.type)&&typeof v==='boolean')valid=true;
    else if(definition?.type==='slider'&&typeof v==='number'&&Number.isFinite(v)){v=Math.max(Number.isFinite(definition.min)?definition.min:-10000,Math.min(Number.isFinite(definition.max)?definition.max:10000,v));valid=true}
    else if(definition?.type==='combo'&&definition.options?.some(o=>o.value===v))valid=true;
    else if(['color','textinput','usershortcut'].includes(definition?.type)&&typeof v==='string'&&v.length<=1024)valid=true;
    if(valid){const existing=wallpaper(row.id,scope.surface,scope.screen);writeWallpaper(row.id,scope,{properties:{...existing.properties,[change.key]:v}});assetRevision++}
   }
   await save();await evictInactive();return snapshot();
  }
  if(body.action==='backgroundFailure'){const row=customImages.find(x=>x.id===body.id&&x.id===settings.background&&(body.revision===undefined||body.revision===wallpaperRevision));if(row&&['video','gif','web','scene'].includes(row.mediaType)){settings.background='live';wallpaperIssue='runtime-failed';wallpaperRevision++;await save()}return snapshot()}
  if(body.action==='shuffleCity'){if(settings.background==='city'&&settings.enabled)void cityScenery.ensure(settings.location,{shuffle:true});return snapshot()}
  if(body.action==='archiveImage'||body.action==='restoreImage'){
   if(importing)throw Error('image-busy');
   const row=customImages.find(x=>x.id===body.id);if(!row)throw Error('image-not-found');row.archived=body.action==='archiveImage';if(row.archived&&settings.background===row.id)settings.background='live';await save();await evictInactive();return snapshot();
  }
  if(body.action==='deleteImage'){
   if(importing)throw Error('image-busy');
   const row=customImages.find(x=>x.id===body.id);if(!row)throw Error('image-not-found');
   const previous=customImages,background=settings.background,effects=settings.effects,desktop=settings.desktop;
   customImages=customImages.filter(x=>x.id!==row.id);if(settings.background===row.id)settings.background='live';
   settings.desktop=normalizeDesktop(settings.desktop,customImages);
   settings.effects=normalizeSceneryEffects(settings.effects,customImages);
   try{await save()}catch(error){customImages=previous;settings.background=background;settings.effects=effects;settings.desktop=desktop;throw error}
   await images.discard(row.id);await packages?.evict(row.id);return snapshot();
  }
  if(body.action==='snapshot'||!body.action)return refresh();
  if(body.action==='refresh')return refresh(true);
  throw Error('unknown-action');
 }
 async function importImage(buffer,name,{desktopTarget=null}={}){
  await load();if(importing)throw Error('image-busy');importing=true;
  try{if(customImages.length>=40)throw Error('image-limit');const row=await images.importImage(buffer,name),previous=settings.background,previousDesktop=structuredClone(settings.desktop);if(!importTargetAvailable(desktopTarget)){await images.discard(row.id).catch(()=>{});throw Error('workshop-selection-changed')}customImages.push(row);assignImported(row,null,desktopTarget);try{await save()}catch(error){customImages=customImages.filter(x=>x.id!==row.id);settings.background=previous;settings.desktop=previousDesktop;await images.discard(row.id).catch(()=>{});throw error}await evictInactive();return snapshot()}finally{importing=false}
 }
 async function importVideoFile(file,name,workshop=null,{desktopTarget=null}={}){
  await load();if(importing)throw Error('image-busy');importing=true;
  let result;
  try{
   const previousRows=customImages,previousBackground=settings.background;
   const existing=workshop?customImages.find(x=>x.workshopID===workshop.id):null;
   if(customImages.length>=40&&!existing)throw Error('image-limit');
   result=await images.importVideoFile(file,name,{replace:!!existing});
   if(workshop)Object.assign(result,{workshopID:workshop.id,sourceBytes:workshop.size,cached:true});
   if(!importTargetAvailable(desktopTarget)){await images.discard(result.id).catch(()=>{});throw Error('workshop-selection-changed')}
   const previousDesktop=structuredClone(settings.desktop);
   customImages=[...customImages.filter(x=>x.id!==existing?.id),result];assignImported(result,existing,desktopTarget);
   try{await save()}catch(error){customImages=previousRows;settings.background=previousBackground;settings.desktop=previousDesktop;await images.discard(result.id).catch(()=>{});throw error}
   if(existing)await images.discard(existing.id).catch(()=>{});await evictInactive();return snapshot();
  }finally{importing=false}
 }
 async function importWorkshop(folder,name,item,{desktopTarget=null}={}){
  const project=await workshopProject(folder);
  if(project.type==='video'){
   return importVideoFile(join(folder,project.file),name,item,{desktopTarget});
  }
  await load();if(importing)throw Error('image-busy');importing=true;let row,previousDesktop=null,previousRows=null,previousBackground=null,assigned=false;
  try{
   const existing=item.id?customImages.find(x=>x.workshopID===item.id):null;if(customImages.length>=40&&!existing)throw Error('image-limit');
   row=await packages.prepare(folder,item,{replace:!!existing});
   if(row.mediaType==='web')await packages.start();
   stagingWallpaperID=row.id;customImages=[...customImages,row];
   if(row.mediaType==='scene'||row.mediaType==='web'&&Date.now()-nativeWebHostAt<10000){
    await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{if(scenePending?.id===row.id)scenePending=null;reject(Error('workshop-scene-timeout'))},120000);scenePending={id:row.id,desktopTarget,resolve:()=>{clearTimeout(timeout);resolve()},reject:error=>{clearTimeout(timeout);reject(error)}}});
   }
   if(!importTargetAvailable(desktopTarget))throw Error('workshop-selection-changed');previousDesktop=structuredClone(settings.desktop);previousRows=customImages.filter(x=>x.id!==row.id);previousBackground=settings.background;assignImported(row,existing,desktopTarget);assigned=true;wallpaperIssue=null;customImages=customImages.filter(x=>x.id!==existing?.id);stagingWallpaperID=null;await save();
   if(existing){await images.discard(existing.id).catch(()=>{});await packages.evict(existing.id).catch(()=>{})}await evictInactive();return snapshot();
  }catch(error){stagingWallpaperID=null;if(row){if(assigned){customImages=previousRows;settings.background=previousBackground;settings.desktop=previousDesktop}else customImages=customImages.filter(x=>x.id!==row.id);await images.discard(row.id).catch(()=>{});await packages?.evict(row.id).catch(()=>{});await save().catch(()=>{})}throw error}
  finally{importing=false}
 }
 async function nativeScene(body={}){
  await load();if(body.webHost===true)nativeWebHostAt=Date.now();
  if(body.desktopManagement===true&&Array.isArray(body.desktopScreens)){knownScreens.clear();detectedScreensKnown=true;for(const id of body.desktopScreens.slice(0,32))if(validScreen(id))knownScreens.add(id)}
  if(body.propertyAsset){const asset=body.propertyAsset,{id,key,path:chosen}=asset,scope=target(asset),selected=scope.surface==='desktop'?selection(scope.screen):settings.background,row=customImages.find(x=>x.id===id&&x.id===selected);if(!row||typeof key!=='string'||!(chosen===null||typeof chosen==='string'))throw Error('wallpaper-property');await userFiles.select(row,key,chosen,{scope:scopeName(scope.surface,scope.screen)});assetRevision++;if(scope.surface==='desktop')knownScreens.add(scope.screen)}
  const desktopHost=body.desktopHost===true,screen=validScreen(body.screen)?body.screen:'',desktopChoice=desktopHost?(settings.desktop.screens[screen]||'follow'):'follow',chosen=desktopChoice==='follow'?settings.background:desktopChoice;if(desktopHost&&screen&&knownScreens.size<32)knownScreens.add(screen);
  if(!desktopHost&&body.id&&scenePending?.id===body.id&&['ready','error'].includes(body.state)){const pending=scenePending;scenePending=null;if(body.state==='ready')pending.resolve();else {const reason=String(body.reason||'render-failed'),error=Error(['web-script','web-resource','web-media','web-render-timeout','web-load-failed','web-process-terminated'].includes(reason)?'workshop-'+reason:'workshop-scene-render');error.reason=reason.slice(0,600);pending.reject(error)}}
  if(!desktopHost&&body.state==='error'&&body.id===settings.background&&(body.revision===undefined||body.revision===wallpaperRevision)){settings.background='live';wallpaperIssue='runtime-failed';wallpaperRevision++;await save();}
  const active=customImages.find(x=>x.id===chosen&&x.cached!==false),pending=desktopHost?null:customImages.find(x=>x.id===scenePending?.id&&x.cached!==false);
  const scene=pending?.mediaType==='scene'?pending:active?.mediaType==='scene'?active:null;
  const web=pending?.mediaType==='web'?pending:active?.mediaType==='web'?active:null;
  const desktop=settings.desktop,desktopDisplay=id=>{const value=wallpaper(id,'desktop',screen);return {...value,audio:desktop.audio&&value.audio,volume:desktop.volume*value.volume/100}},screens=new Set(detectedScreensKnown?knownScreens:[...Object.keys(desktop.screens),...knownScreens]),desktopAudibleScreens=[...screens].filter(screenID=>{const id=selection(screenID),row=customImages.find(x=>x.id===id),value=wallpaper(id,'desktop',screenID);return !!row&&['video','web','scene'].includes(row.mediaType)&&row.cached!==false&&(row.mediaType!=='video'||row.hasAudio!==false)&&value.audio&&value.volume>0}),desktopAudioActive=desktopHostEnabled&&desktop.enabled&&desktop.audio&&desktop.volume>0&&(!detectedScreensKnown&&!screens.size||desktopAudibleScreens.length>0),display=desktopHost?desktopDisplay(chosen):wallpaper(chosen),enabled=desktopHost?desktop.enabled&&desktopChoice!=='off':settings.enabled,intensity=desktopHost?1:settings.intensity/100,revision=desktopHost?0:wallpaperRevision,common={revision,intensity,enabled,fps:desktopHost?desktop.fps:30,display};
  const sceneSettings=scene?(desktopHost?{...sceneDisplay(scene,'desktop',screen),...desktopDisplay(scene.id),properties:sceneDisplay(scene,'desktop',screen).properties}:sceneDisplay(scene)):null,webSettings=web?(desktopHost?desktopDisplay(web.id):wallpaper(web.id)):null;
  return{ok:true,desktop,desktopAudioActive,desktopAudibleScreens,selected:chosen,display,...(!desktopHost?{menuDisplay:wallpaper(chosen,'menu')}:{}),presentationKey:JSON.stringify([chosen,revision,assetRevision,enabled,intensity,desktopHost?desktop:null,display,desktopHost?null:wallpaper(chosen,'menu')]),webOrigin:packages?.origin(),scene:scene?{...common,enabled:enabled||!!pending&&pending.id===scene.id,display:sceneSettings,id:scene.id,source:packages.source(scene.id)+'/project.json',assets:dirname(path)+'/scene-assets/assets',cache:dirname(path)+'/scene-shaders',properties:properties(scene,{native:true,surface:desktopHost?'desktop':'app',screen}),...(!desktopHost?{menu:{display:sceneDisplay(scene,'menu'),properties:properties(scene,{native:true,surface:'menu'})}}:{}),preparing:!desktopHost&&scenePending?.id===scene.id,preflightOnly:!desktopHost&&scenePending?.id===scene.id&&!!scenePending?.desktopTarget}:null,web:web?{...common,enabled:enabled||!!pending&&pending.id===web.id,display:webSettings,id:web.id,url:packages.url(web),properties:properties(web,{native:true,surface:desktopHost?'desktop':'app',screen}),...(!desktopHost?{menu:{display:wallpaper(web.id,'menu'),properties:properties(web,{native:true,surface:'menu'})}}:{}),preparing:!desktopHost&&scenePending?.id===web.id,preflightOnly:!desktopHost&&scenePending?.id===web.id&&!!scenePending?.desktopTarget}:null};
 }

 async function readMedia(id,extension,range){await load();const row=customImages.find(x=>x.id===id);if(!row||row.mediaExtension!==extension||!['gif','video'].includes(row.mediaType))throw Error('image-not-found');return images.readMedia(id,extension,range)}
 async function readImage(id,thumbnail=false){await load();if(!validCustomID(id)||!customImages.some(x=>x.id===id))throw Error('image-not-found');return images.read(id,thumbnail)}
 return{action,importImage,importVideoFile,importWorkshop,nativeScene,close:()=>packages?.close(),readImage,readMedia,readCityImage:cityScenery.read,presentationSnapshot};
}
