/* Local-only background imports. Decode with macOS ImageIO through sips, then
   keep a bounded, metadata-free display JPEG and thumbnail outside the app. */
import {readFile,writeFile,mkdir,mkdtemp,rename,rm,lstat,readdir,chmod,open,copyFile,statfs} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

export const sceneryCatalog=JSON.parse(await readFile(new URL('./WeatherScenes/catalog.json',import.meta.url),'utf8'));
export const backgroundScenes=['live','city',...sceneryCatalog.map(x=>x.id)];
export const fallingTypes=['auto','none','petals','leaves','snow','dust'];
export const MAX_IMAGE_BYTES=20*1024*1024;
// Video bodies are streamed to files. This is an integer boundary, not a storage quota.
export const MAX_MEDIA_BYTES=Number.MAX_SAFE_INTEGER;
const MAX_STORED=40,MAX_STORAGE=500*1024*1024,MAX_PIXELS=80*1000*1000;
const uuid='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
export const validCustomID=value=>typeof value==='string'&&new RegExp('^custom-'+uuid+'$').test(value);
const run=promisify(execFile);
export function imageDimensions(b,{display=false}={}){
 if(!Buffer.isBuffer(b)||b.length<24||b.length>MAX_IMAGE_BYTES)throw Error('image-size');
 let width,height,extension;
 if(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&b.toString('ascii',12,16)==='IHDR'){
  width=b.readUInt32BE(16);height=b.readUInt32BE(20);extension='png';
 }else if(b[0]===255&&b[1]===216){
  extension='jpg';let offset=2;
  while(offset+4<=b.length){
   if(b[offset++]!==255)break;while(b[offset]===255)offset++;
   const marker=b[offset++];if(marker===217||marker===218)break;if(marker===1||marker>=208&&marker<=215)continue;
   const length=b.readUInt16BE(offset);if(length<2||offset+length>b.length)break;
   if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&length>=8){height=b.readUInt16BE(offset+3);width=b.readUInt16BE(offset+5);break}offset+=length;
  }
 }else if(b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP'){
  extension='webp';const kind=b.toString('ascii',12,16);
  if(kind==='VP8X'&&b.length>=30){width=1+b.readUIntLE(24,3);height=1+b.readUIntLE(27,3)}
  else if(kind==='VP8 '&&b.length>=30&&b[23]===157&&b[24]===1&&b[25]===42){width=b.readUInt16LE(26)&16383;height=b.readUInt16LE(28)&16383}
  else if(kind==='VP8L'&&b.length>=25&&b[20]===47){const n=b.readUInt32LE(21);width=1+(n&16383);height=1+((n>>>14)&16383)}
 }
 if(!extension||!width||!height)throw Error('image-type');
 if(!display&&(Math.max(width,height)<320||Math.min(width,height)<240)||width>16000||height>16000||width*height>MAX_PIXELS)throw Error('image-dimensions');
 return{width,height,extension};
}
// Strip EXIF, XMP, IPTC, comments and vendor metadata (including GPS).
// Keep only JFIF, ICC and Adobe color interpretation before the JPEG scan.
function withoutMetadata(buffer){
 const parts=[buffer.subarray(0,2)];let offset=2;
 while(offset+4<=buffer.length&&buffer[offset]===255){
  const start=offset;while(buffer[offset]===255)offset++;const marker=buffer[offset++];
  if(marker===218||marker===217){parts.push(buffer.subarray(start));return Buffer.concat(parts)}
  const length=buffer.readUInt16BE(offset);if(length<2||offset+length>buffer.length)throw Error('image-decode');
  offset+=length;if(!(marker>=225&&marker<=239&&marker!==226&&marker!==238)&&marker!==254)parts.push(buffer.subarray(start,offset));
 }
 throw Error('image-decode');
}
export function validateWallpaperProperties(value){
 if(!value||typeof value!=='object'||Array.isArray(value))return{};
 return Object.fromEntries(Object.entries(value).filter(([key,row])=>key.length<=128&&row&&typeof row==='object'&&['bool','boolean','slider','color','combo','textinput','file','directory','texture','scenetexture','usershortcut','group'].includes(row.type)).slice(0,1024).map(([key,row])=>[key,{type:row.type,...(['file','directory','texture','scenetexture'].includes(row.type)?{filetype:row.filetype==='videos'?'videos':row.filetype==='images'||row.type==='directory'?'images':'any'}:{}),...(row.type==='directory'?{mode:row.mode==='fetchall'?'fetchall':'ondemand'}:{}),...(['boolean','number'].includes(typeof row.value)?{value:row.value}:typeof row.value==='string'?{value:row.value.slice(0,['file','directory','texture','scenetexture'].includes(row.type)?4096:16384)}:{}),...(['text','title','condition','description'].reduce((out,k)=>(typeof row[k]==='string'&&(out[k]=row[k].slice(0,k==='condition'?1024:160)),out),{})),...(['min','max','step','order','index','precision'].reduce((out,k)=>(Number.isFinite(row[k])&&(out[k]=row[k]),out),{})),...(typeof row.fraction==='boolean'?{fraction:row.fraction}:{}),...(Array.isArray(row.options)?{options:row.options.slice(0,512).filter(o=>o&&['string','number','boolean'].includes(typeof o.value)).map(o=>({label:String(o.label??o.value).slice(0,160),value:o.value}))}:{})}]));
}
export function validateCustomImages(value){
 if(!Array.isArray(value))return[];
 const seen=new Set();return value.filter(x=>validCustomID(x?.id)&&!seen.has(x.id)&&seen.add(x.id)).slice(0,MAX_STORED).map(x=>({id:x.id,name:String(x.name||'').replace(/[\u0000-\u001f]/g,'').trim().slice(0,80)||'Custom image',width:Math.max(1,Math.min(3840,Number(x.width)||1)),height:Math.max(1,Math.min(3840,Number(x.height)||1)),createdAt:Number(x.createdAt)||0,archived:x.archived===true,...(['gif','video'].includes(x.mediaType)?{mediaType:x.mediaType,mediaExtension:x.mediaType==='gif'?'gif':'mp4',...(x.mediaType==='video'&&typeof x.hasAudio==='boolean'?{hasAudio:x.hasAudio}:{})}:{}),...(['web','scene'].includes(x.mediaType)&&typeof x.entry==='string'&&x.entry.length<1024&&!/[\\:\u0000-\u001f]/.test(x.entry)&&x.entry.split('/').every(p=>p&&p!=='.'&&p!=='..')?{mediaType:x.mediaType,entry:x.entry,properties:validateWallpaperProperties(x.properties)}:{}),...(['video','web','scene'].includes(x.mediaType)&&typeof x.workshopID==='string'&&/^[1-9][0-9]{0,19}$/.test(x.workshopID)?{workshopID:x.workshopID,cached:x.cached!==false,sourceBytes:Number.isSafeInteger(x.sourceBytes)&&x.sourceBytes>0?x.sourceBytes:0}:{})}));
}
export function normalizeSceneryEffects(value,customImages=[]){
 const allowed=new Set([...backgroundScenes,...customImages.map(x=>x.id)]),out={};
 for(const [id,row]of Object.entries(value&&typeof value==='object'?value:{})){
  if(!allowed.has(id)||!row||typeof row!=='object')continue;
  const effect={falling:fallingTypes.includes(row.falling)?row.falling:'auto',density:Number.isFinite(row.density)?Math.round(Math.max(25,Math.min(150,row.density))):100,speed:Number.isFinite(row.speed)?Math.round(Math.max(25,Math.min(150,row.speed))):100};if(effect.falling!=='auto'||effect.density!==100||effect.speed!==100)out[id]=effect;
 }
 return out;
}
export function createWeatherImages(settingsPath,{mediaProcessor=prepareMedia}={}){
 const folder=settingsPath?join(dirname(settingsPath),'weather-images'):null;
 async function importImage(buffer,name='',options={}){
  if(!folder)throw Error('image-storage');
  if(options.posterOnly&&backgroundMediaKind(buffer)==='gif'){
   if(buffer.length>MAX_IMAGE_BYTES)throw Error('image-size');
   await mkdir(folder,{recursive:true,mode:0o700});const temp=await mkdtemp(join(folder,'.poster-'));
   try{const source=join(temp,'preview.gif'),output=join(temp,'preview.png');await writeFile(source,buffer,{mode:0o600});await run('/usr/bin/sips',['-Z','3840','-s','format','png',source,'--out',output],{timeout:15000,maxBuffer:65536});return await importImage(await readFile(output),name,options)}finally{await rm(temp,{recursive:true,force:true})}
  }
  const media=backgroundMediaKind(buffer);if(media)return importMedia(buffer,name,media);
  const input=imageDimensions(buffer,{display:options.posterOnly===true});await mkdir(folder,{recursive:true,mode:0o700});
  const names=(await readdir(folder)).filter(x=>/^custom-.*\.jpg$/.test(x)&&!x.endsWith('-thumb.jpg'));
  if(names.length>=MAX_STORED&&!options.replace)throw Error('image-limit');
  let size=0;for(const name of (await readdir(folder)).filter(x=>/^custom-[a-f0-9-]{36}(?:-thumb)?\.(jpg|gif)$/.test(x))){const info=await lstat(join(folder,name));if(info.isFile()&&!info.isSymbolicLink())size+=info.size}if(size>MAX_STORAGE-8*1024*1024)throw Error('image-limit');
  const temp=await mkdtemp(join(folder,'.import-')),id='custom-'+randomUUID();
  try{
   const source=join(temp,'source.'+input.extension),output=join(temp,'display.jpg'),thumb=join(temp,'thumb.jpg');
   await writeFile(source,buffer,{mode:0o600,flag:'wx'});
   const info=await run('/usr/bin/sips',['-g','orientation',source],{timeout:5000,maxBuffer:65536});
   const orientation=Number(info.stdout.match(/orientation:\s*([1-8])/i)?.[1]||1),transform={2:['-f','horizontal'],3:['-r','180'],4:['-f','vertical'],5:['-r','90','-f','horizontal'],6:['-r','90'],7:['-r','90','-f','vertical'],8:['-r','270']}[orientation]||[];
   const resize=Math.max(input.width,input.height)>3840?['-Z','3840']:[];
   await run('/usr/bin/sips',[...resize,...transform,'-s','format','jpeg','-s','formatOptions','86',source,'--out',output],{timeout:25000,maxBuffer:65536});
   const jpeg=await readFile(output),result=imageDimensions(jpeg,{display:true});
   if(result.extension!=='jpg'||result.width>3840||result.height>3840||jpeg.length>8*1024*1024)throw Error('image-decode');
   // Imported files never retain GPS/EXIF or a user-controlled path.
   await writeFile(output,withoutMetadata(jpeg),{mode:0o600});
   await run('/usr/bin/sips',['-Z','640','-s','format','jpeg','-s','formatOptions','78',output,'--out',thumb],{timeout:15000,maxBuffer:65536});
   await writeFile(thumb,withoutMetadata(await readFile(thumb)),{mode:0o600});
   await chmod(output,0o600);await chmod(thumb,0o600);
   await rename(output,join(folder,id+'.jpg'));await rename(thumb,join(folder,id+'-thumb.jpg'));
   return{id,name:String(name).replace(/\.(jpe?g|png|webp)$/i,'').replace(/[\u0000-\u001f]/g,'').trim().slice(0,80)||'Custom image',width:result.width,height:result.height,createdAt:Date.now(),archived:false};
  }catch(error){for(const suffix of ['.jpg','-thumb.jpg','.gif','.mp4'])await rm(join(folder,id+suffix),{force:true}).catch(()=>{});if(/^image-/.test(error.message))throw error;throw Error('image-decode')}
  finally{await rm(temp,{recursive:true,force:true})}
 }
 async function importMedia(buffer,name,kind,{replace=false}={}){
  if(!folder)throw Error('image-storage');
  await mkdir(folder,{recursive:true,mode:0o700});
  let bytes=0,count=0;for(const name of await readdir(folder)){if(!/^custom-[a-f0-9-]{36}(?:-thumb)?\.(jpg|gif|mp4)$/.test(name))continue;const st=await lstat(join(folder,name));if(st.isFile()&&!st.isSymbolicLink()){if(!name.endsWith('.mp4'))bytes+=st.size;if(name.endsWith('.jpg')&&!name.endsWith('-thumb.jpg'))count++}}
  if(count>=MAX_STORED&&!replace||kind==='gif'&&bytes>MAX_STORAGE-MAX_IMAGE_BYTES-8*1024*1024)throw Error('image-limit');
  const temp=await mkdtemp(join(folder,'.import-')),id='custom-'+randomUUID(),extension=kind==='gif'?'gif':'mp4';
  try{
   const source=join(temp,'source.'+extension),poster=join(temp,'poster.jpg'),output=join(temp,'loop.'+extension),thumb=join(temp,'thumb.jpg');
   if(typeof buffer==='string'){
    const st=await lstat(buffer);if(!st.isFile()||st.isSymbolicLink()||!Number.isSafeInteger(st.size)||st.size<12)throw Error('image-type');
    const head=await open(buffer,constants.O_RDONLY|constants.O_NOFOLLOW);let header=Buffer.alloc(16);try{await head.read(header,0,16,0)}finally{await head.close()}if(backgroundMediaKind(header)!=='video')throw Error('image-type');
    const disk=await statfs(folder);if(Number(disk.bavail)*Number(disk.bsize)<st.size*2+128*1024*1024)throw Error('image-space');
    await copyFile(buffer,source,constants.COPYFILE_EXCL|constants.COPYFILE_FICLONE);
   }else await writeFile(source,buffer,{mode:0o600,flag:'wx'});
   const result=await mediaProcessor({kind,source,poster,output});
   const jpeg=await readFile(poster),dimensions=imageDimensions(jpeg,{display:true});
   if(dimensions.extension!=='jpg'||dimensions.width>3840||dimensions.height>3840)throw Error('image-decode');
   const movie=output;let info=await lstat(movie);if(!info.isFile()||info.isSymbolicLink()||info.size>MAX_MEDIA_BYTES)throw Error('image-size');
   if(kind==='gif'){await writeFile(movie,infiniteGif(await readFile(movie)),{mode:0o600});info=await lstat(movie)}
   await writeFile(poster,withoutMetadata(jpeg),{mode:0o600});
   await run('/usr/bin/sips',['-Z','640','-s','format','jpeg','-s','formatOptions','78',poster,'--out',thumb],{timeout:15000,maxBuffer:65536});
   await writeFile(thumb,withoutMetadata(await readFile(thumb)),{mode:0o600});await chmod(movie,0o600);
   if(kind==='gif'&&bytes+info.size+(await lstat(poster)).size+(await lstat(thumb)).size>MAX_STORAGE)throw Error('image-limit');
   await rename(movie,join(folder,id+'.'+extension));await rename(poster,join(folder,id+'.jpg'));await rename(thumb,join(folder,id+'-thumb.jpg'));
   return{id,name:String(name).replace(/\.(jpe?g|png|webp|gif|mp4|m4v|mov)$/i,'').replace(/[\u0000-\u001f]/g,'').trim().slice(0,80)||'Custom background',width:dimensions.width,height:dimensions.height,createdAt:Date.now(),archived:false,mediaType:kind,mediaExtension:extension,...(kind==='video'&&typeof result.hasAudio==='boolean'?{hasAudio:result.hasAudio}:{})};
  }catch(error){for(const suffix of ['.jpg','-thumb.jpg','.gif','.mp4'])await rm(join(folder,id+suffix),{force:true}).catch(()=>{});if(/^image-/.test(error.message))throw error;throw Error('image-decode')}
  finally{await rm(temp,{recursive:true,force:true})}
 }
 async function readMedia(id,extension,range){
  if(!folder||!validCustomID(id)||!['gif','mp4'].includes(extension))throw Error('image-not-found');
  const handle=await open(join(folder,id+'.'+extension),constants.O_RDONLY|constants.O_NOFOLLOW);
  let streaming=false;try{
   const info=await handle.stat();if(!info.isFile()||!Number.isSafeInteger(info.size)||info.size<1||extension==='gif'&&info.size>MAX_IMAGE_BYTES+32)throw Error('image-not-found');
   // Also honor infinite playback for GIFs imported by an earlier version.
   // Serve normalized bytes without rewriting the user's existing files.
   const gif=extension==='gif'?infiniteGif(await handle.readFile()):null;
   const selected=mediaRange(gif?.length??info.size,range);if(selected.status===416)return{buffer:Buffer.alloc(0),...selected};
   if(gif)return{buffer:gif.subarray(selected.start,selected.end+1),...selected};
   if(selected.end-selected.start+1>4*1024*1024){streaming=true;const stream=handle.createReadStream({start:selected.start,end:selected.end,autoClose:true});return{stream,...selected}}
   const buffer=Buffer.alloc(selected.end-selected.start+1);let offset=0;while(offset<buffer.length){const r=await handle.read(buffer,offset,buffer.length-offset,selected.start+offset);if(!r.bytesRead)throw Error('image-not-found');offset+=r.bytesRead}return{buffer,...selected};
  }finally{if(!streaming)await handle.close()}
 }
 async function read(id,thumbnail=false){
  if(!folder||!validCustomID(id))throw Error('image-not-found');
  const path=join(folder,id+(thumbnail?'-thumb':'')+'.jpg'),info=await lstat(path);
  if(!info.isFile()||info.isSymbolicLink()||info.size>8*1024*1024)throw Error('image-not-found');return readFile(path);
 }
 async function discard(id){if(!folder||!validCustomID(id))return;for(const suffix of ['.jpg','-thumb.jpg','.gif','.mp4'])await rm(join(folder,id+suffix),{force:true})}
 async function evict(id){if(folder&&validCustomID(id))for(const ext of ['mp4','gif','webm'])await rm(join(folder,id+'.'+ext),{force:true})}
 async function cached(id,extension='mp4'){try{if(!validCustomID(id)||!['mp4','gif'].includes(extension))return false;const info=await lstat(join(folder,id+'.'+extension));return info.isFile()&&!info.isSymbolicLink()&&info.size>0}catch{return false}}
 return{importImage,importVideoFile:(file,name,options)=>importMedia(file,name,'video',options),read,readMedia,discard,evict,cached};
}

export function backgroundMediaKind(buffer){
 if(!Buffer.isBuffer(buffer)||buffer.length<12) return null;
 const gif=['GIF87a','GIF89a'].includes(buffer.toString('ascii',0,6)),video=['ftyp','moov','mdat','wide'].includes(buffer.toString('ascii',4,8));
 if(!gif&&!video)return null;
 if(buffer.length>(gif?MAX_IMAGE_BYTES:MAX_MEDIA_BYTES))throw Error('image-size');
 return gif?'gif':'video';
}
// Change only application-loop metadata. Re-encoding GIF frames can alter
// optimized frame offsets, disposal, colors or timing, so retain their bytes.
export function infiniteGif(buffer){
 if(!Buffer.isBuffer(buffer)||buffer.length<14||buffer.length>MAX_IMAGE_BYTES+32||!['GIF87a','GIF89a'].includes(buffer.toString('ascii',0,6)))throw Error('image-decode');
 let offset=13+((buffer[10]&128)?3*(1<<((buffer[10]&7)+1)):0),frames=0;
 if(offset>=buffer.length)throw Error('image-decode');
 const header=Buffer.from(buffer.subarray(0,offset));header.write('GIF89a');
 const loop=Buffer.from([33,255,11,...Buffer.from('NETSCAPE2.0'),3,1,0,0,0]),parts=[header,loop];
 const blocks=()=>{while(offset<buffer.length){const length=buffer[offset++];if(!length)return;if(offset+length>buffer.length)throw Error('image-decode');offset+=length}throw Error('image-decode')};
 while(offset<buffer.length){
  const start=offset,marker=buffer[offset++];
  if(marker===59){if(!frames)throw Error('image-decode');parts.push(buffer.subarray(start));return Buffer.concat(parts)}
  if(marker===33){
   if(offset>=buffer.length)throw Error('image-decode');const label=buffer[offset++];
   const app=label===255&&buffer[offset]===11?buffer.toString('ascii',offset+1,offset+12):'';
   blocks();if(!['NETSCAPE2.0','ANIMEXTS1.0'].includes(app))parts.push(buffer.subarray(start,offset));
  }else if(marker===44){
   if(offset+9>buffer.length)throw Error('image-decode');const packed=buffer[offset+8];offset+=9+((packed&128)?3*(1<<((packed&7)+1)):0);
   if(offset>=buffer.length)throw Error('image-decode');offset++;blocks();frames++;parts.push(buffer.subarray(start,offset));
  }else throw Error('image-decode');
 }
 throw Error('image-decode');
}
export function mediaRange(size,value){
 const headers={'Accept-Ranges':'bytes'};if(!Number.isSafeInteger(size)||size<1)throw Error('image-not-found');
 if(!value)return{status:200,start:0,end:size-1,headers:{...headers,'Content-Length':String(size)}};
 const match=/^bytes=(\d*)-(\d*)$/.exec(value);let start=0,end=size-1;
 if(!match||(!match[1]&&!match[2]))return{status:416,headers:{...headers,'Content-Range':'bytes */'+size}};
 if(!match[1]){const suffix=Number(match[2]);if(!Number.isSafeInteger(suffix)||suffix<=0)return{status:416,headers:{...headers,'Content-Range':'bytes */'+size}};start=Math.max(0,size-suffix)}
 else{start=Number(match[1]);if(match[2])end=Math.min(size-1,Number(match[2]))}
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start)return{status:416,headers:{...headers,'Content-Range':'bytes */'+size}};
 return{status:206,start,end,headers:{...headers,'Content-Length':String(end-start+1),'Content-Range':`bytes ${start}-${end}/${size}`}};
}
async function prepareMedia({kind,source,poster,output}){
 const bundle=process.env.MOLE_GUI_APP_BUNDLE;if(!bundle)throw Error('image-decode');
 const result=await run(join(bundle,'Contents/MacOS/Oasis'),['--prepare-weather-media',kind,source,poster,output],{timeout:615000,maxBuffer:65536});
 return JSON.parse(result.stdout);
}
