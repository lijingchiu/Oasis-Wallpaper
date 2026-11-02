/* City-name-only discovery. Coordinates stay local and are used solely to
   reject photographs geotagged in another city. Images are fetched on demand. */
import {readFile,writeFile,mkdir,rename,rm} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {createHash,randomInt,randomUUID} from 'node:crypto';
import {createWeatherImages,validCustomID,MAX_IMAGE_BYTES} from './OasisWeatherImages.mjs';

const API='https://commons.wikimedia.org/w/api.php',DAY=86400000;
const MIN_PHOTOS=10,TARGET_PHOTOS=24,MAX_PHOTOS=32,MAX_POOLS=128,MAX_CACHE=36,CITY_CACHE=12,SEARCH_BACKOFF=15*60*1000,MAX_SEARCH_REQUESTS=8;
const agent='Oasis/3.3 city scenery (https://github.com/lijingchiu/Oasis-Wallpaper)';
const plain=value=>String(value||'').replace(/<[^>]*>/g,' ').replace(/&(?:nbsp|amp|quot|lt|gt);/g,x=>({'&nbsp;':' ','&amp;':'&','&quot;':'"','&lt;':'<','&gt;':'>'}[x])).replace(/\s+/g,' ').trim().slice(0,700);
const normalized=value=>String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
function cityName(location){const name=plain(location?.name).slice(0,80),region=plain(location?.region).slice(0,80);return /(?:區|区|district|borough)$/i.test(name)&&/(?:市|東京都|大阪府|京都府| city)$/i.test(region)?region:name}
// Pool identity follows the area, not the localized district label. The same
// location must share candidates/history in Traditional Chinese, English, etc.
const cityKey=location=>location?['city',Math.round(location.latitude*10)/10,Math.round(location.longitude*10)/10].join(':'):'';
const areaKey=key=>String(key||'').replace(/^.*:([-\d.]+):([-\d.]+)$/,'city:$1:$2');
const cityID=title=>'city-'+createHash('sha256').update(title).digest('hex').slice(0,24);
const isID=id=>/^city-[a-f0-9]{24}$/.test(id||'');
const cleanURL=(value,host)=>{try{const u=new URL(value);return u.protocol==='https:'&&u.hostname===host&&!u.username&&!u.password?u.href:null}catch{return null}};
const denied=/\b(?:ai[- ]generated|generative ai|midjourney|stable diffusion|dall.e|synthetic image|computer.generated|rendering|illustration|drawing|painting|postcard|engraving|map|locator|logo|flag|coat of arms|floor plan|diagram|collage|montage)\b/i;
// Reject notice boards even when their metadata happens to say 'landscape'.
// Apply the same exclusions to discovery, old pools, cached fallback and reads.
const rejectedPhotoIDs=new Set(['city-12e1524409a1e26d7195bfbf']);
const nonScenicSubject=/\b(?:construction (?:notice|sign|board)|engineering sign|notice ?board|information board|signboard|billboard|traffic sign|road sign|advertisement|poster|plaque|document|screenshot)\b|施工(?:公告|告示|看板|標示|牌)|工程(?:公告|告示|看板|標示|牌)|公告(?:板|牌)|告示(?:板|牌)|標示牌|指示牌|广告牌|廣告牌|掲示板|工事看板/i;
const permittedPhoto=row=>!!row&&!rejectedPhotoIDs.has(row.id)&&!nonScenicSubject.test([row.title,row.source].join(' '));
function distance(a,b){const r=Math.PI/180,x=(a.latitude-b.lat)*r,y=(a.longitude-b.lon)*r*Math.cos(a.latitude*r);return Math.hypot(x,y)*6371}
export function photoCandidate(page,location,searchName){
 const info=page.imageinfo?.[0],m=info?.extmetadata||{},title=String(page.title||''),description=plain(m.ImageDescription?.value),categories=plain(m.Categories?.value),all=[title,description,categories].join(' ');
 if(!permittedPhoto({id:cityID(title),title,source:info?.descriptionurl})||nonScenicSubject.test(description))return null;
 if(!info||info.width<2560||info.height<1440||info.width/info.height<1.2||info.width/info.height>2.5||info.size>MAX_IMAGE_BYTES||info.width>16000||info.height>16000||info.width*info.height>80000000||!/^image\/jpeg$/.test(info.mime||''))return null;
 const license=plain(m.LicenseShortName?.value),licenseURL=cleanURL(m.LicenseUrl?.value,'creativecommons.org');
 if(!/^(?:CC BY(?:-SA)? [234]\.0|CC0(?: 1\.0)?|Public domain)$/i.test(license)||denied.test(all))return null;
 if(!/^(?:CC0|Public domain)/i.test(license)&&!licenseURL)return null;
 const shot=plain(m.DateTimeOriginal?.value),year=Number(shot.match(/(?:19|20)\d\d/)?.[0]),camera=/taken with (?:canon|nikon|sony|fujifilm|pentax|olympus|panasonic|samsung|iphone|apple|leica|hasselblad|ricoh|kodak|dji)/i.test(categories);
 if(!(year>=1850&&year<2022)&&!camera)return null;
 if(page.coordinates?.length&&distance(location,page.coordinates[0])>65)return null;
 // Search engines can match an incidental credit. Require the actual place in
 // the title, caption or subject categories, as well as an outdoor scene cue.
 const name=normalized(searchName).replace(/^city of /,'').replace(/ (?:city|district|borough)$/,'');
 if(!normalized(all).includes(name)||!/(skyline|cityscape|panoram|landscape|waterfront|river|harbour|harbor|lake|park|garden|mountain|coast|sky|street|temple|橋|河|山|海|公園|風景|景觀|夜景|街)/i.test(title+' '+description))return null;
 const original=cleanURL(info.url,'upload.wikimedia.org'),thumbnail=cleanURL(info.thumburl,'upload.wikimedia.org');if(!original)return null;
 const source=cleanURL(info.descriptionurl,'commons.wikimedia.org');if(!source)return null;
 const author=plain(m.Artist?.value)||'Wikimedia Commons contributor';
 const score=(/featured pictures|quality images|valued images/i.test(categories)?8:0)+Math.min(4,info.width*info.height/6000000)+(info.width>=3840?2:0)+(/skyline|panorama|waterfront|landscape/i.test(title)?2:0);
 return{id:cityID(title),title:plain(title.replace(/^File:/,'')),author,license,licenseURL:licenseURL||'https://creativecommons.org/publicdomain/mark/1.0/',source,downloadURL:original,width:info.width,height:info.height,score,isDay:!/(night|dusk|sunset|evening|blue hour|夜景)/i.test(title)};
}
export function createCityScenery({path,fetchImpl=globalThis.fetch,now=Date.now}={}){
 const folder=path?join(dirname(path),'weather-city'):null,store=folder?join(folder,'library.json'):null,images=createWeatherImages(store),searches=new Map();
 let loaded=false,loadPromise=null,library={pools:{},photos:[],history:{}},writeQueue=Promise.resolve(),current={key:'',status:'idle',photo:null,city:''},pending=null,lastAttempt=0,retryAt=0,serial=0;
 async function load(){
  if(loaded)return;if(loadPromise)return loadPromise;
  loadPromise=(async()=>{
   try{
    const saved=JSON.parse(await readFile(store,'utf8'));
    const pools={},history={};
    // Merge legacy language-specific pools rather than keeping the tiny pool
    // selected by the current UI language. Keep all subject exclusions.
    for(const [oldKey,pool]of Object.entries(saved.pools||{})){
     if(!Array.isArray(pool?.photos))continue;
     const key=areaKey(oldKey),prior=pools[key],rows=new Map((prior?.photos||[]).map(row=>[row.id,row]));
     for(const row of pool.photos)if(isID(row?.id)&&permittedPhoto(row))rows.set(row.id,row);
     pools[key]={fetchedAt:Math.min(prior?.fetchedAt??Infinity,Number(pool.fetchedAt)||0),nextSearchAt:Math.min(prior?.nextSearchAt??Infinity,Number(pool.nextSearchAt)||0),photos:[...rows.values()].sort((a,b)=>b.score-a.score).slice(0,MAX_PHOTOS)};
    }
    for(const [oldKey,rows]of Object.entries(saved.history||{}))if(Array.isArray(rows)){const key=areaKey(oldKey);history[key]=[...(history[key]||[]),...rows.filter(isID)].slice(-12)}
    library={pools,history,photos:Array.isArray(saved.photos)?saved.photos.filter(x=>isID(x.id)&&validCustomID(x.fileID)&&permittedPhoto(x)).slice(-MAX_CACHE).map(row=>({...row,cityKey:areaKey(row.cityKey)})):[]};
   }catch{}
   loaded=true;
  })();return loadPromise;
 }
 async function save(){if(!store)return;const value=JSON.stringify(library);writeQueue=writeQueue.catch(()=>{}).then(async()=>{await mkdir(folder,{recursive:true,mode:0o700});const temp=store+'.'+randomUUID()+'.tmp';await writeFile(temp,value,{mode:0o600});await rename(temp,store)});await writeQueue}
 async function download(url,{bytes=MAX_IMAGE_BYTES,timeout=12000}={}){
  const response=await fetchImpl(url,{headers:{'User-Agent':agent,Accept:'*/*'},signal:AbortSignal.timeout(timeout),redirect:'error'});
  if(!response.ok)throw Error(response.status===429?'city-rate-limit':'city-unavailable');if(Number(response.headers.get('content-length'))>bytes)throw Error('city-unavailable');
  const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>bytes)throw Error('city-unavailable');chunks.push(chunk)}return Buffer.concat(chunks);
 }
 async function json(url){return JSON.parse((await download(url,{bytes:3*1024*1024,timeout:9000})).toString('utf8'))}
 async function searchName(location){
  const name=cityName(location);if(/^[\x20-\x7e]+$/.test(name))return name;
  try{const url=new URL('https://geocoding-api.open-meteo.com/v1/search');const query=name.replace(/臺/g,'台');url.search=new URLSearchParams({name:/^\p{Script=Han}{2}$/u.test(query)?query+'市':query,count:'10',language:'en',format:'json'});const data=await json(url);
   const nearest=(data.results||[]).map(x=>({...x,distance:distance(location,{lat:x.latitude,lon:x.longitude})})).sort((a,b)=>a.distance-b.distance)[0];if(nearest?.distance<50)return nearest.name;
  }catch{}return name;
 }
 function needsSearch(key){const cached=library.pools[key];return !cached||now()>=(cached.nextSearchAt||0)&&now()-cached.fetchedAt>=(cached.photos.length>=MIN_PHOTOS?7*DAY:SEARCH_BACKOFF)}
 function replenish(location,key){
  if(searches.has(key))return searches.get(key);
  const job=(async()=>{
   const cached=library.pools[key],photos=new Map((cached?.photos||[]).filter(permittedPhoto).map(row=>[row.id,row]));
   let successful=0,limited=false;
   try{
    const name=await searchName(location),names=[...new Set([name,cityName(location)].filter(Boolean))],queries=[];
    // Use different scenery subjects first, then follow result continuation.
    // No coordinates are transmitted: discovery uses only the city name.
    for(const theme of ['skyline','panorama','landscape','waterfront','park','night','mountain','coast'])for(const search of names)queries.push({search,theme});
    let requests=0;
    while(queries.length&&requests++<MAX_SEARCH_REQUESTS&&photos.size<TARGET_PHOTOS){
     const query=queries.shift(),url=new URL(API);
     url.search=new URLSearchParams({action:'query',format:'json',generator:'search',gsrsearch:`"${query.search.replace(/["\\]/g,'')}" ${query.theme} filetype:bitmap`,gsrnamespace:'6',gsrlimit:'40',prop:'imageinfo|coordinates',colimit:'1',iiprop:'url|size|mime|extmetadata',iiextmetadatafilter:'Artist|LicenseShortName|LicenseUrl|ImageDescription|Categories|DateTimeOriginal',iiextmetadatalanguage:'en',maxlag:'5',...query.continuation});
     try{
      const data=await json(url);if(data.error)throw Error(/maxlag|ratelimit/i.test(data.error.code||'')?'city-rate-limit':'city-unavailable');successful++;
      for(const page of Object.values(data.query?.pages||{})){const row=photoCandidate(page,location,query.search);if(row)photos.set(row.id,row)}
      if(data.continue?.gsroffset!==undefined)queries.splice(Math.min(3,queries.length),0,{...query,continuation:{continue:data.continue.continue||'-||',gsroffset:String(data.continue.gsroffset)}});
     }catch(error){if(error.message==='city-rate-limit'){limited=true;break}}
     // Ten is the minimum. Continue toward a larger buffer while the bounded
     // request budget permits; never relax photo/license/subject requirements.
    }
    const rows=[...photos.values()].sort((a,b)=>b.score-a.score).slice(0,MAX_PHOTOS);
    library.pools[key]={fetchedAt:successful?now():cached?.fetchedAt||0,nextSearchAt:now()+(limited||rows.length<MIN_PHOTOS?SEARCH_BACKOFF:7*DAY),photos:rows};
    const keys=Object.keys(library.pools).filter(k=>k!==key).sort((a,b)=>library.pools[a].fetchedAt-library.pools[b].fetchedAt);
    while(Object.keys(library.pools).length>MAX_POOLS){const old=keys.shift();delete library.pools[old];delete library.history[old]}
    await save();if(!rows.length)throw Error(successful?'city-no-photos':'city-unavailable');return rows;
   }finally{searches.delete(key)}
  })();searches.set(key,job);return job;
 }
 async function pool(location,key){
  const cached=library.pools[key];
  if(cached?.photos?.length){if(needsSearch(key))void replenish(location,key).catch(()=>{});return cached.photos}
  if(cached&&!needsSearch(key))throw Error('city-no-photos');
  return replenish(location,key);
 }
 function view(location){const key=cityKey(location);return{status:current.key===key?current.status:location?'idle':'needs-location',city:cityName(location)||'',candidateCount:library.pools[key]?.photos?.length||0,minimumPhotos:MIN_PHOTOS,collecting:searches.has(key),retained:current.key===key&&current.retained===true,retryAfter:current.key===key?Math.max(0,Math.ceil((retryAt-now())/1000)):0,photo:current.key===key&&current.photo?{id:current.photo.id,title:current.photo.title,author:current.photo.author,license:current.photo.license,licenseURL:current.photo.licenseURL,source:current.photo.source,width:current.photo.displayWidth,height:current.photo.displayHeight,isDay:current.photo.isDay}:null}}
 function ensure(location,{shuffle=false}={}){
  if(!location){current={key:'',status:'needs-location',photo:null,city:''};return Promise.resolve()}
  const key=cityKey(location);if(pending?.key===key)return pending.promise;
  if(current.key===key&&!shuffle&&['ready','empty','failed'].includes(current.status)){
   if(needsSearch(key))void replenish(location,key).then(()=>{if(current.key===key&&!current.photo)current.status='idle'}).catch(()=>{});
   return Promise.resolve();
  }
  if(now()<retryAt&&current.key===key)return Promise.resolve();if(shuffle&&now()-lastAttempt<3000)return Promise.resolve();
  const generation=++serial,previous=current.key===key?current.photo:null;current={key,status:'loading',photo:previous,city:cityName(location)};lastAttempt=now();
  const promise=(async()=>{await load();try{
   if(!location.name||location.name==='目前位置')throw Error('city-no-photos');
   const choices=await pool(location,key),history=(library.history[key]||[]).filter(isID),recent=new Set(history.slice(-Math.max(1,Math.min(5,choices.length-1))));
   const alternatives=choices.filter(x=>x.id!==previous?.id);
   let available=alternatives.filter(x=>!recent.has(x.id));if(!available.length)available=alternatives;if(!available.length)available=choices;
   // Every accepted photo participates in random selection, including at least
   // ten candidates once discovery completes. History spans both interfaces.
   let chosen=null;
   const attemptLimit=Math.min(3,available.length);for(let attempts=0;attempts<attemptLimit;attempts++){
    const index=randomInt(available.length),candidate=available.splice(index,1)[0];let cached=library.photos.find(x=>x.id===candidate.id);
    try{
     if(cached)await images.read(cached.fileID);else{
      const url=cleanURL(candidate.downloadURL,'upload.wikimedia.org');if(!url)continue;const bytes=await download(url),image=await images.importImage(bytes,candidate.title);
      cached={...candidate,fileID:image.id,displayWidth:image.width,displayHeight:image.height,cachedAt:now(),cityKey:key};library.photos.push(cached);
     }
     chosen=cached;break;
    }catch(error){if(error.message==='city-rate-limit'){retryAt=now()+15*60*1000;break}}
   }
   if(!chosen){chosen=library.photos.filter(x=>x.cityKey===key&&x.id!==previous?.id).at(-1)||previous;if(!chosen)throw Error('city-unavailable')}
   library.history[key]=[...history,chosen.id].slice(-12);
   chosen.cachedAt=now();library.photos=library.photos.filter(x=>x.id!==chosen.id);library.photos.push(chosen);
   while(library.photos.length>MAX_CACHE||library.photos.filter(x=>x.cityKey===key).length>CITY_CACHE){
    const localLimit=library.photos.filter(x=>x.cityKey===key).length>CITY_CACHE;
    const index=library.photos.findIndex(x=>x.id!==chosen.id&&x.id!==current.photo?.id&&(!localLimit||x.cityKey===key));if(index<0)break;
    const [old]=library.photos.splice(index,1);if(validCustomID(old.fileID))for(const suffix of ['.jpg','-thumb.jpg'])await rm(join(folder,'weather-images',old.fileID+suffix),{force:true}).catch(()=>{});
   }
   await save();if(generation===serial)current={key,status:'ready',photo:chosen,city:cityName(location),retained:!!previous&&previous.id===chosen.id};
  }catch(error){if(generation===serial){current={key,status:previous?'ready':error.message==='city-no-photos'?'empty':'failed',photo:previous,city:cityName(location),retained:!!previous};retryAt=Math.max(retryAt,now()+60000)}}
  finally{if(pending?.key===key)pending=null}})();pending={key,promise};return promise;
 }
 async function read(id,thumbnail=false){await load();if(!isID(id)||rejectedPhotoIDs.has(id))throw Error('image-not-found');const row=library.photos.find(x=>x.id===id);if(!row)throw Error('image-not-found');return images.read(row.fileID,thumbnail)}
 return{load,view,ensure,read};
}
