// Standalone host for the same wallpaper engine used by Oasis.  No player,
// maintenance, account-switching, or widget services are started here.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {homedir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {createWeather} from './OasisWeather.mjs';
import {createSteamWorkshop} from './OasisSteamWorkshop.mjs';
import {uploadWeatherVideo,uploadWallpaperArchive} from './OasisWeatherUpload.mjs';
import {serveWeatherMedia} from './OasisWeatherMediaHttp.mjs';
import {sceneryCatalog,MAX_IMAGE_BYTES,MAX_MEDIA_BYTES} from './OasisWeatherImages.mjs';
import {isLocalRequest} from './MoleRequestPolicy.mjs';
import {browseWorkshop} from './OasisWorkshopBrowse.mjs';
import {importOasisLibrary} from './OasisWallpaperImport.mjs';

const settingsPath=join(process.env.OASIS_WALLPAPER_DATA || join(homedir(),'Library','Application Support','Oasis Wallpaper'),'oasis-weather.json');
const nativeToken=process.env.MOLE_GUI_NATIVE_TOKEN || '';
let weather=createWeather({path:settingsPath});
const workshop=createSteamWorkshop({path:settingsPath,importImage:(folder,name,item,options)=>weather.importWorkshop(folder,name,item,options)});
const assets={'/theme.js':'MoleTheme.js','/theme.css':'MoleTheme.css','/':'OasisWallpaper.html','/wallpaper-app.css':'OasisWallpaper.css','/wallpaper-app.js':'OasisWallpaperApp.js','/workshop-browser.js':'OasisWorkshopBrowser.js','/workshop-browser.css':'OasisWorkshopBrowser.css','/controls.css':'OasisControls.css','/glass.css':'MoleGlass.css','/weather.css':'OasisWeather.css','/weather.js':'OasisWeatherUI.js','/weather-scene.js':'OasisWeatherScene.js','/weather-landscapes.js':'OasisWeatherLandscapes.js','/wallpaper-properties.js':'OasisWallpaperProperties.js','/desktop-wallpaper':'OasisDesktopWallpaper.html','/desktop-wallpaper.js':'OasisDesktopWallpaper.js','/wallpaper-wordmark.png':'OasisWallpaperWordmark.png','/weather-atlas.png':'OasisWeatherAtlas.png','/weather-clouds-hd.png':'OasisWeatherCloudsHD.png'};
let port=0,activeRequests=0,activePosts=0,importing=false,updateReservedUntil=0;
function send(res,code,data,type='application/json; charset=utf-8'){
 res.writeHead(code,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
 res.end(type.startsWith('application/json')?JSON.stringify(data):data);
}
async function readBody(req,limit=10000){let data='';for await(const part of req){data+=part;if(data.length>limit)throw Error('too-large')}return data?JSON.parse(data):{}}
function type(name){return name.endsWith('.png')?'image/png':name.endsWith('.css')?'text/css; charset=utf-8':name.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8'}
const server=http.createServer(async(req,res)=>{
 if(!isLocalRequest(req,port))return send(res,403,{ok:false});
 // These resources live in the signed bundle, outside the library being imported.
 if(req.method==='GET'){
  try {
   if(req.url==='/weather-catalog.js')return send(res,200,'window.OasisWeatherCatalog='+JSON.stringify(sceneryCatalog)+';','text/javascript; charset=utf-8');
   const file=assets[req.url];
   if(typeof file==='string')return send(res,200,await readFile(new URL('./'+file,import.meta.url)),type(file));
   const scene=/^\/weather-scenes\/([a-zA-Z]+)(-thumb)?\.jpg$/.exec(req.url);
   if(scene&&sceneryCatalog.some(x=>x.id===scene[1]))return send(res,200,await readFile(new URL('./WeatherScenes/'+scene[1]+(scene[2]||'')+'.jpg',import.meta.url)),'image/jpeg');
  }catch{return send(res,500,{ok:false})}
 }
 const post=req.method==='POST';
 if(post&&req.url==='/api/native-update-install'){
  if(!nativeToken||req.headers['x-mole-native']!==nativeToken)return send(res,403,{ok:false});
  let reserve;try{({reserve}=await readBody(req,128))}catch{return send(res,400,{ok:false})}
  if(typeof reserve!=='boolean')return send(res,400,{ok:false});
  if(!reserve){updateReservedUntil=0;return send(res,200,{ok:true})}
  if(importing||workshop.busy()||updateReservedUntil>Date.now())return send(res,409,{ok:false,error:'update-busy'});
  // Drain requests already saving settings or uploading a file; prevent a new edit before relaunch.
  updateReservedUntil=Date.now()+35000;
  const deadline=Date.now()+1500;
  while(activePosts&&Date.now()<deadline)await delay(40);
  if(activePosts||workshop.busy()){updateReservedUntil=0;return send(res,409,{ok:false,error:'update-busy'})}
  return send(res,200,{ok:true});
 }
 if(post&&updateReservedUntil>Date.now())return send(res,409,{ok:false,error:'update-busy'});
 const nativeImport=post&&req.url==='/api/native-import';
 if(nativeImport&&(!nativeToken||req.headers['x-mole-native']!==nativeToken))return send(res,403,{ok:false});
 if(importing)return send(res,409,{ok:false,error:'import-busy'});
 if(nativeImport){
  if(activeRequests)return send(res,409,{ok:false,error:'import-busy'});
  importing=true;try{const result=await importOasisLibrary({source:join(homedir(),'.config','mole'),destination:dirname(settingsPath)});if(result.ok){weather.close();weather=createWeather({path:settingsPath})}return send(res,result.ok?200:400,result)}finally{importing=false}
 }
 activeRequests++;if(post)activePosts++;try{
 const custom=/^\/weather-custom\/(custom-[a-f0-9-]{36})(-thumb)?\.jpg$/.exec(req.url);
 if(req.method==='GET'&&custom){try{return send(res,200,await weather.readImage(custom[1],!!custom[2]),'image/jpeg')}catch{return send(res,404,{ok:false,error:'image-not-found'})}}
 if(await serveWeatherMedia(req,res,weather,send))return;
 const city=/^\/weather-city\/(city-[a-f0-9]{24})(-thumb)?\.jpg$/.exec(req.url);
 if(req.method==='GET'&&city){try{return send(res,200,await weather.readCityImage(city[1],!!city[2]),'image/jpeg')}catch{return send(res,404,{ok:false,error:'image-not-found'})}}
 if(req.method==='POST'&&['/api/native-scene','/api/native-workshop'].includes(req.url)){
  if(!nativeToken||req.headers['x-mole-native']!==nativeToken)return send(res,403,{ok:false});
  try{if(req.url.endsWith('scene')){const body=await readBody(req,8192),result=await weather.nativeScene(body);if(body.desktopHost!==true){for(const key of ['scene','web'])if(result[key]&&!result[key].preparing)result[key].enabled=false}return send(res,200,result)}return send(res,200,workshop.nativeCredentials(await readBody(req,40000)))}catch{return send(res,400,{ok:false})}
 }
 if(req.method==='POST'&&req.url==='/api/weather/workshop'){
  try{return send(res,200,await workshop.action(await readBody(req,8192)))}catch(error){return send(res,400,{ok:false,error:/^workshop-/.test(error.message)?error.message:'workshop-unavailable'})}
 }
 if(req.method==='POST'&&req.url==='/api/weather/workshop/browse'){
  try{return send(res,200,await browseWorkshop(await readBody(req,4096)))}catch(error){return send(res,400,{ok:false,error:/^workshop-browse-/.test(error.message)?error.message:'workshop-browse-unavailable'})}
 }
 if(req.method==='POST'&&req.url==='/api/weather/image'){
  const contentType=String(req.headers['content-type']||'').split(';')[0],limit=contentType.startsWith('video/')?MAX_MEDIA_BYTES:MAX_IMAGE_BYTES;
  if(!['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','video/x-m4v','application/zip'].includes(contentType))return send(res,415,{ok:false,error:'image-type'});
  let name='';try{name=decodeURIComponent(String(req.headers['x-oasis-image-name']||'').slice(0,1200))}catch{}
  let desktopTarget=null;const screen=req.headers['x-oasis-desktop-screen'];if(screen!==undefined){const expected=req.headers['x-oasis-desktop-expected'],enabled=req.headers['x-oasis-desktop-enabled'],displays=String(req.headers['x-oasis-desktop-displays']||'').split(',').filter(Boolean);if(typeof screen!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(screen)||typeof expected!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(expected)||!['0','1'].includes(enabled)||displays.length>32||displays.some(id=>!/^[A-Za-z0-9_-]{1,80}$/.test(id)))return send(res,400,{ok:false,error:'workshop-target'});desktopTarget={screen,expected,enable:true,expectedEnabled:enabled==='1',displays}}
  if(contentType==='application/zip'){
   try{return send(res,200,await uploadWallpaperArchive(req,{settingsPath,name,length:req.headers['content-length'],weather,desktopTarget}))}
   catch(error){return send(res,400,{ok:false,error:/^(?:archive-|image-|workshop-)/.test(error.message)?error.message:'archive-invalid'})}
  }
  if(contentType.startsWith('video/')){try{return send(res,200,await uploadWeatherVideo(req,{settingsPath,name,length:req.headers['content-length'],importFile:(file,label)=>weather.importVideoFile(file,label,null,{desktopTarget})}))}catch(error){return send(res,400,{ok:false,error:/^(image-|workshop-selection-changed)/.test(error.message)?error.message:'image-decode'})}}
  if(Number(req.headers['content-length'])>limit)return send(res,413,{ok:false,error:'image-size'});
  try{const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>limit)return send(res,413,{ok:false,error:'image-size'});chunks.push(chunk)}return send(res,200,await weather.importImage(Buffer.concat(chunks),name,{desktopTarget}))}catch(error){return send(res,400,{ok:false,error:/^(image-|workshop-selection-changed)/.test(error.message)?error.message:'image-decode'})}
 }
 if(req.method==='POST'&&req.url==='/api/weather'){try{return send(res,200,await weather.action(await readBody(req)))}catch{return send(res,400,{ok:false,error:'weather-unavailable'})}}
 return send(res,404,{ok:false});
}catch{if(!res.headersSent)send(res,500,{ok:false});else res.destroy()}finally{activeRequests--;if(post)activePosts--}});
server.listen(0,'127.0.0.1',()=>{port=server.address().port;process.stdout.write(`OASIS_WALLPAPER_READY ${port}\n`)});
function shutdown(){workshop.cancel();weather.close();server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),1500).unref()}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
const parent=Number(process.env.MOLE_GUI_PARENT_PID);if(Number.isSafeInteger(parent)&&parent>1)setInterval(()=>{try{process.kill(parent,0)}catch{shutdown()}},5000).unref();
