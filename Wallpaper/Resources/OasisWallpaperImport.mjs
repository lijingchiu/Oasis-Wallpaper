// One-time, copy-on-write import. Never modify the existing Oasis library or
// silently overwrite the standalone app's settings. If cloning is unsupported,
// fail safely rather than duplicating arbitrarily large media files.
import {lstat,mkdir,mkdtemp,readFile,readdir,rename,rm,rmdir,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);

export async function importOasisLibrary({source,destination,cloneTree=async(from,to)=>{const bundle=process.env.MOLE_GUI_APP_BUNDLE;if(!bundle)throw Error('import-unavailable');await run(join(bundle,'Contents/MacOS/Oasis'),['--clone-wallpaper-tree',from,to],{timeout:300000,maxBuffer:8192})}}){
 let stage=null;
 try{
  const target=await lstat(destination).catch(error=>error.code==='ENOENT'?null:Promise.reject(error));
  if(target&&(!target.isDirectory()||target.isSymbolicLink()||(await readdir(destination)).length))throw Error('already-configured');
  const settings=JSON.parse(await readFile(join(source,'oasis-weather.json'),'utf8'));
  if(!settings||typeof settings!=='object'||!settings.settings||typeof settings.settings!=='object')throw Error('source-invalid');
  settings.settings.desktop={...settings.settings.desktop,enabled:false};
  await mkdir(dirname(destination),{recursive:true,mode:0o700});stage=await mkdtemp(join(dirname(destination),'.oasis-wallpaper-import-'));
  let count=0;
  async function validateTree(from,depth=0){
   const info=await lstat(from);if(info.isSymbolicLink()||++count>200000)throw Error('source-invalid');
   if(depth>48)throw Error('source-invalid');if(info.isDirectory()){for(const name of await readdir(from))await validateTree(join(from,name),depth+1);return}
   if(!info.isFile())throw Error('source-invalid');
  }
  for(const name of ['weather-images','weather-packages','weather-city','scene-assets','weather-wallpaper-files.json']){
   const path=join(source,name),info=await lstat(path).catch(error=>error.code==='ENOENT'?null:Promise.reject(error));if(info){await validateTree(path);await cloneTree(path,join(stage,name))}
  }
  await writeFile(join(stage,'oasis-weather.json'),JSON.stringify(settings),{mode:0o600,flag:'wx'});
  if(target)await rmdir(destination);await rename(stage,destination);stage=null;return{ok:true};
 }catch(error){const message=['ENOENT','source-invalid'].includes(error.code||error.message)?'source-unavailable':error.message==='already-configured'?'already-configured':'import-unavailable';return{ok:false,error:message}}
 finally{if(stage)await rm(stage,{recursive:true,force:true}).catch(()=>{})}
}
