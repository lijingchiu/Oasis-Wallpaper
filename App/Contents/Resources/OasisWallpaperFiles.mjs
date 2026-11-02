// Files are selected explicitly through the native picker. Store references,
// not copies: large user libraries stay where they are, and deleting an Oasis
// wallpaper never deletes or rewrites the user's original files.
import {readFile,writeFile,mkdir,rename,lstat,readdir,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname,basename,extname,isAbsolute,join,resolve,sep} from 'node:path';
import {createHash,randomBytes,randomUUID} from 'node:crypto';

const image=new Set(['.jpg','.jpeg','.png','.pnga','.bmp','.gif','.svg','.webp']);
const video=new Set(['.mp4','.m4v','.mov','.webm','.ogg','.ogv']);
const stable=row=>row?.workshopID?'workshop-'+row.workshopID:row?.id;
const propertyHash=key=>createHash('sha256').update(key).digest('hex').slice(0,32);
const allowed=(file,definition)=>{const ext=extname(file).toLowerCase();return definition?.filetype==='videos'?video.has(ext):definition?.filetype==='images'?image.has(ext):image.has(ext)||video.has(ext)};
const safePart=s=>typeof s==='string'&&s.length>0&&s.length<=255&&s!=='.'&&s!=='..'&&!/[\\/\u0000-\u001f]/.test(s);
const validScope=scope=>scope==='app'||scope==='menu'||typeof scope==='string'&&/^desktop:[A-Za-z0-9_-]{1,80}$/.test(scope)&&!['desktop:__proto__','desktop:prototype','desktop:constructor'].includes(scope);

export function createWallpaperFiles(settingsPath){
 const store=settingsPath?join(dirname(settingsPath),'weather-wallpaper-files.json'):null;let entries=[],loaded=false,queue=Promise.resolve();
 async function load(){if(loaded)return;loaded=true;if(!store)return;try{const value=JSON.parse(await readFile(store,'utf8'));if(Array.isArray(value))entries=value.filter(x=>x&&typeof x.id==='string'&&x.id.length<100&&typeof x.key==='string'&&x.key.length<=128&&(x.scope===undefined||validScope(x.scope))&&(x.cleared===true&&validScope(x.scope)||typeof x.path==='string'&&isAbsolute(x.path)&&x.path.length<=4096&&['file','directory','texture','scenetexture'].includes(x.kind)&&/^[a-f0-9]{32}$/.test(x.token))).slice(0,2048)}catch{}}
 async function save(){if(!store)return;const text=JSON.stringify(entries);queue=queue.catch(()=>{}).then(async()=>{await mkdir(dirname(store),{recursive:true});const temp=store+'.'+randomUUID()+'.tmp';await writeFile(temp,text,{mode:0o600});await rename(temp,store)});await queue}
 const get=(row,key,scope='app')=>{const found=entries.find(x=>x.id===stable(row)&&x.key===key&&x.scope===scope);if(found)return found.cleared?null:found;return entries.find(x=>x.id===stable(row)&&x.key===key&&x.scope===undefined)||null};
 async function select(row,key,path,{scope='app'}={}){
  await load();const def=row?.properties?.[key];if(!def||!['file','directory','texture','scenetexture'].includes(def.type))throw Error('wallpaper-property');
  if(!validScope(scope))throw Error('wallpaper-scope');
  if(path===null){entries=entries.filter(x=>x.id!==stable(row)||x.key!==key||x.scope!==scope);if(entries.length>=2048)throw Error('wallpaper-file');entries.push({id:stable(row),key,scope,cleared:true});await save();return}
  if(typeof path!=='string'||!isAbsolute(path)||path.length>4096||!safePart(basename(path)))throw Error('wallpaper-file');
  const normalized=resolve(path),info=await lstat(normalized);if(info.isSymbolicLink()||(def.type==='directory'?!info.isDirectory():!info.isFile()||!allowed(normalized,def)))throw Error('wallpaper-file');
  const record={id:stable(row),key,scope,path:normalized,kind:def.type,token:randomBytes(16).toString('hex')};entries=entries.filter(x=>x.id!==record.id||x.key!==key||x.scope!==scope);if(entries.length>=2048)throw Error('wallpaper-file');entries.push(record);await save();
 }
 function property(row,key,definition,{native=false,scope='app'}={}){
  const item=get(row,key,scope);if(!item)return definition;
  if(native&&['texture','scenetexture'].includes(definition.type))return{...definition,value:item.path};
  if(native&&['file','directory'].includes(definition.type)){const suffix=definition.type==='file'?'/'+basename(item.path):'';return{...definition,value:`_oasis/user/${propertyHash(key)}/${item.token}${suffix}`}}
  return{...definition,selectedName:basename(item.path)};
 }
 async function selectedDirectory(row,key,{scope='app',token}={}){await load();const item=token?entries.find(x=>x.id===stable(row)&&x.key===key&&x.token===token):get(row,key,scope);return item?.kind==='directory'?item:null}
 async function directory(row,key,{scope='app',token}={}){
  const item=await selectedDirectory(row,key,{scope,token});if(!item)return token?[]:null;const def=row.properties?.[key],files=[],prefix=`_oasis/user/${propertyHash(key)}/${item.token}`;
  async function walk(folder,parts,depth){if(depth>24)throw Error('wallpaper-file');for(const entry of await readdir(folder,{withFileTypes:true})){if(!safePart(entry.name)||entry.isSymbolicLink())continue;const next=join(folder,entry.name),relative=[...parts,entry.name];if(entry.isDirectory())await walk(next,relative,depth+1);else if(entry.isFile()&&allowed(entry.name,def))files.push(prefix+'/'+relative.join('/'));if(files.length>50000)throw Error('wallpaper-file')}}
  await walk(item.path,[],0);return files.sort();
 }
 async function openAsset(row,relative){
  await load();const parts=relative.split('/');if(parts.length<5||parts[0]!=='_oasis'||parts[1]!=='user'||!parts.slice(4).every(safePart))throw Error('wallpaper-file');
  const item=entries.find(x=>x.id===stable(row)&&propertyHash(x.key)===parts[2]&&x.token===parts[3]);if(!item)throw Error('wallpaper-file');
  const definition=row.properties?.[item.key];if(!definition||!['file','directory'].includes(definition.type))throw Error('wallpaper-file');
  let target=item.path;if(item.kind==='file'){if(parts.length!==5||parts[4]!==basename(item.path))throw Error('wallpaper-file')}
  else {for(const part of parts.slice(4)){target=join(target,part);const s=await lstat(target);if(s.isSymbolicLink())throw Error('wallpaper-file')}if(!target.startsWith(item.path+sep))throw Error('wallpaper-file')}
  if(!allowed(target,definition))throw Error('wallpaper-file');const handle=await open(target,constants.O_RDONLY|constants.O_NOFOLLOW);try{const stat=await handle.stat();if(!stat.isFile())throw Error('wallpaper-file');return{handle,path:target,stat}}catch(error){await handle.close();throw error}
 }
 return{load,select,property,directory,openAsset};
}
