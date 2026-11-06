// Read the public Steam Workshop catalog without an API key or Steam login.
// Downloads and entitlement checks continue to use the separate Steam helper.
const types=new Set(['Scene','Video','Web','Application']);
const ratings=new Set(['Everyone','Questionable','Mature']);
const genres=new Set(['Abstract','Animal','Anime','Cartoon','CGI','Cyberpunk','Fantasy','Game','Girls','Guys','Landscape','Medieval','Memes','MMD','Music','Nature','Pixel Art','Relaxing','Retro','Sci-Fi','Sports','Technology','Television','Vehicle']);
const sorts=new Set(['trend','mostrecent','mostpopular','mostsubscriptions']);
const decode=value=>String(value||'').replace(/&(?:amp|quot|lt|gt|apos|#(?:x[0-9a-f]+|[0-9]+));/gi,entity=>{const key=entity.slice(1,-1).toLowerCase(),named={amp:'&',quot:'"',lt:'<',gt:'>',apos:"'"};if(named[key])return named[key];const number=key.startsWith('#x')?parseInt(key.slice(2),16):parseInt(key.slice(1),10);return Number.isInteger(number)&&number>0&&number<=0x10ffff&&!((number>=0xd800)&&(number<=0xdfff))?String.fromCodePoint(number):''});
const attr=(element,name)=>{const match=new RegExp('(?:^|\\s)'+name+'\\s*=\\s*(["\'])(.*?)\\1','i').exec(element);return match?decode(match[2]):''};
export function parseWorkshopCards(html){
 if(typeof html!=='string'||html.length>4_000_000)throw Error('workshop-browse-format');
 const pattern=/<a\b[^>]*href=["']https:\/\/steamcommunity\.com\/sharedfiles\/filedetails\/\?id=([1-9][0-9]{0,19})["'][^>]*>([\s\S]*?)<\/a>/gi,seen=new Set(),items=[];
 for(const match of html.matchAll(pattern)){
  if(seen.has(match[1]))continue;const image=/<img\b([^>]*)>/i.exec(match[2]);if(!image)continue;
  const title=attr(image[1],'alt').replace(/[\u0000-\u001f]/g,' ').trim().slice(0,160);let preview=null;
  try{const url=new URL(attr(image[1],'src'));if(url.protocol==='https:'&&!url.username&&!url.password&&['images.steamusercontent.com','steamuserimages-a.akamaihd.net','shared.akamai.steamstatic.com'].includes(url.hostname))preview=url.href}catch{}
  if(!title||!preview)continue;seen.add(match[1]);items.push({id:match[1],title,preview,url:'https://steamcommunity.com/sharedfiles/filedetails/?id='+match[1]});if(items.length>=30)break;
 }
 // A changed page or an access challenge is an error, not a false empty list.
 if(!items.length&&!/no items|no results|0 results|沒有符合|找不到任何|未找到任何/i.test(html))throw Error('workshop-browse-format');
 return items;
}
export function workshopBrowseURL({query='',sort='trend',page=1,rating='Everyone',type='',genre=''}={}){
 if(typeof query!=='string'||query.length>160||/[\u0000-\u001f]/.test(query)||!sorts.has(sort)||!Number.isInteger(page)||page<1||page>100||!ratings.has(rating)||type&&!types.has(type)||genre&&!genres.has(genre))throw Error('workshop-browse-input');
 const url=new URL('https://steamcommunity.com/workshop/browse/');for(const [k,v] of Object.entries({appid:'431960',browsesort:sort,actualsort:sort,section:'readytouseitems',p:String(page),searchtext:query.trim(),l:'tchinese'}))url.searchParams.set(k,v);
 for(const tag of [rating,type,genre].filter(Boolean))url.searchParams.append('requiredtags[]',tag);return url;
}
export async function browseWorkshop(options={},fetchImpl=globalThis.fetch){
 const response=await fetchImpl(workshopBrowseURL(options),{headers:{Accept:'text/html','User-Agent':'Oasis-Wallpaper/1.0'},redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('workshop-browse-unavailable');let size=0;const parts=[];for await(const chunk of response.body){size+=chunk.length;if(size>4_000_000)throw Error('workshop-browse-format');parts.push(chunk)}
 const raw=parseWorkshopCards(Buffer.concat(parts).toString('utf8')),query=String(options.query||'').trim().normalize('NFC').toLocaleLowerCase();
 // Some Steam pages fall back to unrelated popular results for a search with
 // no matches. Search is explicitly by title, so do not present that fallback
 // as if it matched the user's query.
 return{ok:true,items:query?raw.filter(item=>item.title.normalize('NFC').toLocaleLowerCase().includes(query)):raw,page:options.page||1,hasMore:raw.length===30};
}
