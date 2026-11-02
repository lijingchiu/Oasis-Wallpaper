/* Licensed real photography, with bounded procedural foreground animation.
   Photos are loaded locally on selection, rasterized once, then reused. */
(()=>{'use strict';
const TAU=Math.PI*2,clamp=x=>Math.max(0,Math.min(1,x)),fract=x=>x-Math.floor(x),hash=n=>fract(Math.sin(n*127.1+311.7)*43758.5453),mod=(x,m)=>((x%m)+m)%m;
const catalog=window.OasisWeatherCatalog||[],kinds=catalog.map(x=>x.id),metadata=new Map(catalog.map(x=>[x.id,x]));
const conditions=Object.fromEntries(catalog.map(x=>[x.id,{scene:x.id,isDay:x.isDay,wind:8}]));
const focal=Object.fromEntries(catalog.map(x=>[x.id,x.focal]));
const defaults={falling:'auto',density:100,speed:100};
const photographicMotion=new Set(['river','aurora','cityLights','neon','candles','surf']);
function registerCustom(rows=[]){for(const key of metadata.keys())if(key.startsWith('custom-')){metadata.delete(key);delete conditions[key];delete focal[key]}for(const row of rows){if(!/^custom-[a-f0-9-]{36}$/.test(row.id)||row.archived)continue;metadata.set(row.id,{id:row.id,custom:true,revision:Number(row.revision)||0,...(['gif','video','web','scene'].includes(row.mediaType)?{mediaType:row.mediaType,mediaExtension:row.mediaType==='gif'?'gif':'mp4',webURL:row.webURL,properties:row.properties||{}}:{}),focal:[.5,.5],effect:'still',particle:'none',size:[row.width,row.height]});focal[row.id]=[.5,.5];conditions[row.id]={scene:row.id,isDay:true,wind:6}}}
function registerCity(photo){for(const key of metadata.keys())if(key.startsWith('city-')){metadata.delete(key);delete focal[key]}delete conditions.city;if(!photo||!/^city-[a-f0-9]{24}$/.test(photo.id))return;metadata.set(photo.id,{id:photo.id,city:true,preference:'city',focal:[.5,.5],effect:'still',particle:'none',size:[photo.width,photo.height]});focal[photo.id]=[.5,.5];conditions.city={scene:photo.id,isDay:photo.isDay!==false,wind:6}}
function inside(u,v,polygon){let yes=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a[1]>v)!==(b[1]>v)&&u<(b[0]-a[0])*(v-a[1])/(b[1]-a[1])+a[0])yes=!yes}return yes}
function surface(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c}
function ellipse(c,x,y,rx,ry,color,angle=0){c.fillStyle=color;c.beginPath();c.ellipse(x,y,rx,ry,angle,0,TAU);c.fill()}
function cover(kind,image,w,h){const scale=Math.max(w/image.naturalWidth,h/image.naturalHeight),dw=image.naturalWidth*scale,dh=image.naturalHeight*scale;return{dx:(w-dw)*(focal[kind]||[.5,.5])[0],dy:(h-dh)*(focal[kind]||[.5,.5])[1],dw,dh}}
function petal(c,x,y,s,a,color,leaf=false){c.save();c.translate(x,y);c.rotate(a);c.scale(Math.max(.20,Math.abs(Math.cos(a*.7))),1);c.fillStyle=color;c.beginPath();c.moveTo(0,-s);if(leaf){c.bezierCurveTo(s*.85,-s*.7,s*.9,s*.25,0,s);c.bezierCurveTo(-s*.85,s*.25,-s*.85,-s*.7,0,-s)}else{c.bezierCurveTo(s*.9,-s*.9,s*1.1,s*.5,0,s);c.bezierCurveTo(-s*1.1,s*.5,-s*.9,-s*.9,0,-s)}c.fill();if(leaf){c.strokeStyle='#715d3b50';c.lineWidth=.5;c.beginPath();c.moveTo(0,-s*.7);c.lineTo(0,s*.7);c.stroke()}c.restore()}
class Landscapes{
 constructor(invalidate=()=>{}){this.settings=defaults;this.clock=18;this.clockAt=null;this.particleChoice='auto';this.invalidate=invalidate;this.cache=new Map();this.preparing=new Map();this.photos=new Map();this.active=null;this.shown=null;this.previous=null;this.changedAt=0;this.buildMs=0;this.motionSurface=null;this.glows=new Map();this.visibleLights=0}
 set(kind,settings={}){kind=metadata.has(kind)?kind:null;this.settings={...defaults,...settings.effects?.[metadata.get(kind)?.preference||kind||'live']};this.particleChoice=this.settings.falling;if(kind===this.active)return;this.active=kind;this.externalMediaReady=false;this.clockAt=null}
 media(){const row=metadata.get(this.active);return row&&['gif','video','web','scene'].includes(row.mediaType)?row:null}
 retry(){if(this.active){this.photos.delete(this.active);this.invalidate()}}
 changed(){this.invalidate();document.dispatchEvent(new Event('oasis-weather-scene'))}
 request(kind){
  if(!kind||this.photos.has(kind))return;
  const image=new Image();image.decoding='async';const row={status:'loading',image};this.photos.set(kind,row);let settled=false;
  const finish=status=>{if(settled)return;settled=true;clearTimeout(timer);row.status=status;if(this.active===kind||this.shown===kind)this.changed();else this.photos.delete(kind)};
  const timer=setTimeout(()=>finish('failed'),8000);
  image.onload=()=>{const decoded=typeof image.decode==='function'?image.decode():Promise.resolve();decoded.then(()=>finish('ready')).catch(()=>finish('failed'))};image.onerror=()=>finish('failed');image.src=(metadata.get(kind)?.custom?'/weather-custom/':metadata.get(kind)?.city?'/weather-city/':'/weather-scenes/')+kind+'.jpg';
 }
 asset(kind,w,h,dark){
  const key=kind+':'+w+':'+h+':'+dark;
  if(this.cache.has(key))return this.cache.get(key);
  if(this.preparing.has(key)||this.preparing.size>=2)return null;
  // Resample off the animation path. The previous scene remains visible while
  // the browser prepares a display-sized bitmap from the 4K photograph.
  const prepare=async()=>{
   const started=performance.now(),row=this.photos.get(kind),scale=Math.min(devicePixelRatio||1,1.5,Math.sqrt(2400000/(w*h))),tw=Math.max(1,Math.floor(w*scale)),th=Math.max(1,Math.floor(h*scale));let bitmap=null;
   try{
    if(row?.status==='ready'&&typeof createImageBitmap==='function'){
     const image=row.image,f=cover(kind,image,w,h),ratio=f.dw/image.naturalWidth,sx=Math.max(0,Math.floor(-f.dx/ratio)),sy=Math.max(0,Math.floor(-f.dy/ratio)),sw=Math.min(image.naturalWidth-sx,Math.ceil(w/ratio)),sh=Math.min(image.naturalHeight-sy,Math.ceil(h/ratio));
     try{bitmap=await createImageBitmap(image,sx,sy,sw,sh,{resizeWidth:tw,resizeHeight:th,resizeQuality:'high'})}catch{}
    }else await new Promise(resolve=>setTimeout(resolve,0));
    if(kind!==this.active&&kind!==this.shown&&kind!==this.previous)return;
    const s=surface(tw,th),c=s.getContext('2d');
    if(bitmap)c.drawImage(bitmap,0,0,tw,th);
    else if(row?.status==='ready'){const f=cover(kind,row.image,w,h);c.scale(scale,scale);c.drawImage(row.image,f.dx,f.dy,f.dw,f.dh);c.setTransform(1,0,0,1,0,0)}
    else{c.fillStyle=dark?'#354a60':'#c9d9db';c.fillRect(0,0,tw,th)}
    c.fillStyle=dark?'rgba(12,24,42,.48)':'rgba(251,248,240,.42)';c.fillRect(0,0,tw,th);this.cache.set(key,s);this.buildMs=performance.now()-started;while(this.cache.size>2)this.cache.delete(this.cache.keys().next().value);
   }finally{bitmap?.close();this.preparing.delete(key);if(kind===this.active||kind===this.shown)this.changed()}
  };
  // Register first even if a platform only has the synchronous fallback.
  this.preparing.set(key,true);Promise.resolve().then(prepare).catch(()=>{});return null;
 }

 point(kind,w,h,u,v){const image=this.photos.get(kind)?.image;if(!image?.naturalWidth)return{x:u*w,y:v*h};const f=cover(kind,image,w,h);return{x:f.dx+u*f.dw,y:f.dy+v*f.dh}}
 paint(c,w,h,dark,timestamp,intensity,t,px,quality,reduced,externalMedia=false){
  // Advance a small, bounded clock once for every kind of motion. Native
  // visibility changes cannot turn a suspended frame into a large time jump.
  if(this.clockAt!==null&&!reduced)this.clock+=Math.min(.1,Math.max(0,(timestamp-this.clockAt)/1000))*(this.settings.speed||100)/100;
  this.clockAt=timestamp;t=reduced?18:this.clock;
  this.externalMediaReady=!!externalMedia;
  if(externalMedia&&this.media()){this.shown=this.active;this.previous=null;this.particles(c,this.shown,w,h,timestamp,px,intensity,quality,reduced);return}
  if(this.active)this.request(this.active);
  const photo=this.active?this.photos.get(this.active):null,pending=photo?.status==='loading';
  const next=this.active&&photo?.status==='ready'?this.asset(this.active,w,h,dark):null;
  if(!pending&&(!this.active||next)&&this.active!==this.shown){this.previous=this.shown;this.shown=this.active;this.changedAt=timestamp}
  if(!this.shown&&!this.previous){this.particles(c,'live',w,h,timestamp,px,intensity,quality,reduced);return}
  const fade=reduced?1:clamp((timestamp-this.changedAt)/900),old=this.previous?this.asset(this.previous,w,h,dark):null,current=this.shown?this.asset(this.shown,w,h,dark):null;
  c.save();if(old&&fade<1){c.globalAlpha=intensity*(1-fade);c.drawImage(old,0,0,w,h)}
  if(current){
   c.globalAlpha=intensity*fade;
   if(photographicMotion.has(metadata.get(this.shown)?.effect)){
    // Compose motion with the photograph before applying background opacity.
    // Previously the already-translucent photo was painted again at 24% for
    // the river, and light/aurora opacity was attenuated several more times.
    // One reusable surface keeps water edges and photographic opacity intact.
    c.drawImage(this.motionFrame(current,this.shown,w,h,t,quality,reduced),0,0,w,h);
   }else{this.releaseMotionSurface();c.drawImage(current,0,0,w,h);this.animate(c,this.shown,w,h,t,px,intensity*fade,quality,reduced,current)}
   this.particles(c,this.shown,w,h,timestamp,px,intensity*fade,quality,reduced)
  }
  if(fade===1){if(!current)this.releaseMotionSurface();this.previous=null;for(const key of this.cache.keys())if(!key.startsWith(this.shown+':'))this.cache.delete(key);for(const key of this.photos.keys())if(key!==this.active&&key!==this.shown)this.photos.delete(key)}c.restore();
 }

 releaseFoliage(){for(const patch of this.foliage?.patches||[])for(const key of ['mask','frame']){patch[key].width=1;patch[key].height=1}this.foliage=null}
 releaseMotionSurface(){for(const key of ['motionSurface','auroraSurface'])if(this[key]){this[key].width=1;this[key].height=1;this[key]=null}this.releaseFoliage();this.visibleLights=0}
 motionFrame(photo,kind,w,h,t,quality,reduced){
  let s=this.motionSurface;if(!s)this.motionSurface=s=surface(photo.width,photo.height);
  if(s.width!==photo.width||s.height!==photo.height){s.width=photo.width;s.height=photo.height}
  this.visibleLights=0;if(kind!=='coast')this.releaseFoliage();if(kind!=='aurora'&&this.auroraSurface){this.auroraSurface.width=1;this.auroraSurface.height=1;this.auroraSurface=null}
  const c=s.getContext('2d');c.setTransform(1,0,0,1,0,0);c.globalAlpha=1;c.globalCompositeOperation='source-over';c.drawImage(photo,0,0);
  c.save();c.scale(s.width/w,s.height/h);this.animate(c,kind,w,h,t,0,1,quality,reduced,photo);c.restore();return s;
 }

 animate(c,kind,w,h,t,px,alpha,quality,reduced,current){
  const small=w<500,row=metadata.get(kind);
  if(row?.effect==='river')this.river(c,kind,w,h,t,alpha,quality,current);
  else if(row?.effect==='aurora')this.aurora(c,kind,w,h,t,alpha,quality);
  else if(['cityLights','neon','candles'].includes(row?.effect))this.drawLights(c,kind,w,h,t,alpha,quality);
  if(kind==='sakura'||kind==='autumn'){
   const leaf=kind==='autumn';
   c.strokeStyle=kind==='sakura'?'#f2e3df':'#e5d4b4';c.lineWidth=.65;for(let i=0;i<3;i++){const phase=mod(t*.055+i*.31,1),point=this.point(kind,w,h,.46+i*.10,(leaf?.79:.80)+i*.024);if(point.x<0||point.x>w||point.y<0||point.y>h)continue;c.globalAlpha=alpha*(1-phase)*.18;c.beginPath();c.ellipse(point.x,point.y,3+phase*20,1+phase*3,0,0,TAU);c.stroke()}
   // One quiet butterfly near the garden edge, rather than a busy full-screen flock.
   if(!leaf){const x=w*(.15+.07*Math.sin(t*.06)),y=h*(.56+.035*Math.cos(t*.09)),wing=2+2*Math.abs(Math.sin(t*3.2));c.globalAlpha=alpha*.65;ellipse(c,x-wing*.6,y,wing,2.5,'#e9d8ab',-.5);ellipse(c,x+wing*.6,y,wing,2.5,'#fff0cb',.5)}
  }else if(kind==='coast'){
   this.swayFoliage(c,kind,w,h,t,alpha,current);
   // Surf and small sun glints stay within the photographed water band.
   for(let j=0;j<3;j++){const phase=mod(t*.045+j/3,1),fade=Math.sin(phase*Math.PI);c.globalAlpha=alpha*fade*.24;c.strokeStyle='#f1fff5';c.lineWidth=.7+phase*.7;c.beginPath();for(let i=0;i<=18;i++){const u=.22+i*.022,point=this.point(kind,w,h,u,.845+.024*phase+Math.sin(i*.18+t*.17+j)*.003);i?c.lineTo(point.x,point.y):c.moveTo(point.x,point.y)}c.stroke()}
   c.strokeStyle='#effadf';c.lineWidth=.6;c.beginPath();c.globalAlpha=alpha*.22;for(let i=0;i<(small?16:30);i++){const point=this.point(kind,w,h,.23+hash(i+80)*.34,.818+hash(i+72)*.025),len=(2+hash(i)*9)*(.55+.45*Math.sin(t*.6+i));c.moveTo(point.x,point.y);c.lineTo(point.x+len,point.y)}c.stroke();
   for(let i=0;i<2;i++){const x=mod(t*(3+i)+i*w*.42,w+60)-30,y=h*(.32+i*.05)+Math.sin(t*.1+i)*7,wing=2.5+Math.sin(t*1.4+i)*1.8;c.globalAlpha=alpha*.45;c.strokeStyle='#4b7185';c.lineWidth=.8;c.beginPath();c.moveTo(x-5,y-wing);c.quadraticCurveTo(x-2,y-2,x,y);c.quadraticCurveTo(x+2,y-2,x+5,y-wing);c.stroke()}
  }else if(kind==='winterCity'){
   c.strokeStyle='#eff2f6';c.lineWidth=2;c.lineCap='round';for(let i=0;i<3;i++){const phase=mod(t*.045+i*.37,1),point=this.point(kind,w,h,.27+i*.14,.60-phase*.05);c.globalAlpha=alpha*.09*Math.sin(phase*Math.PI);c.beginPath();c.moveTo(point.x,point.y);c.bezierCurveTo(point.x-4,point.y-7,point.x+7,point.y-12,point.x+3,point.y-19);c.stroke()}

  }
 }
 particles(c,kind,w,h,timestamp,px,alpha,quality,reduced){
  const row=metadata.get(kind),choice=this.settings.falling||'auto',type=choice==='auto'?(row?.particle||'none'):choice;
  const t=reduced?18:this.clock;if(type==='none')return;
  if(kind==='coast'&&type==='leaves'){this.coastalLeaves(c,w,h,t,alpha,quality);return}
  const small=w<500,density=(this.settings.density||100)/100,count=Math.round((type==='dust'?(small?32:56):small?24:40)*quality*density);
  c.save();
  for(let i=0;i<count;i++){
   const depth=.35+hash(i+18)*.8,life=mod(t*(type==='dust'?.0035:type==='snow'?.009:.011+hash(i+73)*.006)+hash(i+88),1),drift=type==='dust'?.7:type==='snow'?2.2:type==='leaves'?5:7;
   let x=mod(hash(i+3)*w+t*drift+Math.sin(t*.20+i)*16*depth,w+40)-20+px*depth,y=life*(h+40)-20;
   const fade=Math.min(life*12,(1-life)*12,1),s=(type==='leaves'?3.5:type==='dust'?.4:type==='snow'?.8:2.6)+depth*(type==='leaves'?3:type==='dust'?.75:type==='snow'?1.3:2);
   c.globalAlpha=alpha*fade*(type==='dust'?.34+depth*.32:.48+depth*.30);
   if(type==='dust'){
    // Dust floats slowly through light, with a soft halo instead of a flashing star.
    const warm=kind==='vatican'||kind==='quebec';ellipse(c,x,y,s*2.2,s*2.2,warm?'#fbe9c72b':'#e1eff22b');ellipse(c,x,y,s,s,warm?'#fff0ce':'#eff9ff');
   }else if(type==='snow'){ellipse(c,x,y,s,s,'#f2f8ff')}
   else{
    const green=kind==='wineglass',colors=type==='leaves'?(green?['#a7ae75','#899a61','#bba979']:['#d6ac67','#c79758','#bd7e51']):['#f6d6dc','#eab8c6','#ffe7e8'];
    petal(c,x,y,s,Math.sin(t*.6+i)*1.4+t*.16,colors[i%3],type==='leaves');
   }
  }
  c.restore();
 }
 swayFoliage(c,kind,w,h,t,alpha,photo){
  if(!photo)return;
  // The masks and pivot points are traced in the original photograph. Each
  // crown moves around its own branch attachment; the sea and trunks stay put.
  // Prepare soft masks only on a resize/theme change, never on an animation tick.
  if(this.foliage?.photo!==photo){
   this.releaseFoliage();const scale=photo.width/w,patches=[],photoWidth=cover(kind,this.photos.get(kind).image,w,h).dw;
   for(const spec of metadata.get(kind)?.foliage||[]){
    const points=spec.polygon.map(([u,v])=>this.point(kind,w,h,u,v)),pad=16;
    const x=Math.max(0,Math.floor(Math.min(...points.map(p=>p.x))-pad)),y=Math.max(0,Math.floor(Math.min(...points.map(p=>p.y))-pad));
    const right=Math.min(w,Math.ceil(Math.max(...points.map(p=>p.x))+pad)),bottom=Math.min(h,Math.ceil(Math.max(...points.map(p=>p.y))+pad));
    if(right<=x||bottom<=y)continue;
    const width=right-x,height=bottom-y,mask=surface(Math.ceil(width*scale),Math.ceil(height*scale)),frame=surface(mask.width,mask.height),m=mask.getContext('2d');
    m.scale(scale,scale);m.filter='blur(5px)';m.fillStyle='#fff';m.beginPath();points.forEach((p,i)=>i?m.lineTo(p.x-x,p.y-y):m.moveTo(p.x-x,p.y-y));m.closePath();m.fill();m.filter='none';
    // Fixed branch/trunk corridors remove motion from solid wood, including
    // the sloping palm trunks that pass through neighboring crowns.
    m.globalCompositeOperation='destination-out';m.filter='blur(2px)';m.lineCap='round';
    for(const guard of metadata.get(kind)?.fixedBranches||[]){m.lineWidth=guard.width*photoWidth;m.beginPath();guard.points.forEach(([u,v],i)=>{const p=this.point(kind,w,h,u,v);i?m.lineTo(p.x-x,p.y-y):m.moveTo(p.x-x,p.y-y)});m.stroke()}
    m.filter='none';const pivot=this.point(kind,w,h,...spec.pivot);patches.push({x,y,width,height,mask,frame,pivot,angle:spec.angle});
   }
   this.foliage={photo,patches,scale};
  }
  c.save();c.globalAlpha=alpha;
  this.foliage.patches.forEach((patch,i)=>{
   const {x,y,width,height,mask,frame,pivot}=patch,scale=this.foliage.scale,f=frame.getContext('2d');
   // Two slow, smooth wind cycles keep the canopy breathing without jitter.
   const angle=patch.angle*(.72*Math.sin(t*.52+i*.91)+.28*Math.sin(t*.87+i*1.7));
   f.setTransform(1,0,0,1,0,0);f.globalCompositeOperation='source-over';f.clearRect(0,0,frame.width,frame.height);
   f.save();f.scale(scale,scale);f.translate(pivot.x-x,pivot.y-y);f.rotate(angle);f.translate(-pivot.x,-pivot.y);f.drawImage(photo,0,0,w,h);f.restore();
   f.globalCompositeOperation='destination-in';f.drawImage(mask,0,0);f.globalCompositeOperation='source-over';
   c.drawImage(frame,x,y,width,height);
  });c.restore();
 }
 coastalLeaves(c,w,h,t,alpha,quality){
  // A few detached tropical leaves start in the photographed foliage, rather
  // than raining uniformly from the top of the window like an autumn scene.
  const origins=(metadata.get('coast')?.leafOrigins||[]).map(([u,v])=>this.point('coast',w,h,u,v)).filter(p=>p.x>-30&&p.x<w+30&&p.y<h-30);
  if(!origins.length)return;
  const count=Math.max(1,Math.round((w<500?6:10)*quality*(this.settings.density||100)/100));c.save();
  for(let i=0;i<count;i++){
   const p=origins[i%origins.length],life=mod(t/(24+hash(i+47)*14)+hash(i+28),1),fade=Math.min(life*10,(1-life)*7,1),gust=Math.sin(t*.52+i*.91);
   const x=p.x+life*(25+hash(i+52)*65)+Math.sin(life*TAU*1.6+i)*12*life,y=p.y+life*(h+24-p.y)+Math.sin(life*TAU*2+i)*3;
   c.globalAlpha=alpha*fade*.9;c.save();c.translate(x,y);c.scale(.55,1);
   petal(c,0,0,4+hash(i+5)*2.5,life*5+i+gust*.45,['#8b9454','#a2905c','#637d42'][i%3],true);c.restore();
  }c.restore();
 }
 drawLights(c,kind,w,h,t,alpha,quality){
  const row=metadata.get(kind),points=row?.lights||[],candle=row?.effect==='candles',earth=row?.effect==='cityLights';
  const image=this.photos.get(kind)?.image,photoWidth=image?.naturalWidth?cover(kind,image,w,h).dw:w;
  const glow=this.lightGlow(candle?'candle':earth?'city':'lamp');this.visibleLights=0;
  c.save();
  // Every center is stored in source-photo coordinates and follows the same
  // cover transform as the photograph, including portrait Menu Bar crops.
  for(let i=0;i<points.length;i++){
   if(i%3===2&&quality<.7)continue;
   const [u,v,size=1]=points[i],p=this.point(kind,w,h,u,v);if(p.x< -24||p.x>w+24||p.y< -24||p.y>h+24)continue;
   this.visibleLights++;
   // Independent smooth cycles: city blocks twinkle, signs breathe and flames
   // waver. There are no hard flashes, moving stars or arbitrary light points.
   const wave=.5+.5*Math.sin(t*(.58+hash(i+91)*.57)+i*2.39996);
   const pulse=candle?clamp(.58+.23*Math.sin(t*(2.0+hash(i)) +i*2.1)+.12*Math.sin(t*4.3+i*.7)):.10+.90*wave*wave;
   const r=Math.max(earth?1.8:2.5,Math.min(earth?5.5:8,photoWidth*(earth?.0017:.0026)*size));
   // A small local falloff makes the original luminous area dim as well as
   // brighten. Its center never leaves the photographed lamp or city cluster.
   c.globalCompositeOperation='source-over';c.globalAlpha=alpha*(1-pulse)*(candle?.14:.25);
   c.drawImage(this.lightGlow('shade'),p.x-r*3,p.y-r*3,r*6,r*6);
   c.globalCompositeOperation='screen';c.globalAlpha=alpha*pulse*(candle?.95:.90);
   c.drawImage(glow,p.x-r*4,p.y-r*3.6,r*8,r*7.2);
   c.globalAlpha=alpha*(.18+.82*pulse);
   ellipse(c,p.x+(candle?r*.11*Math.sin(t*2.8+i):0),p.y-(candle?r*.27:0),r*(candle?.31:.38),r*(candle?.75+.2*pulse:.38),candle?'#fff3c5':'#fff6dd');
  }
  if(row?.panels){for(let i=0;i<row.panels.length;i++){c.globalCompositeOperation='screen';c.globalAlpha=alpha*(.08+.22*Math.pow(.5+.5*Math.sin(t*.82+i*2.4),2));c.fillStyle=i?'#ffc0d2':'#ff7055';this.polygon(c,kind,w,h,row.panels[i]);c.fill()}}
  c.restore();
 }
 lightGlow(kind){
  if(this.glows.has(kind))return this.glows.get(kind);
  const s=surface(64,64),c=s.getContext('2d'),g=c.createRadialGradient(32,32,0,32,32,32);
  const colors=kind==='shade'?['#17140ddd','#17140d77','#17140d00']:kind==='candle'?['#fff6c4f5','#ffbb62b8','#ff852540','#ff852500']:kind==='city'?['#fff4d0f5','#ffe29da3','#ffc36b38','#ffc36b00']:['#fff4e8f5','#ffe7c5ad','#ffc7a53d','#ffc7a500'];
  colors.forEach((color,i)=>g.addColorStop(i/(colors.length-1),color));c.fillStyle=g;c.fillRect(0,0,64,64);this.glows.set(kind,s);return s;
 }
 polygon(c,kind,w,h,points){c.beginPath();points.forEach(([u,v],i)=>{const p=this.point(kind,w,h,u,v);i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y)});c.closePath()}
 river(c,kind,w,h,t,alpha,quality,current){
  const polygon=metadata.get(kind).river;c.save();this.polygon(c,kind,w,h,polygon);c.clip();
  // Displace only the water's cached pixels. Architecture, bridge piers and
  // the foreground parapet stay absolutely still outside the traced mask.
  const scale=current.height/h,step=quality<.7?4:2,top=Math.max(0,Math.min(...polygon.map(([u,v])=>this.point(kind,w,h,u,v).y)));
  c.globalAlpha=alpha;
  for(let y=top;y<h;y+=step){
   const depth=clamp((y-top)/Math.max(1,h-top)),amplitude=.65+depth*4.8;
   const dx=(Math.sin(y*.048-t*1.18)+.36*Math.sin(y*.097+t*.73))*amplitude,dy=Math.sin(y*.041-t*.86)*(.25+depth*.65);
   const sy=Math.max(0,Math.min(current.height-1,(y+dy)*scale)),sh=Math.min(step*scale,current.height-sy);
   c.drawImage(current,0,sy,current.width,sh,dx,y,w,sh/scale);
  }
  c.lineWidth=.7;
  for(let i=0;i<(w<500?24:46)*quality;i++){
   const u=mod(hash(i+30)+t*(.009+hash(i+4)*.005),1),v=.59+hash(i+111)*.40;if(!inside(u,v,polygon))continue;
   const p=this.point(kind,w,h,u,v),phase=Math.pow(.5+.5*Math.sin(t*1.1+i*1.7),2),len=6+(v-.59)*36;
   c.globalAlpha=alpha*phase*.42;c.strokeStyle=i%3?'#f4efca':'#566256';c.beginPath();c.moveTo(p.x,p.y);c.quadraticCurveTo(p.x+len*.45,p.y+.8,p.x+len,p.y);c.stroke();
  }
  c.restore();
 }
 aurora(c,kind,w,h,t,alpha,quality){
  // A small reusable emission surface softens the curtain as one whole layer.
  // Filled adjoining ribbons avoid the comb-like gaps of separate bright lines.
  const scale=Math.min(1,640/Math.max(w,h)),sw=Math.ceil(w*scale),sh=Math.ceil(h*scale);
  let layer=this.auroraSurface;if(!layer)this.auroraSurface=layer=surface(sw,sh);
  if(layer.width!==sw||layer.height!==sh){layer.width=sw;layer.height=sh}
  const a=layer.getContext('2d');a.setTransform(1,0,0,1,0,0);a.clearRect(0,0,sw,sh);a.setTransform(scale,0,0,scale,0,0);a.globalCompositeOperation='source-over';
  const count=Math.round(68*quality),beam=(f,band)=>{
   const spread=(f-.5)*(band?.25:.17),sway=Math.sin(t*.20+f*3.1+band)*.026;
   return[this.point(kind,w,h,(band?.82:.36)+spread+sway,band?.31:-.05),this.point(kind,w,h,(band?.89:.39)+spread+Math.sin(t*.24+f*4.5)*.035,band?.41:.20),this.point(kind,w,h,(band?.97:.55)+spread*.65+Math.sin(t*.19+f*5.2)*.026,band?.54:.47),this.point(kind,w,h,(band?1.01:.51)+spread*.55+sway*.65,(band?.62:.66)+Math.sin(f*5.8+t*.26)*.025)];
  };
  for(let band=0;band<2;band++)for(let i=0;i<count;i++){
   const f=i/count,p=beam(f,band),q=beam(Math.min(1,(i+1.12)/count),band),g=a.createLinearGradient(p[0].x,p[0].y,p[3].x,p[3].y);
   g.addColorStop(0,'#a392ef00');g.addColorStop(.22,'#8ddbbd66');g.addColorStop(.55,'#85ffd3ee');g.addColorStop(.82,'#43efa4cc');g.addColorStop(1,'#63fbb100');
   const fold=.5+.5*Math.sin(f*18-t*.5+band),breath=.55+.45*Math.sin(t*.32+f*3.6+band);
   a.globalAlpha=(.45+.55*fold)*(.7+.3*breath)*Math.pow(Math.sin((f+.5/count)*Math.PI),.7);a.fillStyle=g;a.beginPath();a.moveTo(p[0].x,p[0].y);a.bezierCurveTo(p[1].x,p[1].y,p[2].x,p[2].y,p[3].x,p[3].y);a.lineTo(q[3].x,q[3].y);a.bezierCurveTo(q[2].x,q[2].y,q[1].x,q[1].y,q[0].x,q[0].y);a.closePath();a.fill();
  }
  c.save();this.polygon(c,kind,w,h,[[0,0],[1,0],[1,.62],[.72,.72],[.40,.72],[0,.76]]);c.clip();c.globalCompositeOperation='screen';c.globalAlpha=alpha;c.filter='blur(1.3px)';c.drawImage(layer,0,0,w,h);c.restore();
 }

 diagnostics(){return{selected:this.active,shown:this.shown,photoStatus:this.media()&&this.externalMediaReady?'ready':this.active?this.photos.get(this.active)?.status||'idle':'none',effect:metadata.get(this.shown)?.effect||'weather',falling:this.settings.falling==='auto'?(metadata.get(this.shown)?.particle||'none'):this.settings.falling,lightAnchors:metadata.get(this.shown)?.lights?.length||0,visibleLightAnchors:this.visibleLights,visibleFoliagePatches:this.foliage?.patches.length||0,foliagePixels:(this.foliage?.patches||[]).reduce((n,p)=>n+p.mask.width*p.mask.height*2,0),motionSeconds:Math.round(this.clock*100)/100,motionPixels:this.motionSurface?this.motionSurface.width*this.motionSurface.height:0,cachedLayers:this.cache.size,preparing:this.preparing.size,cachedPixels:[...this.cache.values()].reduce((n,s)=>n+s.width*s.height,0),lastBuildMs:Math.round(this.buildMs*100)/100}}
}
window.OasisWeatherLandscapes={Landscapes,kinds,conditions,registerCustom,registerCity};
})();
