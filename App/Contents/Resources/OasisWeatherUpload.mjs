import {mkdtemp,mkdir,open,rm,statfs} from 'node:fs/promises';
import {join,dirname} from 'node:path';

// Large videos stay on disk throughout upload and preparation. Only images and
// GIFs use the separate, bounded in-memory decoder.
export async function uploadWeatherVideo(stream,{settingsPath,name='',length,importFile}={}){
 if(!settingsPath||typeof importFile!=='function')throw Error('image-storage');
 const base=join(dirname(settingsPath),'weather-uploads');await mkdir(base,{recursive:true,mode:0o700});
 const available=async()=>{const s=await statfs(base);return Number(s.bavail)*Number(s.bsize)};
 const expected=Number(length);if(Number.isSafeInteger(expected)&&expected>0&&await available()<expected*3+128*1024*1024)throw Error('image-space');
 const folder=await mkdtemp(join(base,'upload-')),source=join(folder,'source.mp4');let file,bytes=0,checked=0;
 try{
  file=await open(source,'wx',0o600);
  for await(const chunk of stream){bytes+=chunk.length;if(!Number.isSafeInteger(bytes))throw Error('image-size');
   if(bytes-checked>16*1024*1024){if(await available()<128*1024*1024)throw Error('image-space');checked=bytes}
   let offset=0;while(offset<chunk.length){const out=await file.write(chunk,offset);if(!out.bytesWritten)throw Error('image-storage');offset+=out.bytesWritten}
  }
  await file.close();file=null;if(Number.isSafeInteger(expected)&&expected>0&&bytes!==expected)throw Error('image-decode');
  return await importFile(source,name);
 }finally{await file?.close().catch(()=>{});await rm(folder,{recursive:true,force:true}).catch(()=>{})}
}
