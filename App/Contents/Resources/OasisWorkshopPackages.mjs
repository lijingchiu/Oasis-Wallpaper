import http from 'node:http';
import {readFile,readdir,lstat,mkdir,copyFile,rm,open,chmod} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,dirname,extname,resolve,sep} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {randomBytes} from 'node:crypto';
import {validCustomID,mediaRange,validateWallpaperProperties} from './OasisWeatherImages.mjs';
import {workshopFileBridge} from './OasisWorkshopBridge.mjs';
import {workshopCSSStream} from './OasisWorkshopCSS.mjs';
import {workshopRuntime} from './OasisWorkshopRuntime.mjs';
const health=await readFile(new URL('./OasisWallpaperHealth.js',import.meta.url),'utf8');

export const safePackagePath=value=>typeof value==='string'&&value.length>0&&value.length<=1024&&!/[\\:\u0000-\u001f]/.test(value)&&!value.startsWith('/')&&value.split('/').every(x=>x&&x!=='.'&&x!=='..'&&x.toLowerCase()!=='.depotdownloader');
export async function readWorkshopManifest(folder){
 const file=await open(join(folder,'project.json'),constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const stat=await file.stat();if(!stat.isFile()||stat.size>8*1024*1024)throw Error('workshop-files');const project=JSON.parse((await file.readFile('utf8')).replace(/^\uFEFF/,''));if(!project||typeof project!=='object'||Array.isArray(project))throw Error('workshop-format');return project}finally{await file.close()}
}
export function isWorkshopPreset(project){return !!(project&&project.dependency&&project.preset&&typeof project.preset==='object'&&!Array.isArray(project.preset)&&(!project.type||String(project.type).toLowerCase()==='preset'||!project.file))}
export async function workshopProject(folder){
 const project=await readWorkshopManifest(folder);project.type=isWorkshopPreset(project)?'preset':String(project.type||'').toLowerCase();if(typeof project.file==='string')project.file=project.file.replace(/\\/g,'/');if(project.type==='preset')return project;if(!['video','web','scene'].includes(project.type)||!safePackagePath(project.file))throw Error('workshop-format');return project;
}
export async function workshopPackageFile(root,relative){
 if(!safePackagePath(relative))throw Error('workshop-files');
 let path=root;const parts=relative.split('/');
 try{for(let i=0;i<parts.length;i++){path=join(path,parts[i]);const info=await lstat(path);if(info.isSymbolicLink())throw Error('workshop-files');if(i<parts.length-1&&!info.isDirectory())return null;if(i===parts.length-1&&!info.isFile())return null}return path}catch(error){if(error.code==='ENOENT')return null;throw error}
}
async function copyTree(from,to,depth=0){
 if(depth>24)throw Error('workshop-files');await mkdir(to,{recursive:true,mode:0o700});
 for(const name of await readdir(from)){if(name==='.DepotDownloader')continue;const source=join(from,name),target=join(to,name),stat=await lstat(source);if(stat.isSymbolicLink())throw Error('workshop-files');if(stat.isDirectory())await copyTree(source,target,depth+1);else if(stat.isFile()){await copyFile(source,target,constants.COPYFILE_EXCL|constants.COPYFILE_FICLONE);await chmod(target,0o600)}else throw Error('workshop-files')}
}
const types={'.html':'text/html; charset=utf-8','.htm':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.wasm':'application/wasm','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.svg':'image/svg+xml','.mp4':'video/mp4','.webm':'video/webm','.ogg':'audio/ogg','.mp3':'audio/mpeg','.wav':'audio/wav','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.otf':'font/otf','.glsl':'text/plain; charset=utf-8','.txt':'text/plain; charset=utf-8'};
const policy="default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https: blob:; style-src 'self' 'unsafe-inline' https:; img-src 'self' https: data: blob:; media-src 'self' https: blob:; connect-src 'self' https:; font-src 'self' https: data:; worker-src 'self' blob:; frame-src 'self' https:; object-src 'none'; base-uri 'self'; form-action 'none'";
const bridge='<script>'+workshopRuntime+'</script>';

// A separate origin is essential: a wallpaper's scripts can access only their
// own files and cannot read Oasis state, credentials or its native bridge.
export function createWorkshopPackages({settingsPath,images,fetchImpl=globalThis.fetch,userFiles=null}={}){
 const folder=join(dirname(settingsPath),'weather-packages'),token=randomBytes(24).toString('hex');let origin=null,webServer=null,records=()=>[];
 function setRecords(provider){records=provider}
 const url=row=>origin&&row?.mediaType==='web'&&row.cached!==false?origin+'/'+token+'/'+row.id+'/'+row.entry.split('/').map(encodeURIComponent).join('/'):null;
 async function start(){if(webServer)return;webServer=http.createServer(async(req,res)=>{
  const fail=()=>{if(!res.headersSent){res.writeHead(404);res.end()}else res.destroy()};let file;
  try{
   if(!['GET','HEAD'].includes(req.method)||req.headers.host!==new URL(origin).host)return fail();
   const requestURL=new URL(req.url,origin),path=requestURL.pathname.split('/');if(path[1]!==token||!validCustomID(path[2]))return fail();const id=path[2],row=records().find(x=>x.id===id&&x.mediaType==='web'&&x.cached!==false);if(!row)return fail();
   const relative=path.slice(3).map(decodeURIComponent).join('/');if(!safePackagePath(relative))return fail();
   const root=resolve(folder,id);if((await lstat(root)).isSymbolicLink())return fail();if(relative.startsWith('_oasis/directory/')){const key=relative.slice(17),property=row.properties?.[key],choice=requestURL.searchParams.get('selection');if(choice!==null&&choice!=='none'&&!/^[a-f0-9]{32}$/.test(choice))return fail();const selected=choice==='none'?null:await userFiles?.directory(row,key,choice?{token:choice}:{});const list=selected??await directoryFiles(root,property);const body=JSON.stringify(list);res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:body);return}let target=root,stat;
   if(relative.startsWith('_oasis/user/')){if(!userFiles)return fail();const selected=await userFiles.openAsset(row,relative);file=selected.handle;target=selected.path;stat=selected.stat}
   else{for(const part of relative.split('/')){target=join(target,part);if((await lstat(target)).isSymbolicLink())return fail()}if(!target.startsWith(root+sep))return fail();file=await open(target,constants.O_RDONLY|constants.O_NOFOLLOW);stat=await file.stat();if(!stat.isFile())return fail()}
   const type=types[extname(target).toLowerCase()]||'application/octet-stream';
   const headers={'Content-Type':type,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':policy,'Permissions-Policy':'camera=(), microphone=(), geolocation=(), display-capture=(), clipboard-read=(), clipboard-write=(), payment=(), usb=()','Referrer-Policy':'no-referrer'};
   if(stat.size===0){res.writeHead(200,{...headers,'Content-Length':'0'});res.end()}
   else if(type.startsWith('text/css')){res.writeHead(200,headers);if(req.method==='HEAD')res.end();else{const stream=file.createReadStream({autoClose:true});file=null;await pipeline(stream,workshopCSSStream(origin+'/'+token+'/'+id+'/'),res)}}
   else if(type.startsWith('text/html')){
    const script=Buffer.from('<script>'+health+'</script><script>'+workshopFileBridge+'</script>'+bridge);res.writeHead(200,{...headers,'Content-Length':String(stat.size+script.length)});
    if(req.method==='HEAD')res.end();else{
     const prefix=Buffer.alloc(Math.min(stat.size,65536));await file.read(prefix,0,prefix.length,0);const ascii=prefix.toString('latin1'),head=/<head(?:\s[^>]*)?>/i.exec(ascii),doctype=/<!doctype[^>]*>/i.exec(ascii),at=head?head.index+head[0].length:doctype?doctype.index+doctype[0].length:0;
     const body=Buffer.concat([prefix.subarray(0,at),script,prefix.subarray(at)]);if(prefix.length===stat.size)res.end(body);else{res.write(body);const stream=file.createReadStream({start:prefix.length,autoClose:true});file=null;await pipeline(stream,res)}
    }
   }else{
    const range=mediaRange(stat.size,req.headers.range);res.writeHead(range.status,{...headers,...range.headers});if(req.method==='HEAD'||range.status===416)res.end();else{const stream=file.createReadStream({start:range.start,end:range.end,autoClose:true});file=null;await pipeline(stream,res)}
   }
  }catch{fail()}finally{await file?.close().catch(()=>{})}
 });await new Promise((yes,no)=>{webServer.once('error',no);webServer.listen(0,'127.0.0.1',yes)});origin='http://127.0.0.1:'+webServer.address().port;webServer.unref();}
 async function prepare(source,item,{replace=false}={}){
  const project=await workshopProject(source);if(!['web','scene'].includes(project.type))throw Error('workshop-format');
  const input=resolve(source),extension=extname(project.file),archive=(extension?project.file.slice(0,-extension.length):project.file)+'.pkg';
  // Standard Scene packages name scene.json inside scene.pkg. The renderer mounts
  // that archive; it must not require the virtual JSON entry to exist on disk.
  let entry=await workshopPackageFile(input,project.file);if(!entry&&project.type==='scene')entry=await workshopPackageFile(input,archive);if(!entry)throw Error('workshop-files');
  let row=null;
  for(const name of [...new Set([project.preview,'preview.jpg','preview.png','preview.gif'].filter(x=>typeof x==='string'&&safePackagePath(x)))]){
   try{const file=await workshopPackageFile(input,name);if(file&&(await lstat(file)).size<20*1024*1024){row=await images.importImage(await readFile(file),item.title,{replace,posterOnly:true});break}}catch(error){if(!/^(image-|ENOENT)/.test(error.message)&&error.code!=='ENOENT')throw error}
  }
  if(!row&&item.preview){try{const u=new URL(item.preview);if(u.protocol==='https:'&&['images.steamusercontent.com','steamuserimages-a.akamaihd.net','shared.akamai.steamstatic.com'].includes(u.hostname)){const r=await fetchImpl(u,{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(15000)});let size=0,parts=[];if(r.ok){for await(const chunk of r.body){size+=chunk.length;if(size>20*1024*1024)throw Error('workshop-preview');parts.push(chunk)}row=await images.importImage(Buffer.concat(parts),item.title,{replace,posterOnly:true})}}}catch(error){if(error.message==='image-limit'||error.message==='image-storage')throw error}}
  // Cover artwork is optional. Never reject a working renderer because its
  // preview is absent, corrupt, unsupported, or temporarily unavailable online.
  if(!row){const placeholder=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');row=await images.importImage(placeholder,item.title,{replace,posterOnly:true})}
  await images.evict(row.id);const target=join(folder,row.id);try{await copyTree(source,target);return{...row,mediaType:project.type,entry:project.file,workshopID:item.id,sourceBytes:item.size,cached:true,properties:properties(project)}}catch(error){await images.discard(row.id).catch(()=>{});await rm(target,{recursive:true,force:true});throw error}
 }
 const properties=project=>validateWallpaperProperties(project.general?.properties);
 async function evict(id){if(validCustomID(id))await rm(join(folder,id),{recursive:true,force:true})}
 const source=id=>validCustomID(id)?join(folder,id):null;
 async function cached(row){try{const root=join(folder,row.id);if((await lstat(root)).isSymbolicLink())return false;const project=await workshopProject(root);if(project.type==='web'&&!await workshopPackageFile(root,row.entry))return false;row.properties=properties(project);const extension=extname(project.file),archive=(extension?project.file.slice(0,-extension.length):project.file)+'.pkg';return !!(await workshopPackageFile(root,project.file)||project.type==='scene'&&await workshopPackageFile(root,archive))}catch{return false}}
 return{start,origin:()=>origin,close:()=>webServer?.close(),setRecords,url,prepare,evict,source,cached};
}

async function directoryFiles(root,property){
 if(property?.type!=='directory'||!safePackagePath(property.value))return[];
 let folder=root;for(const part of property.value.split('/')){folder=join(folder,part);const info=await lstat(folder);if(info.isSymbolicLink()||!info.isDirectory())throw Error('workshop-files')}
 const extensions=property.filetype==='videos'?['.webm','.ogg','.ogv','.mp4','.m4v','.mov']:['.jpeg','.jpg','.png','.pnga','.bmp','.gif','.svg','.webp'];
 const files=[];async function scan(path,prefix,depth=0){if(depth>24)throw Error('workshop-files');for(const entry of await readdir(path,{withFileTypes:true})){if(entry.name==='.DepotDownloader')continue;const relative=prefix+'/'+entry.name;if(entry.isSymbolicLink())throw Error('workshop-files');if(entry.isDirectory())await scan(join(path,entry.name),relative,depth+1);else if(entry.isFile()&&extensions.includes(extname(entry.name).toLowerCase()))files.push(relative);if(files.length>50000)throw Error('workshop-files')}}
 await scan(folder,property.value);return files.sort();
}
