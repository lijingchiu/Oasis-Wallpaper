import {mkdtemp,mkdir,open,readFile,rm,stat,statfs} from 'node:fs/promises';
import {join,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
const archiveWorker=fileURLToPath(new URL('./OasisArchive/worker.mjs',import.meta.url));
const archiveImports=new Set();

// Disk-backed uploads share cleanup, short-write handling and free-space checks.
async function stageUpload(stream,{settingsPath,name='',length},filename,consume){
 if(!settingsPath||typeof consume!=='function')throw Error('image-storage');
 const base=join(dirname(settingsPath),'weather-uploads');await mkdir(base,{recursive:true,mode:0o700});
 const available=async()=>{const s=await statfs(base);return Number(s.bavail)*Number(s.bsize)};
 const expected=Number(length);if(Number.isSafeInteger(expected)&&expected>0&&await available()<expected*3+128*1024*1024)throw Error('image-space');
 const folder=await mkdtemp(join(base,'upload-')),source=join(folder,filename);let file,bytes=0,checked=0;
 try{
  file=await open(source,'wx',0o600);
  for await(const chunk of stream){bytes+=chunk.length;if(!Number.isSafeInteger(bytes))throw Error('image-size');
   if(bytes-checked>16*1024*1024){if(await available()<128*1024*1024)throw Error('image-space');checked=bytes}
   let offset=0;while(offset<chunk.length){const out=await file.write(chunk,offset);if(!out.bytesWritten)throw Error('image-storage');offset+=out.bytesWritten}
  }
  await file.close();file=null;if(Number.isSafeInteger(expected)&&expected>0&&bytes!==expected)throw Error('image-decode');
  return await consume(source,name,folder,bytes);
 }finally{await file?.close().catch(()=>{});await rm(folder,{recursive:true,force:true}).catch(()=>{})}
}
export function uploadWeatherVideo(stream,options){
 return stageUpload(stream,options,'source.mp4',options.importFile);
}
export async function uploadWallpaperArchive(stream,{weather,desktopTarget=null,...options}){
 if(archiveImports.has(options.settingsPath))throw Error('image-busy');
 archiveImports.add(options.settingsPath);
 try{return await stageUpload(stream,options,'source.zip',async (source,name,folder,size)=>{
  let result;
  try {
   const {stdout}=await run(process.execPath,[archiveWorker,source,folder],{cwd:folder,env:{LANG:'en_US.UTF-8'},timeout:300000,killSignal:'SIGKILL',maxBuffer:8192});
   result=JSON.parse(stdout);
  }catch(error){
   const reason=typeof error.stderr==='string'?error.stderr.trim():'';
   throw Error(/^(?:image-space|archive-(?:invalid|size|controls|format|executable|rig))$/.test(reason)?reason:error.killed?'archive-size':'archive-invalid');
  }
  const title=basename(name).replace(/\.zip$/i,'').trim()||'Wallpaper';
  if(result.kind==='web'&&result.file==='web')return weather.importWorkshop(join(folder,'web'),title,{title,size,archivePlayer:result.player},{desktopTarget});
  if(!/^media\.(?:mp4|m4v|mov|gif|png|jpe?g|webp)$/i.test(result.file))throw Error('archive-format');
  const file=join(folder,result.file);
  if(result.kind==='video')return weather.importVideoFile(file,title,null,{desktopTarget});
  if(result.kind!=='image')throw Error('archive-format');
  if((await stat(file)).size>20*1024*1024)throw Error('image-size');
  return weather.importImage(await readFile(file),title,{desktopTarget});
 })}finally{archiveImports.delete(options.settingsPath)}
}
