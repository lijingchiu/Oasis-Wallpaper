import {readdir,lstat,mkdir,mkdtemp,copyFile,writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,dirname} from 'node:path';
import {workshopProject,safePackagePath} from './OasisWorkshopPackages.mjs';

export function presetDependencyID(value){
 if(Array.isArray(value)){if(value.length!==1)throw Error('workshop-dependency');value=value[0]}
 if(typeof value==='number'){if(!Number.isSafeInteger(value))throw Error('workshop-dependency');value=String(value)}
 if(typeof value!=='string'||!/^[1-9][0-9]{0,19}$/.test(value)||BigInt(value)>18446744073709551615n)throw Error('workshop-dependency');
 return value;
}
async function copyAssets(from,to,{overlay=false,skipManifest=false}={},depth=0){
 if(depth>24)throw Error('workshop-files');await mkdir(to,{recursive:true,mode:0o700});
 for(const name of await readdir(from)){
  if(name==='.DepotDownloader'||skipManifest&&depth===0&&name==='project.json')continue;
  const source=join(from,name),target=join(to,name),info=await lstat(source);
  if(info.isSymbolicLink())throw Error('workshop-files');
  if(info.isDirectory())await copyAssets(source,target,{overlay},depth+1);
  else if(info.isFile())await copyFile(source,target,constants.COPYFILE_FICLONE|(overlay?0:constants.COPYFILE_EXCL));
  else throw Error('workshop-files');
 }
}
async function checkPresetFile(root,relative,type){
 if(!safePackagePath(relative))throw Error('workshop-preset-files');let file=root;
 for(const part of relative.split('/')){file=join(file,part);const info=await lstat(file).catch(error=>{if(error.code==='ENOENT')return null;throw error});if(!info)return false;if(info.isSymbolicLink())throw Error('workshop-preset-files')}
 const info=await lstat(file);if(type==='file'&&!info.isFile()||type==='directory'&&!info.isDirectory())throw Error('workshop-preset-files');return true;
}
export function mergePresetProperties(base,preset){
 const rows=base&&typeof base==='object'&&!Array.isArray(base)?base:{};
 return Object.fromEntries(Object.entries(rows).map(([key,row])=>{
  if(!row||typeof row!=='object'||Array.isArray(row))return[key,row];
  const value=preset?.[key];if(value===null||!['boolean','number','string'].includes(typeof value)||typeof value==='number'&&!Number.isFinite(value))return[key,row];
  return[key,{...row,value}];
 }));
}
// Presets contain overrides and imported files; their dependency owns the renderer.
// The download callback must verify each dependency belongs to Wallpaper Engine.
export async function resolveWorkshopPackage(source,item,{downloadDependency,maxDepth=8}={}){
 const downloaded=new Map(),dependencies=[],warnings=[];
 async function resolve(folder,metadata,parents,depth){
  if(depth>maxDepth)throw Error('workshop-dependency-depth');
  const project=await workshopProject(folder);if(project.type!=='preset')return{folder,project};
  const id=presetDependencyID(project.dependency);if(parents.has(id)||id===String(metadata.id))throw Error('workshop-dependency-cycle');
  if(typeof downloadDependency!=='function')throw Error('workshop-dependency');
  if(!downloaded.has(id)){const result=await downloadDependency(id);if(!result?.folder||String(result.item?.id)!==id)throw Error('workshop-dependency');downloaded.set(id,result);dependencies.push({id,title:result.item.title,size:result.item.size})}
  const dependency=downloaded.get(id),next=new Set(parents);next.add(String(metadata.id));
  const base=await resolve(dependency.folder,dependency.item,next,depth+1),target=await mkdtemp(join(dirname(source),'resolved-'));
  await copyAssets(base.folder,target);await copyAssets(folder,target,{overlay:true,skipManifest:true});
  const properties=mergePresetProperties(base.project.general?.properties,project.preset);
  for(const [key,value] of Object.entries(project.preset)){
   const row=properties[key];if(row&&['file','directory'].includes(row.type)&&typeof value==='string'&&value){row.value=value.replace(/\\/g,'/');if(!await checkPresetFile(target,row.value,row.type)){const original=base.project.general?.properties?.[key]?.value;row.value=typeof original==='string'&&original&&await checkPresetFile(target,original,row.type)?original:'';warnings.push({kind:'missing-preset-asset',property:key});}}
  }
  // Preserve the renderer author's identity; the imported Oasis row owns the preset title/ID.
  const merged={...base.project,general:{...base.project.general,properties},...(typeof project.preview==='string'?{preview:project.preview}:{})};
  delete merged.dependency;delete merged.preset;
  await writeFile(join(target,'project.json'),JSON.stringify(merged),{mode:0o600});return{folder:target,project:merged};
 }
 const result=await resolve(source,item,new Set(),0);return{...result,dependencies,warnings};
}
