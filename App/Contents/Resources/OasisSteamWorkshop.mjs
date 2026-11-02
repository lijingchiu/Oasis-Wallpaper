// A Workshop link identifies content, not its original download. Steam performs
// entitlement checks in a separate, memory-only DepotDownloader helper.
import {writeFile,mkdir,mkdtemp,rm,readdir,lstat,open,statfs} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,dirname,resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,randomInt} from 'node:crypto';
import {spawn} from 'node:child_process';
import {setTimeout as retryDelay} from 'node:timers/promises';
import {backgroundMediaKind} from './OasisWeatherImages.mjs';
import {resolveWorkshopPackage} from './OasisWorkshopPresets.mjs';

const APP='431960',MAX_JSON=1024*1024;
const activeStages=new Set(['preparing','connecting','authorization','downloading','importing']);
export function workshopID(value){
 if(typeof value!=='string'||value.length>2048)throw Error('workshop-link');
 let url;try{url=new URL(value.trim())}catch{throw Error('workshop-link')}
 const id=url.searchParams.get('id');
 if(url.protocol!=='https:'||url.hostname!=='steamcommunity.com'||url.port||url.username||url.password||!/^\/(?:sharedfiles|workshop)\/filedetails\/?$/.test(url.pathname)||!id||!/^[1-9][0-9]{0,19}$/.test(id)||BigInt(id)>18446744073709551615n)throw Error('workshop-link');
 return id;
}
const canonical=id=>'https://steamcommunity.com/sharedfiles/filedetails/?id='+id;
export function workshopMetadata(raw,id){
 if(String(raw?.publishedfileid)!==id||raw.result!==1||String(raw.consumer_app_id)!==APP||raw.banned)throw Error('workshop-unavailable');
 const tags=(raw.tags||[]).map(x=>String(x.tag||'').toLowerCase()),kind=tags.includes('preset')?'preset':tags.includes('video')?'video':tags.includes('scene')?'scene':tags.includes('web')?'web':'unsupported';
 const size=Number(raw.file_size);
 if(!Number.isSafeInteger(size)||size<=0)throw Error('workshop-unavailable');
 let preview=null;try{const u=new URL(raw.preview_url);if(u.protocol==='https:'&&!u.username&&!u.password&&['images.steamusercontent.com','steamuserimages-a.akamaihd.net','shared.akamai.steamstatic.com'].includes(u.hostname))preview=u.href}catch{}
 const manifest=typeof raw.hcontent_file==='string'?raw.hcontent_file:Number.isSafeInteger(raw.hcontent_file)?String(raw.hcontent_file):'';
 return{id,url:canonical(id),...(/^[1-9][0-9]{0,19}$/.test(manifest)&&BigInt(manifest)<=18446744073709551615n?{manifest}:{}),title:String(raw.title||'Steam Workshop').replace(/[\u0000-\u001f]/g,'').slice(0,160),kind,size,preview,supported:['video','web','scene','preset'].includes(kind)};
}
async function boundedJSON(response){
 if(!response.ok)throw Error('workshop-unavailable');
 let bytes=0,parts=[];for await(const part of response.body){bytes+=part.length;if(bytes>MAX_JSON)throw Error('workshop-unavailable');parts.push(part)}
 return JSON.parse(Buffer.concat(parts).toString('utf8'));
}
export function safeWorkshopFile(value){
 return typeof value==='string'&&value.length<600&&!value.includes('\\')&&!value.includes(':')&&!value.includes('\0')&&!value.startsWith('/')&&value.split('/').every(x=>x&&x!=='.'&&x!=='..'&&!x.startsWith('.'))&&['.mp4','.m4v','.mov'].includes(extname(value).toLowerCase());
}
async function treeBytes(folder,depth=0){
 if(depth>24)throw Error('workshop-files');let bytes=0,count=0;
 for(const entry of await readdir(folder,{withFileTypes:true})){
  if(++count>50000)throw Error('workshop-files');const path=join(folder,entry.name),info=await lstat(path);
  if(info.isSymbolicLink())throw Error('workshop-files');
  if(info.isFile())bytes+=info.size;else if(info.isDirectory())bytes+=await treeBytes(path,depth+1);else throw Error('workshop-files');
  if(!Number.isSafeInteger(bytes))throw Error('workshop-size');
 }return bytes;
}
export async function workshopVideo(folder){
 // Do not guess based on previews or on the first video in an arbitrary folder.
 const root=resolve(folder),project=await open(join(root,'project.json'),constants.O_RDONLY|constants.O_NOFOLLOW);
 let body;try{const info=await project.stat();if(!info.isFile()||info.size>8*1024*1024)throw Error('workshop-files');body=JSON.parse((await project.readFile('utf8')).replace(/^\uFEFF/,''));if(typeof body.file==='string')body.file=body.file.replace(/\\/g,'/')}finally{await project.close()}
 if(String(body.type).toLowerCase()!=='video')throw Error('workshop-format');
 if(!safeWorkshopFile(body.file))throw Error('workshop-files');
 const path=resolve(root,body.file);if(!path.startsWith(root+sep))throw Error('workshop-files');
 let current=root;for(const piece of body.file.split('/')){current=join(current,piece);if((await lstat(current)).isSymbolicLink())throw Error('workshop-files')}
 const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const info=await handle.stat();if(!info.isFile()||info.size<12||!Number.isSafeInteger(info.size))throw Error('workshop-size');const buffer=Buffer.alloc(16);await handle.read(buffer,0,16,0);if(backgroundMediaKind(buffer)!=='video')throw Error('workshop-codec');return path}finally{await handle.close()}
}
export function createSteamWorkshop({path,importImage,fetchImpl=globalThis.fetch,spawnImpl=spawn,now=Date.now,helperPath,jobTimeout=1800000,checkSpace=true}={}){
 const helper=helperPath||fileURLToPath(new URL('./WorkshopHelper/'+(process.arch==='arm64'?'arm64':'x64')+'/DepotDownloader',import.meta.url));
 const base=path?join(dirname(path),'workshop-downloads'):null,cache=new Map();let current=null,session=null,credentialUpdate=null,credentialSaved=false,nativeConnected=false,restoreStatus=null;
 const validCredential=c=>c&&typeof c.account==='string'&&c.account.length>0&&c.account.length<=128&&!/[\u0000-\u001f]/.test(c.account)&&typeof c.token==='string'&&/^[A-Za-z0-9._~-]{20,16000}$/.test(c.token);
 function credentials(c){if(validCredential(c))session={account:c.account,token:c.token};return !!session}
 function nativeCredentials(body){nativeConnected=true;if(Number.isInteger(body?.restoreStatus))restoreStatus=body.restoreStatus;if(body?.credentials&&!credentialUpdate&&credentials(body.credentials))credentialSaved=true;if(body?.storedGeneration&&credentialUpdate?.generation===body.storedGeneration){credentialSaved=body.stored===true;if(body.stored===true)credentialUpdate=null}return{ok:true,update:credentialUpdate,signedIn:!!session}}
 async function inspect(value){
  const id=workshopID(value),hit=cache.get(id);if(hit&&now()-hit.at<300000)return hit.item;
  const body=new URLSearchParams({'itemcount':'1','publishedfileids[0]':id});
  const response=await fetchImpl('https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},body,credentials:'omit',redirect:'error',signal:AbortSignal.timeout(15000)});
  const data=await boundedJSON(response),item=workshopMetadata(data.response?.publishedfiledetails?.[0],id);if(cache.size>100)cache.clear();cache.set(id,{at:now(),item});return item;
 }
 function view(){if(!current)return null;const {id,item,stage,error,progress,qr,startedAt,reason,attempt,failureStage,preparingAssets,dependency,target}=current;return{id,item,stage,error,progress,qr,startedAt,attempt,...(target?{target}:{}),...(dependency?{dependency}:{}),...(preparingAssets?{preparingAssets:true}:{}),...(reason?{reason}:{}),...(failureStage?{failureStage}:{})}}
 function cancel(){if(!current||!activeStages.has(current.stage)||current.stage==='importing')return view();const job=current;job.cancelled=true;job.stage='cancelled';job.qr=null;job.abort.abort();if(job.child&&!job.closed){job.child.kill('SIGTERM');const child=job.child;job.killTimer=setTimeout(()=>{if(!job.closed)child.kill('SIGKILL')},2000);job.killTimer.unref?.()}return view()}
 async function download(value,target=null){
  if(current&&activeStages.has(current.stage))throw Error('workshop-busy');
  if(target!==null&&(!target||typeof target!=='object'||Array.isArray(target)||typeof target.screen!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(target.screen)||typeof target.expected!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(target.expected)||('enable' in target&&typeof target.enable!=='boolean')||('expectedEnabled' in target&&typeof target.expectedEnabled!=='boolean')||('displays' in target&&(!Array.isArray(target.displays)||target.displays.length>32||target.displays.some(id=>typeof id!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(id))))))throw Error('workshop-target');
  const item=await inspect(value);if(!['video','web','scene','preset'].includes(item.kind))throw Error('workshop-format');
  if(!base||typeof importImage!=='function')throw Error('workshop-storage');
  const info=await lstat(helper).catch(()=>null);if(!info?.isFile()||info.isSymbolicLink())throw Error('workshop-helper');
  await mkdir(base,{recursive:true,mode:0o700});if(checkSpace){const disk=await statfs(base);if(Number(disk.bavail)*Number(disk.bsize)<item.size*3+128*1024*1024)throw Error('workshop-space')}
  // Recheck after metadata/I/O: simultaneous requests cannot start two sessions.
  if(current&&activeStages.has(current.stage))throw Error('workshop-busy');
  const job={id:randomUUID(),item,target:target?{screen:target.screen,expected:target.expected,...(typeof target.enable==='boolean'?{enable:target.enable}:{}),...(typeof target.expectedEnabled==='boolean'?{expectedEnabled:target.expectedEnabled}:{}),...(Array.isArray(target.displays)?{displays:[...target.displays]}:{})}:null,stage:'preparing',error:null,progress:null,qr:null,startedAt:now(),abort:new AbortController(),closed:false,cancelled:false};current=job;
  job.task=runWithRetry(job);return view();
 }
 async function runWithRetry(job){
  let folder;try{
   folder=await mkdtemp(join(base,'job-'));
   for(let attempt=1;attempt<=3;attempt++){
    job.attempt=attempt;job.failureStage=null;job.preparingAssets=false;job.dependency=null;await run(job,folder);
    if(attempt===3||job.stage!=='error'||job.cancelled||!session||!['workshop-network','workshop-download','workshop-integrity'].includes(job.error)||job.failureStage==='importing')return;
    if(job.error==='workshop-integrity'){await rm(join(folder,'content'),{recursive:true,force:true});await rm(join(folder,'dependencies'),{recursive:true,force:true})}
    job.error=null;job.reason=null;job.progress=null;job.stage='connecting';job.closed=false;job.child=null;
    await retryDelay(500*attempt,undefined,{signal:job.abort.signal}).catch(()=>{});if(job.cancelled)return;
   }
  }catch(error){if(!job.cancelled){job.stage='error';job.error=/^workshop-/.test(error.message)?error.message:'workshop-storage'}}
  finally{job.qr=null;if(folder)await rm(folder,{recursive:true,force:true}).catch(()=>{})}
 }
 async function verifyCompletedPackage(job,item,output,folder){
  if(!item.manifest||job.cancelled)return false;
  const child=spawnImpl(helper,['-oasis-verify-package',output,item.manifest],{cwd:folder,stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LANG:'en_US.UTF-8',TMPDIR:folder,DOTNET_BUNDLE_EXTRACT_BASE_DIR:join(folder,'runtime'),DOTNET_CLI_TELEMETRY_OPTOUT:'1',DOTNET_EnableDiagnostics:'0'}});job.child=child;job.closed=false;child.stdin.end();
  let text='',overflow=false;child.stdout.setEncoding('utf8');child.stdout.on('data',part=>{if(text.length+part.length>32768){overflow=true;child.kill('SIGTERM')}else text+=part});child.stderr.resume();
  const timer=setTimeout(()=>child.kill('SIGKILL'),120000);timer.unref?.();
  try{const code=await new Promise(resolve=>{child.once('error',()=>resolve(null));child.once('close',value=>resolve(value))});if(code!==0||overflow||job.cancelled)return false;const result=JSON.parse(text);return result.verified===true&&result.manifest===item.manifest&&Number.isSafeInteger(result.files)&&result.files>0&&Number.isSafeInteger(result.bytes)&&result.bytes>0;}catch{return false}finally{clearTimeout(timer);job.closed=true;}
 }
 async function downloadContent(job,item,output,folder){
  if(job.cancelled)throw Error('workshop-cancelled');
  await mkdir(output,{recursive:true,mode:0o700});
  if(checkSpace){const disk=await statfs(base);if(Number(disk.bavail)*Number(disk.bsize)<item.size*3+128*1024*1024)throw Error('workshop-space')}
  const assets=join(dirname(path),'scene-assets'),needAssets=item.kind==='scene'&&(!await lstat(join(assets,'.ready')).catch(()=>null)||!(await lstat(join(assets,'assets')).catch(()=>null))?.isDirectory());if(needAssets)await mkdir(assets,{recursive:true,mode:0o700});
  job.stage='connecting';job.closed=false;job.preparingAssets=false;job.progress=null;
  const auth=session,args=['-validate','-app',APP,'-pubfile',item.id,...(auth?['-oasis-session-input']:['-qr']),'-remember-password','-loginid',String(randomInt(1,2147483647)),'-dir',output,...(needAssets?['-oasis-assets-dir',assets]:[]),'-max-downloads','4'];
  const child=spawnImpl(helper,args,{cwd:folder,stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LANG:'en_US.UTF-8',TMPDIR:folder,DOTNET_BUNDLE_EXTRACT_BASE_DIR:join(folder,'runtime'),DOTNET_CLI_TELEMETRY_OPTOUT:'1',DOTNET_EnableDiagnostics:'0'}});job.child=child;if(auth)child.stdin.end(JSON.stringify(auth)+'\n');else child.stdin.end();
  let timer,watcher;
  try{
   let failed=null;const parse=raw=>{const line=raw.replace(/\x1b\[[0-9;]*[A-Za-z]/g,'');
    if(line.startsWith('OASIS_EVENT ')){try{const event=JSON.parse(line.slice(12));if(event.kind==='verifying'){job.stage='downloading';job.progress=null}else if(event.kind==='assets'){job.stage='downloading';job.progress=null;job.preparingAssets=true}else if(event.kind==='failure'&&['assets','package'].includes(event.phase)){failed||=event.phase==='assets'?'workshop-assets':'workshop-download';if(typeof event.type==='string'&&/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(event.type))job.reason={...job.reason,helperType:event.type}}else if(event.kind==='session'&&validCredential(event)){session={account:event.account,token:event.token};credentialUpdate={generation:randomUUID(),credentials:session}}else if(event.kind==='qr'&&typeof event.png==='string'&&event.png.length<180000&&/^[A-Za-z0-9+/]+=*$/.test(event.png)){job.stage='authorization';job.qr='data:image/png;base64,'+event.png}}catch{}return}
    const result=/EResult\s+(\d+)\s+\(([A-Za-z0-9_]+)\)/.exec(line);if(result)job.reason={steamCode:Number(result[1]),steamResult:result[2]};
    if(/Workshop integrity verification failed/.test(line))failed='workshop-integrity';
    if(/Unable to locate manifest ID/.test(line))failed='workshop-manifest';
    if(/FileNotFound|file not found|not available in this region/i.test(line))failed='workshop-unavailable';
    if(/timeout|timed out|ServiceUnavailable|TryAnotherCM|NoConnection/i.test(line))failed='workshop-network';
    if(/Logged on|Got .*licenses|Downloading depot|Downloading manifest|Downloading app|Got AppInfo/i.test(line)){job.qr=null;job.stage='downloading'}
    const percentage=/(\d{1,3}\.\d{1,2})%/.exec(line);if(percentage){job.stage='downloading';job.qr=null;job.progress=Math.max(0,Math.min(100,Number(percentage[1])))}
    if(/does not own|required subscription|No subscription|not have access|not have a license|access.?denied|InsufficientPrivilege|NoLicense/i.test(line))failed='workshop-entitlement';
    if(/Failed to authenticate|Failed to log|Logon failed|Expired|InvalidPassword|Revoked|InvalidSignature/i.test(line)){failed='workshop-auth';session=null;credentialUpdate={generation:randomUUID(),clear:true}}
    if(/Insufficient free space/i.test(line))failed='workshop-space';
   };
   const pending={stdout:'',stderr:''};
   for(const name of ['stdout','stderr']){
    child[name].setEncoding('utf8');child[name].on('data',part=>{pending[name]+=part;if(pending[name].length>300000){failed='workshop-output';child.kill('SIGTERM');return}const rows=pending[name].split(/[\r\n]/);pending[name]=rows.pop();for(const row of rows)parse(row)});
   }
   // Only structured events, known error codes and exit status leave this scope.
   // Raw Steam/account output from either stream is never persisted or returned.
   timer=setTimeout(()=>{failed='workshop-timeout';child.kill('SIGTERM');job.killTimer=setTimeout(()=>{if(!job.closed)child.kill('SIGKILL')},2000);job.killTimer.unref?.()},jobTimeout);timer.unref?.();
   let watching=false;watcher=setInterval(async()=>{if(watching||job.closed)return;watching=true;try{await treeBytes(output);if(checkSpace){const disk=await statfs(base);if(Number(disk.bavail)*Number(disk.bsize)<128*1024*1024)throw Error('workshop-space')}}catch(error){if(error.code==='ENOENT'&&(await lstat(output).catch(()=>null))?.isDirectory())return;failed=/^workshop-/.test(error.message)?error.message:'workshop-files';child.kill('SIGTERM')}finally{watching=false}},2000);watcher.unref?.();
   const exit=await new Promise((yes,no)=>{child.once('error',error=>{job.closed=true;no(error)});child.once('close',(code,signal)=>{job.closed=true;yes({code,signal})})});
   job.closed=true;for(const value of Object.values(pending))if(value)parse(value);
   if(job.cancelled)return;
   if(exit.code!==0){const abnormal=exit.signal==='SIGABRT'||exit.code===134;const recovered=abnormal&&!needAssets&&(!failed||['workshop-network','workshop-download'].includes(failed))&&await verifyCompletedPackage(job,item,output,folder);if(!recovered){job.reason={...job.reason,...(Number.isInteger(exit.code)?{helperExitCode:exit.code}:{}),...(typeof exit.signal==='string'&&/^SIG[A-Z0-9]+$/.test(exit.signal)?{helperSignal:exit.signal}:{})};throw Error(failed||'workshop-download')}failed=null;}
   if(failed&&failed!=='workshop-network')throw Error(failed);
   await treeBytes(output);job.qr=null;
   if(needAssets){if(!(await lstat(join(assets,'assets')).catch(()=>null))?.isDirectory())throw Error('workshop-assets');await writeFile(join(assets,'.ready'),'1',{mode:0o600})}
  }finally{clearTimeout(timer);clearTimeout(job.killTimer);clearInterval(watcher)}
 }
 async function run(job,folder){
  try{
   const output=join(folder,'content');await downloadContent(job,job.item,output,folder);if(job.cancelled)return;job.stage='preparing';
   const resolved=await resolveWorkshopPackage(output,job.item,{downloadDependency:async id=>{
    if(job.cancelled)throw Error('workshop-cancelled');const item=await inspect(canonical(id));if(!item.supported)throw Error('workshop-dependency');job.dependency={id,title:item.title,size:item.size};
    const target=join(folder,'dependencies',id);await downloadContent(job,item,target,folder);if(job.cancelled)throw Error('workshop-cancelled');job.stage='preparing';return{folder:target,item};
   }});
   if(job.cancelled)return;job.stage='importing';job.dependency=null;job.preparingAssets=false;
   const total=job.item.size+resolved.dependencies.reduce((sum,row)=>sum+row.size,0);
   await importImage(resolved.folder,job.item.title,{...job.item,size:total},{desktopTarget:job.target});job.stage='complete';job.progress=100;
  }catch(error){if(!job.cancelled){job.failureStage=job.stage;job.stage='error';job.error=/^(workshop-|image-)/.test(error.message)?error.message:['importing','preparing'].includes(job.failureStage)?'workshop-files':'workshop-download';if(error.reason)job.reason={...job.reason,render:String(error.reason).slice(0,600)}}}
 }
 async function action(body={}){
  if(body.action==='inspect')return{ok:true,item:await inspect(body.url),job:view()};
  if(body.action==='download')return{ok:true,job:await download(body.url,body.target??null)};
  if(body.action==='cancel')return{ok:true,job:cancel()};
  if(body.action==='status')return{ok:true,job:view(),signedIn:!!session,remembered:credentialSaved,nativeConnected,restoreStatus};
  if(body.action==='logout'){cancel();session=null;credentialUpdate={generation:randomUUID(),clear:true};return{ok:true,job:view(),signedIn:false}}
  throw Error('workshop-action');
 }
 return{action,inspect,view,cancel,nativeCredentials,settled:()=>current?.task};
}
