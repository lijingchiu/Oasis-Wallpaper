// Wallpaper Engine file properties refer to package assets. They never grant a
// website access to arbitrary files on this Mac.
export function workshopFileURL(value,root){
 if(typeof value!=='string')return value;
 const file=/^file:\/\//i.test(value),absolute=value.startsWith('/')&&!value.startsWith('//'),windows=value.includes('\\')&&!/^[a-z][a-z0-9+.-]*:/i.test(value);if(!file&&!absolute&&!windows)return value;
 if(absolute&&value.startsWith(new URL(root).pathname))return value;
 let path=file?value.replace(/^file:\/+/i,''):absolute?value.slice(1):value;path=path.replace(/\\/g,'/');
 try{path=decodeURIComponent(path)}catch{}
 if(!path||path.length>4096||/[:\u0000-\u001f]/.test(path)||path.startsWith('/')||path.split('/').some(part=>!part||part==='.'||part==='..'||part.toLowerCase()==='.depotdownloader'))return value;
 return new URL(path.split('/').map(encodeURIComponent).join('/'),root).href;
}

function installFileAssets(resolve){
 const match=location.pathname.match(/^\/[a-f0-9]{48}\/custom-[a-f0-9-]{36}\//),root=match?location.origin+match[0]:new URL('.',location.href).href;
 const asset=value=>resolve(value,root),style=value=>typeof value==='string'?value.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\)\s]+))\s*\)/gi,(all,double,single,bare)=>{const value=double??single??bare,next=asset(value);return next===value?all:'url("'+next+'")'}):value;
 const attribute=Element.prototype.setAttribute;
 Element.prototype.setAttribute=function(name,value){const key=String(name).toLowerCase();return attribute.call(this,name,key==='style'?style(value):['src','href','poster'].includes(key)?asset(value):value)};
 for(const [name,keys] of [['HTMLMediaElement',['src','poster']],['HTMLSourceElement',['src']],['HTMLImageElement',['src']],['HTMLScriptElement',['src']],['HTMLLinkElement',['href']],['HTMLIFrameElement',['src']]]){
  const type=window[name];if(!type)continue;
  for(const key of keys){const descriptor=Object.getOwnPropertyDescriptor(type.prototype,key);if(!descriptor?.set||!descriptor.configurable)continue;Object.defineProperty(type.prototype,key,{...descriptor,set(value){descriptor.set.call(this,asset(value))}})}
 }
 const css=window.CSSStyleDeclaration?.prototype;if(css){const original=css.setProperty;css.setProperty=function(key,value,priority){return original.call(this,key,style(value),priority)};for(const key of ['cssText','background','backgroundImage','borderImage','listStyleImage']){const descriptor=Object.getOwnPropertyDescriptor(css,key);if(descriptor?.set&&descriptor.configurable)Object.defineProperty(css,key,{...descriptor,set(value){descriptor.set.call(this,style(value))}})}}
 const fetchOriginal=window.fetch;
 if(fetchOriginal)window.fetch=function(input,options){if(typeof input==='string')input=asset(input);else if(input instanceof URL)input=asset(input.href);else if(typeof Request!=='undefined'&&input instanceof Request){const value=asset(input.url);if(value!==input.url)input=new Request(value,input)}return fetchOriginal.call(this,input,options)};
 const open=window.XMLHttpRequest?.prototype.open;
 if(open)XMLHttpRequest.prototype.open=function(method,url,...args){return open.call(this,method,asset(url),...args)};
 const observe=()=>{if(typeof MutationObserver==='undefined')return;new MutationObserver(records=>{for(const record of records){const node=record.target;if(record.type==='attributes'){const key=record.attributeName,value=node.getAttribute(key),next=key==='style'?style(value):asset(value);if(next!==value)attribute.call(node,key,next)}else for(const child of record.addedNodes||[]){if(child.nodeType!==1)continue;for(const element of [child,...child.querySelectorAll('[src],[href],[poster],[style]')])for(const key of ['src','href','poster','style']){const value=element.getAttribute(key);if(value!==null){const next=key==='style'?style(value):asset(value);if(next!==value)attribute.call(element,key,next)}}}}}).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['src','href','poster','style']})};
 if(document.documentElement)observe();else document.addEventListener('DOMContentLoaded',observe,{once:true});
}
export const workshopFileBridge='('+installFileAssets.toString()+')('+workshopFileURL.toString()+');';
