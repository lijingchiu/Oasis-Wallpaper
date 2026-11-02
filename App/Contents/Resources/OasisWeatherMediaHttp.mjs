/* Shared by the production dashboard and HTTP regression tests. */
import {pipeline} from 'node:stream/promises';
export async function serveWeatherMedia(req,res,weather,send){
 const match=/^\/weather-custom\/(custom-[a-f0-9-]{36})\.(gif|mp4)$/.exec(req.url);
 if(req.method!=='GET'||!match)return false;
 try{
  const result=await weather.readMedia(match[1],match[2],req.headers.range);
  for(const [name,headerValue]of Object.entries(result.headers))res.setHeader(name,headerValue);
  if(result.stream){res.writeHead(result.status,{'Content-Type':'video/mp4','Cache-Control':'private, no-store'});await pipeline(result.stream,res)}
  else send(res,result.status,result.buffer,match[2]==='gif'?'image/gif':'video/mp4');
 }catch{if(!res.headersSent)send(res,404,{ok:false,error:'image-not-found'});else res.destroy()}
 return true;
}
