/* A single persistent, decorative atmosphere per WebView. Weather refreshes
   only change its target; navigation never recreates the canvas or its clock. */
(()=>{'use strict';
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const mix=(a,b,t)=>a+(b-a)*t;
const fract=x=>x-Math.floor(x);
const hash=n=>fract(Math.sin(n*127.1+311.7)*43758.5453);
const mod=(x,m)=>((x%m)+m)%m;
// Only constant speeds are multiplied by wall-clock time. A changing wind or
// pointer must be a bounded offset, otherwise epoch-sized time amplifies even
// tiny changes into whole-screen jumps during transitions and pointer motion.
function cloudPosition(layer,t,w,h,compact,wind,px=0,py=0){
 const scale=(compact?.72:1.25)+hash(layer+300)*.65,cw=480*scale,ch=240*scale;
 const speed=(.45+layer*.085)*(compact?.75:1)*(layer%2?1:-1);
 return{x:mod(t*speed+hash(layer+40)*(w+cw),w+cw)-cw+Math.sin(t*.018+layer)*wind*6+px*(layer*.12),y:hash(layer+80)*h*.7-ch*.3+Math.sin(t*.018+layer)*8+py,cw,ch};
}
function rainPosition(i,t,w,h,wind,px=0){
 const depth=.45+hash(i+500)*.65;
 return{depth,x:mod(hash(i+700)*w+t*(14+depth*12),w+60)-30+wind*12+px*depth,y:mod(t*(310+depth*380)+hash(i+600)*(h+60),h+60)-30};
}
function snowPosition(i,t,w,h,wind,px=0){
 const depth=.4+hash(i+800)*.8;
 return{depth,x:mod(hash(i+1000)*w+Math.sin(t*.27+i)*24+t*4,w+40)-20+wind*14+px*depth,y:mod(t*(14+depth*29)+hash(i+900)*(h+30),h+30)-15};
}
const profiles={
 sakura:{sky:[147,192,208],low:[238,213,202],cloud:.16,rain:0,snow:0,fog:.05,sun:.52,storm:0},
 autumn:{sky:[174,184,184],low:[235,187,129],cloud:.23,rain:0,snow:0,fog:.08,sun:.55,storm:0},
 coast:{sky:[62,141,198],low:[178,221,204],cloud:.09,rain:0,snow:0,fog:0,sun:.85,storm:0},
 winterCity:{sky:[111,136,171],low:[181,199,216],cloud:.15,rain:0,snow:.65,fog:.05,sun:.1,storm:0},
 vatican:{sky:[163,134,92],low:[218,186,134],cloud:0,rain:0,snow:0,fog:0,sun:0,storm:0},
 aurora:{sky:[53,113,98],low:[75,152,122],cloud:0,rain:0,snow:0,fog:0,sun:0,storm:0},
 florence:{sky:[139,177,201],low:[205,187,135],cloud:0,rain:0,snow:0,fog:0,sun:0,storm:0},
 earth:{sky:[54,64,93],low:[74,100,146],cloud:0,rain:0,snow:0,fog:0,sun:0,storm:0},
 harajuku:{sky:[88,101,132],low:[176,126,134],cloud:0,rain:0,snow:0,fog:0,sun:0,storm:0},
 oaxaca:{sky:[78,67,63],low:[169,120,75],cloud:0,rain:0,snow:0,fog:0,sun:0,storm:0},
 wineglass:{sky:[103,157,207],low:[144,177,164],cloud:0,rain:0,snow:0,fog:0,sun:0,storm:0},
 quebec:{sky:[124,167,189],low:[179,186,158],cloud:0,rain:0,snow:0,fog:0,sun:0,storm:0},
 clear:{sky:[65,153,208],low:[220,191,141],cloud:.08,rain:0,snow:0,fog:0,sun:1,storm:0},
 partly:{sky:[103,153,188],low:[210,210,205],cloud:.43,rain:0,snow:0,fog:0,sun:.8,storm:0},
 cloudy:{sky:[91,115,137],low:[190,198,203],cloud:.86,rain:0,snow:0,fog:.1,sun:.12,storm:0},
 rain:{sky:[64,91,119],low:[139,165,183],cloud:.86,rain:.8,snow:0,fog:.18,sun:0,storm:0},
 storm:{sky:[49,62,87],low:[116,131,159],cloud:1,rain:1,snow:0,fog:.2,sun:0,storm:1},
 snow:{sky:[115,141,163],low:[202,219,227],cloud:.65,rain:0,snow:1,fog:.22,sun:.12,storm:0},
 fog:{sky:[140,155,166],low:[208,214,214],cloud:.4,rain:0,snow:0,fog:.9,sun:.15,storm:0},
 unknown:{sky:[109,139,160],low:[185,197,204],cloud:.25,rain:0,snow:0,fog:0,sun:0,storm:0}
};
function profileFor(current={}){const base=profiles[current.scene]||profiles.unknown,night=current.isDay===false;return{...base,sky:night?base.sky.map((x,i)=>x*.24+[2,4,13][i]):[...base.sky],low:night?base.low.map(x=>x*.28):[...base.low],night:night?1:0,wind:clamp((current.wind||0)/65,0,1),direction:(current.windDirection||220)*Math.PI/180}}
function readableColor(rgb,dark){
 // The atmosphere sits behind every page. Keep its luminance in the selected
 // appearance's range so night weather never makes light-mode labels disappear.
 const brightness=rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
 const target=dark?100:182;
 const amount=dark?(brightness>target?1-target/brightness:0):(brightness<target?(target-brightness)/(255-brightness):0);
 return rgb.map(value=>Math.round(mix(value,dark?0:255,amount)));
}
// Texture work is performed once, outside the animation loop. No CSS filters,
// pixel readbacks, external images or per-frame procedural noise are required.
const TAU=Math.PI*2;
function surface(w,h){const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;return canvas}
function noiseField(seed){
 const size=64,values=new Float32Array(size*size);
 for(let i=0;i<values.length;i++)values[i]=hash(i+seed);
 return(x,y)=>{const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,sx=fx*fx*(3-2*fx),sy=fy*fy*(3-2*fy),a=(iy&63)*size,b=((iy+1)&63)*size;
  return mix(mix(values[a+(ix&63)],values[a+((ix+1)&63)],sx),mix(values[b+(ix&63)],values[b+((ix+1)&63)],sx),sy)};
}
// Pixel-space sampling keeps the small, soft billows genuinely detailed at
// Retina sizes. Production textures are baked at 6×; this is never a frame task.
function cloudPixels(seed,scale=1){
 scale=clamp(Math.round(scale),1,6);
 const w=320*scale,h=144*scale,light=new Uint8ClampedArray(w*h*4),dark=new Uint8ClampedArray(w*h*4),density=new Float32Array(w*h),relief=new Float32Array(w*h),noise=noiseField(seed);
 const lobes=Array.from({length:9},(_,i)=>({x:38+i*30+hash(seed+i)*9,y:63+hash(seed+i+30)*24,rx:24+hash(seed+i+50)*22,ry:21+hash(seed+i+70)*28}));
 for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
  const u=x/scale,v=y/scale,warpX=(noise(u*.032+11,v*.032)-.5)*7,warpY=(noise(u*.03,v*.03+19)-.5)*6;
  let mass=0;for(const l of lobes){const dx=(u+warpX-l.x)/l.rx,dy=(v+warpY-l.y)/l.ry,r=dx*dx+dy*dy;if(r<3)mass+=Math.exp(-r*1.9)}
  if(mass<.07)continue;
  const coarse=noise(u*.032,v*.032),billow=noise(u*.085+17,v*.085),fine=noise(u*.23,v*.23+31),filament=noise(u*.61+29,v*.61+7);
  const detail=billow*.24+fine*.1+filament*.035+noise(u*1.35+37,v*1.35)*.012;
  const edge=clamp((mass-.15+(coarse-.5)*.4+detail-.193)*2.2),i=y*w+x;
  density[i]=edge*edge*(3-2*edge)*clamp((144-v)/22)*clamp(u/22)*clamp((320-u)/22);
  relief[i]=Math.sqrt(Math.max(0,mass))*.58+billow*.06+fine*.015+filament*.003;
 }
 const step=2*scale;
 for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
  const i=y*w+x,a=density[i];if(a<.002)continue;
  const u=x/scale,v=y/scale,n=noise(u*.12+8,v*.12),lightward=density[Math.max(0,y-3*scale)*w+Math.max(0,x-4*scale)],rim=clamp((a-lightward)*2.7),under=clamp((v-52)/65);
  const nx=(relief[y*w+Math.min(w-1,x+step)]-relief[y*w+Math.max(0,x-step)])*7.5,ny=(relief[Math.min(h-1,y+step)*w+x]-relief[Math.max(0,y-step)*w+x])*7.5;
  const diffuse=clamp((nx*.47+ny*.58+.66)/Math.sqrt(1+nx*nx+ny*ny));
  const brightness=clamp(.32+diffuse*.66-under*.1+n*.035+rim*.16),k=i*4;
  light[k]=104+brightness*150;light[k+1]=125+brightness*129;light[k+2]=148+brightness*107;light[k+3]=a*218;
  dark[k]=50+brightness*69;dark[k+1]=68+brightness*69;dark[k+2]=92+brightness*71;dark[k+3]=a*218;
 }
 return{width:w,height:h,light,dark};
}
function cloudSprite(seed){
 const pixels=cloudPixels(seed),lit=surface(pixels.width,pixels.height),shade=surface(pixels.width,pixels.height);
 for(const [canvas,data]of [[lit,pixels.light],[shade,pixels.dark]]){const c=canvas.getContext('2d'),image=c.createImageData(pixels.width,pixels.height);image.data.set(data);c.putImageData(image,0,0)}
 return{lit,shade};
}
function glowSprite(size,stops){const s=surface(size,size),c=s.getContext('2d'),g=c.createRadialGradient(size/2,size/2,0,size/2,size/2,size/2);for(const [at,color]of stops)g.addColorStop(at,color);c.fillStyle=g;c.fillRect(0,0,size,size);return s}
function makeAtlas(){
 const sun=glowSprite(320,[[0,'rgba(255,253,233,1)'],[.075,'rgba(255,248,217,.96)'],[.16,'rgba(255,227,172,.48)'],[.45,'rgba(255,220,158,.13)'],[1,'rgba(255,232,195,0)']]);
 const moonHalo=glowSprite(192,[[0,'rgba(218,233,255,.65)'],[.18,'rgba(198,221,255,.21)'],[.55,'rgba(177,205,252,.055)'],[1,'rgba(177,205,252,0)']]);
 const flash=glowSprite(192,[[0,'rgba(222,232,255,.55)'],[.25,'rgba(193,210,252,.22)'],[1,'rgba(184,205,252,0)']]);
 const moon=surface(96,96),mc=moon.getContext('2d');mc.beginPath();mc.arc(48,48,38,0,TAU);mc.clip();
 const mg=mc.createRadialGradient(34,29,4,56,55,57);mg.addColorStop(0,'#f4f7ff');mg.addColorStop(.6,'#c4d3e7');mg.addColorStop(1,'#8a9fbf');mc.fillStyle=mg;mc.fillRect(0,0,96,96);
 for(let i=0;i<42;i++){const x=14+hash(i+1)*68,y=12+hash(i+81)*70,r=1+hash(i+123)*8,g=mc.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,'rgba(81,105,141,.16)');g.addColorStop(.6,'rgba(92,116,152,.08)');g.addColorStop(1,'rgba(92,116,152,0)');mc.fillStyle=g;mc.fillRect(x-r,y-r,r*2,r*2)}
 const ray=surface(192,384),rc=ray.getContext('2d'),ri=rc.createImageData(192,384);
 // Soft masks vanish on every texture edge; no rectangular beam clipping.
 for(let y=0;y<384;y++)for(let x=0;x<192;x++){const k=(y*192+x)*4,u=(x-96)/(14+y*.19),fade=clamp(y/18)*clamp((384-y)/72)*Math.exp(-y/170)*Math.pow(Math.sin(Math.PI*x/192),2);ri.data[k]=255;ri.data[k+1]=240;ri.data[k+2]=205;ri.data[k+3]=Math.exp(-u*u*2.5)*fade*55}rc.putImageData(ri,0,0);
 const fog=surface(384,96),fc=fog.getContext('2d'),fi=fc.createImageData(384,96),noise=noiseField(401);
 for(let y=0;y<96;y++)for(let x=0;x<384;x++){const k=(y*384+x)*4,vertical=Math.sin(Math.PI*y/96),edge=Math.sin(Math.PI*x/384),n=noise(x*.026,y*.045)*.7+noise(x*.065,y*.08)*.3;fi.data[k]=204;fi.data[k+1]=222;fi.data[k+2]=235;fi.data[k+3]=Math.pow(vertical,1.8)*Math.pow(edge,.65)*(.17+n*.46)*255}fc.putImageData(fi,0,0);
 const snow=surface(64,32),sc=snow.getContext('2d'),bokeh=glowSprite(32,[[0,'rgba(247,252,255,.95)'],[.25,'rgba(240,249,255,.7)'],[1,'rgba(236,248,255,0)']]);sc.drawImage(bokeh,0,0);sc.translate(48,16);sc.strokeStyle='rgba(248,253,255,.85)';sc.lineWidth=1.2;sc.lineCap='round';sc.beginPath();for(let i=0;i<6;i++){const a=i*Math.PI/3,dx=Math.cos(a),dy=Math.sin(a);sc.moveTo(0,0);sc.lineTo(dx*10,dy*10);for(const k of [-1,1]){const b=a+k*.65;sc.moveTo(dx*6,dy*6);sc.lineTo(dx*6-Math.cos(b)*3,dy*6-Math.sin(b)*3)}}sc.stroke();
 const rims={};for(const [name,rgb]of Object.entries({sun:'255,232,181',ice:'234,247,255',rain:'164,209,242'})){const s=surface(256,4),ctx=s.getContext('2d'),g=ctx.createLinearGradient(0,0,256,0);g.addColorStop(0,`rgba(${rgb},0)`);g.addColorStop(.5,`rgba(${rgb},.8)`);g.addColorStop(1,`rgba(${rgb},0)`);ctx.fillStyle=g;ctx.fillRect(0,0,256,4);rims[name]=s}
 return{clouds:[cloudSprite(3),cloudSprite(73),cloudSprite(137)],sun,moonHalo,moon,ray,fog,snow,flash,rims};
}
const HD_CLOUD_WIDTH=1920,HD_CLOUD_HEIGHT=864;
function imageAsset(src,width,height){return new Promise(resolve=>{
 const image=new Image();image.decoding='async';let settled=false;
 const finish=value=>{if(settled)return;settled=true;clearTimeout(timer);image.onload=null;image.onerror=null;resolve(value)};
 const timer=setTimeout(()=>finish(null),8000);
 image.onload=()=>finish(image.naturalWidth===width&&image.naturalHeight===height?image:null);image.onerror=()=>finish(null);image.src=src;
})}
let sharedAtlas,sharedAtlasLoading;
function loadAtlas(){
 if(sharedAtlas)return Promise.resolve(sharedAtlas);
 if(sharedAtlasLoading)return sharedAtlasLoading;
 if(typeof Image==='undefined')return Promise.resolve(null);
 sharedAtlasLoading=Promise.all([imageAsset('/weather-atlas.png',1024,672),imageAsset('/weather-clouds-hd.png',HD_CLOUD_WIDTH*2,HD_CLOUD_HEIGHT*3)]).then(([image,hd])=>{
  const cut=(x,y,w,h)=>{const s=surface(w,h);s.getContext('2d').drawImage(image,x,y,w,h,0,0,w,h);return s};
  const clouds=image&&!hd?Array.from({length:3},(_,i)=>({lit:cut(i*320,0,320,144),shade:cut(i*320,144,320,144)})):null;
  const atlas=image?{clouds,sun:cut(0,288,320,320),moonHalo:cut(320,288,192,192),flash:cut(512,288,192,192),moon:cut(704,288,96,96),ray:cut(800,288,192,384),fog:cut(320,480,384,96),snow:cut(704,384,64,32),rims:{sun:cut(0,608,256,4),ice:cut(0,612,256,4),rain:cut(0,616,256,4)},source:'bundled'}:{...makeAtlas(),source:'procedural-fallback'};
  // Keep one decoded image and draw source rectangles directly. Six additional
  // large canvases would double the texture memory in both App and Menu Bar.
  if(hd){const region=(row,column)=>({image:hd,x:column*HD_CLOUD_WIDTH,y:row*HD_CLOUD_HEIGHT,width:HD_CLOUD_WIDTH,height:HD_CLOUD_HEIGHT});atlas.clouds=Array.from({length:3},(_,i)=>({lit:region(i,0),shade:region(i,1)}));atlas.source=image?'bundled-hd':'hd-with-fallback-effects'}
  atlas.cloudResolution=hd?[HD_CLOUD_WIDTH,HD_CLOUD_HEIGHT]:[320,144];
  sharedAtlas=atlas;return atlas;
 }).catch(()=>{try{return sharedAtlas={...makeAtlas(),source:'procedural-fallback',cloudResolution:[320,144]}}catch{return null}});
 return sharedAtlasLoading;
}
// Developer-only rebuild helper: the checked-in atlas is generated entirely
// from the deterministic code above, with no third-party artwork or downloads.
function bakeAtlas(){const a=makeAtlas(),s=surface(1024,672),c=s.getContext('2d');for(let i=0;i<3;i++){c.drawImage(a.clouds[i].lit,i*320,0);c.drawImage(a.clouds[i].shade,i*320,144)}for(const [name,x,y]of [['sun',0,288],['moonHalo',320,288],['flash',512,288],['moon',704,288],['ray',800,288],['fog',320,480],['snow',704,384]])c.drawImage(a[name],x,y);for(const [i,key]of ['sun','ice','rain'].entries())c.drawImage(a.rims[key],0,608+i*4);return s}
function bakeCloudAtlas(){const s=surface(HD_CLOUD_WIDTH*2,HD_CLOUD_HEIGHT*3),c=s.getContext('2d');for(const [i,seed]of [3,73,137].entries()){const p=cloudPixels(seed,6);for(const [column,data]of [p.light,p.dark].entries()){const image=c.createImageData(p.width,p.height);image.data.set(data);c.putImageData(image,column*p.width,i*p.height)}}return s}
function paintCloud(c,texture,x,y,w,h){if(texture.image)c.drawImage(texture.image,texture.x,texture.y,texture.width,texture.height,x,y,w,h);else c.drawImage(texture,x,y,w,h)}

const nativeFrames=new Map(),liveScenes=new Set();
const CARD_SELECTOR='.wx-card,.wx-hero,.card,.status-card,.section,.work-panel,.feature-list,.workday-card,.mu-card,.mv-player,.mv-compact,.ms-watchlist,.ms-detail,.mf-timer,.mf-settings,.mr-list,.mr-form,.inspector-tabs';
// Media is composited by WebKit, so video frames never require canvas readback.
class WeatherMediaBackground {
 constructor(canvas,invalidate){
  this.invalidate=invalidate;this.root=document.createElement('div');this.root.className='oasis-weather-media';this.root.setAttribute('aria-hidden','true');this.root.dataset.i18nSkip='';
  this.poster=document.createElement('img');this.poster.alt='';this.poster.decoding='async';this.tint=document.createElement('div');this.tint.className='oasis-weather-media-tint';this.root.append(this.poster,this.tint);document.body.insertBefore(this.root,canvas);this.ready=false;this.key='';this.id='';this.motion=null;this.generation=0;this.frameCanvas=null;this.frameTask=0;this.frameLast=0;this.presentedFrames=0;
 }
 configure(row,options){
  this.native=(row.mediaType==='scene'||row.mediaType==='web')&&!!window.webkit?.messageHandlers?.mole;
  const key=JSON.stringify([row.id,row.revision,row.mediaType,row.webURL,options]);if(key===this.key)return;this.key=key;
  const {visible,enabled,reduced,intensity,dark,width,height}=options;
  const a=options.adjustment||{},filter=`brightness(${a.brightness??100}%) saturate(${a.saturation??100}%) hue-rotate(${a.hue??0}deg)`,transform=`translate(${a.x??0}%,${a.y??0}%) scale(${(a.scale??100)/100})`;
  this.poster.style.filter=filter;this.poster.style.transform=transform;if(this.motion){this.motion.style.filter=filter;this.motion.style.transform=transform}
  if(row.id!==this.id||row.revision!==this.revision){
   this.generation++;const generation=this.generation;this.releaseMotion();this.id=row.id;this.revision=row.revision;this.ready=false;
   this.poster.onload=()=>{if(this.generation!==generation)return;this.ready=this.native?nativeFrames.get(this.id)===true:true;this.invalidate()};this.poster.onerror=()=>{if(this.generation!==generation)return;this.ready=false;this.invalidate()};
   this.poster.src='/weather-custom/'+row.id+'.jpg';
  }
  this.root.hidden=!enabled;this.root.style.width=width+'px';this.root.style.height=height+'px';this.root.style.opacity=String(intensity);this.tint.style.background=options.desktop?'transparent':dark?'rgba(12,24,42,.48)':'rgba(251,248,240,.42)';
  if(this.native){
   this.releaseMotion();this.ready=nativeFrames.get(row.id)===true;this.poster.hidden=this.ready;
   if(row.webURL)window.webkit.messageHandlers.mole.postMessage({action:'wallpaperOrigin',url:row.webURL});
   window.webkit.messageHandlers.mole.postMessage({action:'wallpaperReplay',id:row.id});return;
  }
  this.poster.hidden=false;
  const animate=visible&&enabled&&!reduced;this.active=animate;
  if(!animate){if(this.motion?.tagName==='VIDEO')this.motion.pause();if(options.desktop&&options.freeze&&this.motion){if(this.frameTask)cancelAnimationFrame(this.frameTask);this.frameTask=0;return}if(this.motion?.tagName!=='VIDEO')this.releaseMotion();if(this.motion)this.motion.hidden=true;return}
  if(!this.motion){
   const generation=this.generation,node=document.createElement(row.mediaType==='web'?'iframe':row.mediaType==='video'?'video':'img');this.motion=node;node.className='oasis-weather-media-motion';node.hidden=true;
   if(row.mediaType==='web'){node.setAttribute('sandbox','allow-scripts allow-same-origin');node.setAttribute('allow',"camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'");node.onload=()=>{if(this.motion===node&&this.active){node.hidden=false;node.contentWindow?.postMessage({type:'oasis-wallpaper-control',properties:row.properties||{},paused:false},'*')}}}
   else if(row.mediaType==='video'){
    node.muted=true;node.defaultMuted=true;node.volume=0;node.loop=true;node.autoplay=true;node.playsInline=true;node.preload='metadata';node.disablePictureInPicture=true;
    node.setAttribute('muted','');node.setAttribute('autoplay','');node.setAttribute('loop','');node.setAttribute('playsinline','');node.setAttribute('disableRemotePlayback','');
    node.oncanplay=()=>{if(this.generation!==generation||this.motion!==node||!this.active)return;node.hidden=false;node.play().catch(()=>{node.hidden=true})};
   }else{node.alt='';node.onload=()=>{if(this.generation===generation&&this.motion===node&&this.active)node.hidden=false}}
   node.onerror=()=>{if(this.motion===node){node.hidden=true;window.dispatchEvent?.(new CustomEvent('oasis-wallpaper-failed',{detail:{id:this.id,revision:this.revision}}))}};node.src=row.mediaType==='web'?row.webURL:'/weather-custom/'+row.id+'.'+row.mediaExtension;
   node.style.filter=filter;node.style.transform=transform;
   this.root.insertBefore(node,this.tint);
  }
  this.active=animate;
  if(options.desktop&&['VIDEO','IMG'].includes(this.motion.tagName))this.capFrames(width,height,options.fps,filter,transform);
  if(this.motion.tagName==='VIDEO'){const audible=options.audioOwner===true&&a.audio===true;this.motion.muted=!audible;this.motion.volume=audible?Math.max(0,Math.min(1,(a.volume??50)/100)):0}
  if(this.motion.tagName==='VIDEO'&&this.motion.readyState>=2){this.motion.hidden=false;this.motion.play().catch(()=>{this.motion.hidden=true})}
  else if(this.motion.tagName==='IMG'&&this.motion.complete)this.motion.hidden=false;
 }
 capFrames(width,height,fps,filter,transform){
  this.frameRate=Math.max(5,Math.min(144,Number(fps)||30));if(!this.frameCanvas){this.frameCanvas=document.createElement('canvas');this.frameCanvas.className='oasis-weather-media-motion';this.frameCanvas.hidden=true;this.root.insertBefore(this.frameCanvas,this.tint)}
  const canvas=this.frameCanvas,scale=Math.min(1,1920/Math.max(1,width,height)),w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale));if(canvas.width!==w||canvas.height!==h){if(this.frameTask)cancelAnimationFrame(this.frameTask);this.frameTask=0;canvas.width=w;canvas.height=h}canvas.style.filter=filter;canvas.style.transform=transform;this.motion.style.opacity='0';
  if(this.frameTask)return;const tick=time=>{this.frameTask=0;if(!this.active||!this.motion||!this.frameCanvas)return;if(time-this.frameLast>=1000/this.frameRate-.5){const node=this.motion,sw=node.videoWidth||node.naturalWidth,sh=node.videoHeight||node.naturalHeight;if(sw&&sh){const ratio=Math.max(w/sw,h/sh),dw=sw*ratio,dh=sh*ratio;try{canvas.getContext('2d').drawImage(node,(w-dw)/2,(h-dh)/2,dw,dh);canvas.hidden=false;this.presentedFrames++}catch{}}this.frameLast=time}this.frameTask=requestAnimationFrame(tick)};this.frameTask=requestAnimationFrame(tick);
 }
 releaseMotion(){const node=this.motion;this.motion=null;this.active=false;if(this.frameTask)cancelAnimationFrame(this.frameTask);this.frameTask=0;this.presentedFrames=0;this.frameCanvas?.remove();this.frameCanvas=null;if(!node)return;if(node.tagName==='VIDEO'){node.pause();node.removeAttribute('src');node.load()}else node.removeAttribute('src');node.remove()}
 diagnostics(){const node=this.motion,quality=node?.tagName==='VIDEO'?node.getVideoPlaybackQuality?.():null;return{type:node?.tagName||null,native:this.native===true,active:this.active===true,ready:this.ready,...(this.frameCanvas?{fps:this.frameRate,presentedFrames:this.presentedFrames}:{}),...(node?.tagName==='VIDEO'?{paused:node.paused,loop:node.loop,currentTime:node.currentTime,duration:Number.isFinite(node.duration)?node.duration:null,readyState:node.readyState,decodedFrames:quality?.totalVideoFrames??node.webkitDecodedFrameCount??null,droppedFrames:quality?.droppedVideoFrames??node.webkitDroppedFrameCount??null,error:node.error?.code||null}:{})}}
 destroy(){this.generation++;this.releaseMotion();this.poster.removeAttribute('src');this.root.remove();this.ready=false}
}

class WeatherScene{
 constructor({compact=false}={}){
  liveScenes.add(this);this.compact=compact;this.canvas=surface(1,1);this.canvas.className='oasis-weather-atmosphere';this.canvas.setAttribute('aria-hidden','true');this.canvas.dataset.i18nSkip='';document.body.append(this.canvas);
  this.context=this.canvas.getContext('2d',{alpha:true});this.visible=!compact||!window.webkit;this.enabled=true;this.intensity=.45;this.hasWeather=false;this.audioOwner=!window.webkit?.messageHandlers?.mole;this.adjustment={};
  this.target=profileFor();this.profile=profileFor();this.transitionSeconds=1.4;this.pointer={x:.5,y:.3};this.smooth={...this.pointer};this.rects=[];this.ripples=[];this.frame=0;this.lastFrame=0;this.frames=0;this.rectDirty=true;
  this.quality=1;this.meanDrawMs=0;this.costSamples=new Float32Array(120);this.costCursor=0;this.costCount=0;this.expensiveFrames=0;this.healthyFrames=0;
  this.landscapes=window.OasisWeatherLandscapes?new window.OasisWeatherLandscapes.Landscapes(()=>this.schedule()):null;
  this.skyCanvas=surface(1,1);this.skyKey='';this.stars=Array.from({length:54},(_,i)=>({x:hash(i+3),y:hash(i+60)*.76,r:.45+hash(i+27)*.8,group:i%3}));
  this.particles=Array.from({length:120},(_,i)=>({x:hash(i+700),y:hash(i+600),sx:hash(i+1000),sy:hash(i+900),depth:.45+hash(i+500)*.65,snowDepth:.4+hash(i+800)*.8}));
  this.reduce=window.matchMedia('(prefers-reduced-motion: reduce)');this.contrast=window.matchMedia('(prefers-contrast: more)');this.transparency=window.matchMedia('(prefers-reduced-transparency: reduce)');
  this.resize=()=>{
   this.width=innerWidth;this.hostHeight=innerHeight;
   // Inspector pages can shrink the popover. Keep photography and all its
   // registered motion in one screen-sized coordinate system, clipped by the
   // smaller host, so tab changes never recrop or stretch the scene.
   const maximum=window.oasisInspectorViewport?.height;
   this.height=this.compact?(Number.isFinite(maximum)?Math.max(360,maximum):Math.max(360,Math.min(860,(window.screen?.availHeight||925)-65))):innerHeight;
   this.canvas.style.width=this.width+'px';this.canvas.style.height=this.height+'px';
   this.configureBuffer();this.rectDirty=true;this.schedule();
  };
  this.tick=timestamp=>{this.frame=0;if(!this.running())return;const base=this.profile.rain>.02||this.profile.snow>.02||this.profile.storm>.02?30:24,fps=this.desktop?this.desktopFPS:base,interval=1000/fps;if(timestamp-this.lastFrame>=interval-.6){this.draw(timestamp);this.lastFrame+=interval*Math.max(1,Math.floor((timestamp-this.lastFrame+.6)/interval))}this.frame=requestAnimationFrame(this.tick)};
  this.onPointer=e=>{this.pointer.x=clamp(e.clientX/this.width);this.pointer.y=clamp(e.clientY/this.height)};
  this.onPointerLeave=()=>{this.pointer.x=.5;this.pointer.y=.3};
  this.onClick=e=>{if(e.detail===0||this.reduced()||!this.running()||!e.target.closest('button,summary,input'))return;this.ripples.push({x:e.clientX,y:e.clientY,time:performance.now()});if(this.ripples.length>3)this.ripples.shift();this.rectDirty=true};
  this.onScroll=()=>{this.rectDirty=true};this.onVisibility=()=>this.schedule();this.onTheme=()=>{this.rectDirty=true;this.skyKey='';this.schedule()};
  addEventListener('resize',this.resize);addEventListener('oasis-inspector-viewport',this.resize);addEventListener('pointermove',this.onPointer,{passive:true});document.addEventListener('pointerleave',this.onPointerLeave,{passive:true});document.addEventListener('click',this.onClick,true);document.addEventListener('scroll',this.onScroll,{passive:true,capture:true});
  document.addEventListener('visibilitychange',this.onVisibility);document.addEventListener('oasis-startup-finished',this.onVisibility);document.addEventListener('mole-theme-change',this.onTheme);document.addEventListener('oasis-weather-environment',this.onTheme);
  for(const q of [this.reduce,this.contrast,this.transparency])q.addEventListener('change',this.onTheme);
  this.observer=new MutationObserver(records=>{if(records.some(r=>r.target!==this.canvas&&!r.target.closest?.('.oasis-weather-atmosphere,.oasis-weather-media')))this.rectDirty=true});
  this.observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','open','hidden','data-inspector-panel','data-inspector-inactive']});
  this.environmentObserver=new MutationObserver(()=>this.schedule());this.environmentObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-reduce-motion','data-reduce-transparency','data-increase-contrast']});
  this.resize();
 }
 configureBuffer(){
  // A pixel budget also bounds fill cost on large external/Retina displays.
  this.dpr=Math.min(devicePixelRatio||1,this.quality<.9?1:2,Math.sqrt(3600000/Math.max(1,this.width*this.height)));
  const width=Math.max(1,Math.floor(this.width*this.dpr)),height=Math.max(1,Math.floor(this.height*this.dpr));
  // Host-only height changes must not clear an unchanged photograph buffer.
  if(this.canvas.width!==width||this.canvas.height!==height){this.canvas.width=width;this.canvas.height=height;this.skyKey=''}
  this.context.imageSmoothingEnabled=true;this.context.imageSmoothingQuality='high';
 }
 reduced(){return this.reduce.matches||document.documentElement.dataset.reduceMotion==='true'}
 quiet(){return this.contrast.matches||this.transparency.matches||document.documentElement.dataset.increaseContrast==='true'||document.documentElement.dataset.reduceTransparency==='true'}
 mediaOnly(){return !!this.landscapes?.media?.()&&['auto','none'].includes(this.landscapes.particleChoice||'auto')}
 running(){return this.enabled&&this.hasWeather&&this.visible&&!document.hidden&&!this.reduced()&&!this.quiet()&&!this.mediaOnly()}
 set(current,settings={}){
  const first=!this.hasWeather;this.hasWeather=!!current;this.enabled=settings.enabled!==false;this.desktop=settings.desktopMode===true;this.desktopFPS=Math.max(5,Math.min(144,Number(settings.desktopFPS)||30));this.intensity=clamp((settings.intensity??45)/100,.1,this.desktop?1:.8);this.transitionSeconds=settings.preview?.45:1.4;
  this.adjustment=settings.wallpaperDisplay||{};const a=this.adjustment;this.canvas.style.filter=`brightness(${a.brightness??100}%) saturate(${a.saturation??100}%) hue-rotate(${a.hue??0}deg)`;this.canvas.style.transform=`translate(${a.x??0}%,${a.y??0}%) scale(${(a.scale??100)/100})`;
  this.landscapes?.set(current?.scene,settings);
  if(current){const next=profileFor(current);if(next.storm>.5&&this.target.storm<.5)this.stormStartedAt=performance.now();this.target=next;if(first)this.profile=profileFor(current)}
  document.documentElement.style.setProperty('--weather-rim',current?.isDay===false?'163 192 239':current?.scene==='clear'?'255 217 147':'193 220 244');this.schedule();
 }
 setVisible(value){this.visible=!!value;this.rectDirty=true;this.schedule()}
 syncMedia(){
  const row=this.landscapes?.media?.();
  if(!row){this.media?.destroy();this.media=null;if(this.landscapes)this.landscapes.externalMediaReady=false;return false}
  if(!this.media)this.media=new WeatherMediaBackground(this.canvas,()=>{this.schedule();if(typeof window.dispatchEvent==='function'&&typeof Event==='function')window.dispatchEvent(new Event('oasis-weather-scene'))});
  this.media.configure(row,{visible:this.visible&&!document.hidden&&!document.documentElement.dataset.oasisStartup,enabled:this.enabled&&this.hasWeather&&!this.quiet(),reduced:this.reduced(),intensity:this.intensity,dark:document.documentElement.dataset.tone==='dark',width:this.width,height:this.height,adjustment:this.adjustment,audioOwner:this.audioOwner,desktop:this.desktop===true,freeze:this.desktop===true&&!this.visible,fps:this.desktopFPS});
  this.landscapes.externalMediaReady=this.media.ready;
  return this.media.ready;
 }
 schedule(){
  this.syncMedia();
  if(this.frame)cancelAnimationFrame(this.frame);this.frame=0;this.previous=0;this.lastFrame=performance.now();
  const active=this.enabled&&this.hasWeather&&!this.quiet();this.canvas.hidden=!active||this.mediaOnly();document.documentElement.dataset.weatherActive=String(active);
  if(this.canvas.hidden){this.context.clearRect(0,0,this.canvas.width,this.canvas.height);return}
  // No texture generation, layout or paint work while a native window is hidden.
  if(!this.visible||document.hidden)return;
  this.draw(performance.now(),this.reduced());if(this.running())this.frame=requestAnimationFrame(this.tick);
 }
 geometry(){
  this.rectDirty=false;this.rects=[...document.querySelectorAll(CARD_SELECTOR)].filter(e=>e.getClientRects().length&&!e.closest('[data-inspector-inactive=true]')).map(e=>e.getBoundingClientRect()).filter(r=>r.width>80&&r.top>70&&r.top<this.height&&r.bottom>0).slice(0,12).map(r=>({x:r.x+14,y:r.y,w:Math.max(1,r.width-28),h:r.height}));
 }
 backdrop(p,dark,timestamp,force=false){
  const key=(dark?'d':'l')+p.sky.concat(p.low).map(v=>Math.round(v/3)).join(',')+Math.round(p.night*8);
  if(key===this.skyKey)return;
  if(this.skyKey&&!force&&timestamp-(this.skyPaintedAt||0)<90)return;
  this.skyKey=key;this.skyPaintedAt=timestamp;
  const s=this.skyCanvas,w=Math.min(600,this.width),h=Math.round(w*this.height/this.width);if(s.width!==w||s.height!==h){s.width=w;s.height=h}
  const c=s.getContext('2d'),top=readableColor(p.sky,dark),low=readableColor(p.low,dark);c.clearRect(0,0,w,h);
  const g=c.createLinearGradient(0,0,w*.17,h);g.addColorStop(0,`rgb(${top.join(',')})`);g.addColorStop(.56,`rgb(${top.map((v,i)=>Math.round(mix(v,low[i],.58))).join(',')})`);g.addColorStop(1,`rgb(${low.join(',')})`);c.fillStyle=g;c.fillRect(0,0,w,h);
  const horizon=c.createRadialGradient(w*.75,h*.7,0,w*.75,h*.7,w*.85);horizon.addColorStop(0,`rgba(235,227,205,${(1-p.night)*p.sun*.12})`);horizon.addColorStop(1,'rgba(235,227,205,0)');c.fillStyle=horizon;c.fillRect(0,0,w,h);
 }
 celestial(c,p,t,px,py){
  const w=this.width,h=this.height,a=this.atlas,sx=w*.8+px,sy=Math.min(h*.2,145)+py,day=p.sun*(1-p.night),night=p.night*(1-p.cloud*.86);
  if(night>.02){
   c.fillStyle=document.documentElement.dataset.tone==='dark'?'#e8f2ff':'#617da3';for(let group=0;group<3;group++){c.globalAlpha=this.paintIntensity*night*(.4+.13*Math.sin(t*.23+group*2));c.beginPath();for(const star of this.stars){if(star.group!==group)continue;const x=star.x*w+px*.18,y=star.y*h+py*.18;c.moveTo(x+star.r,y);c.arc(x,y,star.r,0,TAU)}c.fill()}
   const r=this.compact?100:160;c.globalAlpha=this.paintIntensity*night;c.drawImage(a.moonHalo,sx-r,sy-r,r*2,r*2);const size=this.compact?40:58;c.drawImage(a.moon,sx-size/2,sy-size/2,size,size);
   // Four restrained diffraction glints, with long, independent twinkle cycles.
   c.strokeStyle=document.documentElement.dataset.tone==='dark'?'#daeaff':'#7792b8';c.lineWidth=.6;for(let i=0;i<4;i++){const s=this.stars[i*11],alpha=Math.pow(Math.max(0,Math.sin(t*.12+i*1.7)),8)*night*this.paintIntensity*.45;if(alpha<.015)continue;const x=s.x*w+px*.18,y=s.y*h+py*.18;c.globalAlpha=alpha;c.beginPath();c.moveTo(x-3,y);c.lineTo(x+3,y);c.moveTo(x,y-3);c.lineTo(x,y+3);c.stroke()}
  }
  if(day>.015){
   const r=this.compact?132:245;c.globalAlpha=this.paintIntensity*day;c.drawImage(a.sun,sx-r,sy-r,r*2,r*2);
   c.fillStyle='#fff5db';c.globalAlpha=this.paintIntensity*day*.86;c.beginPath();c.arc(sx,sy,this.compact?12:19,0,TAU);c.fill();
   c.globalAlpha=this.paintIntensity*day*(1-p.cloud*.4);for(let i=0;i<4;i++){c.save();c.translate(sx,sy);c.rotate(-.78+i*.41+Math.sin(t*.018)*.035);const reach=Math.min(h*.95,720);c.drawImage(a.ray,-reach*.12,-reach*.04,reach*.24,reach);c.restore()}
  }
 }
 cloudsAndMist(c,p,t,px,py){
  const w=this.width,h=this.height,a=this.atlas,shade=clamp(p.night*.8+p.storm*.8+p.rain*.24),layers=this.quality<.9?4:6;
  if(p.cloud>.015)for(let i=0;i<layers;i++){
   const {x,y,cw,ch}=cloudPosition(i,t,w,h,this.compact,p.wind,px,py),opacity=this.paintIntensity*p.cloud*(.24+i*.052),sprite=a.clouds[i%3];
   // Slightly flattened distant clouds and brighter, textured nearer rims.
   const dy=y+(i%2)*h*.06,dh=ch*(.72+i*.055);
   if(shade<.985){c.globalAlpha=opacity*(1-shade);paintCloud(c,sprite.lit,x,dy,cw,dh)}
   if(shade>.015){c.globalAlpha=opacity*shade;paintCloud(c,sprite.shade,x,dy,cw,dh)}
  }
  if(p.fog>.015)for(let i=0;i<3;i++){
   const fw=w*(1.3+i*.14),fh=Math.max(140,h*(.24+i*.035)),x=(w-fw)/2+Math.sin(t*.012+i*2)*w*.09+px*.3,y=h*(.28+i*.22)+Math.sin(t*.016+i)*8;
   c.globalAlpha=this.paintIntensity*p.fog*(.4+i*.085);c.drawImage(a.fog,x,y-fh/2,fw,fh);
  }
 }
 precipitation(c,p,t,px,reduced){
  if(reduced)return;
  const w=this.width,h=this.height,count=Math.round((this.compact?60:108)*this.quality),points=this.particles;
  if(p.rain>.015){
   c.lineCap='round';c.strokeStyle='#cce6fb';
   // One path per depth plane instead of one stroke per particle.
   for(let layer=0;layer<3;layer++){
    c.lineWidth=.5+layer*.3;c.globalAlpha=this.paintIntensity*p.rain*(.18+layer*.14);c.beginPath();
    for(let i=layer;i<count;i+=3){const q=points[i],d=q.depth,x=mod(q.x*w+t*(14+d*12),w+60)-30+p.wind*12+px*d,y=mod(t*(310+d*380)+q.y*(h+60),h+60)-30,len=8+d*17,slant=(2+p.wind*4)*d;c.moveTo(x,y);c.lineTo(x-slant,y-len)}c.stroke();
   }
   // Small elliptical impacts respond to visible glass card edges, not a fake ground.
   c.lineWidth=.8;c.strokeStyle='#e0f1ff';for(let i=0;i<Math.min(this.rects.length,6);i++){const r=this.rects[i],phase=mod(t*1.1+i*.37,1),cycle=Math.floor(t*1.1+i*.37),x=r.x+r.w*(.08+hash(cycle+i*97)*.84);if(phase>.68)continue;c.globalAlpha=this.paintIntensity*p.rain*(1-phase/.68)*.42;c.beginPath();c.ellipse(x,r.y+1,2+phase*12,.6+phase*2.5,0,0,TAU);c.stroke()}
   // A handful of near-lens droplets are confined to the margins, away from text.
   c.strokeStyle='#d7edff';for(let i=0;i<(this.compact?3:5);i++){const q=points[i+10],life=mod(t*.035+q.x,1),fade=Math.sin(life*Math.PI),x=(i%2?w-12:12)+(q.sx-.5)*14,y=life*h;c.globalAlpha=this.paintIntensity*p.rain*fade*.25;c.lineWidth=1.2;c.beginPath();c.moveTo(x,y-11);c.quadraticCurveTo(x-1.5,y-2,x,y+2);c.stroke()}
  }
  if(p.snow>.015){
   c.fillStyle='#edf7ff';for(let layer=0;layer<2;layer++){c.globalAlpha=this.paintIntensity*p.snow*(.36+layer*.27);c.beginPath();for(let i=layer;i<count;i+=2){const q=points[i],d=q.snowDepth,x=mod(q.sx*w+Math.sin(t*.27+i)*24+t*4,w+40)-20+p.wind*14+px*d,y=mod(t*(14+d*29)+q.sy*(h+30),h+30)-15,r=.65+d*(layer?.95:.5);c.moveTo(x+r,y);c.arc(x,y,r,0,TAU)}c.fill()}
   const n=this.compact?5:9;for(let i=0;i<n;i++){const q=points[i+100],life=mod(t*(.025+q.sx*.008)+q.sy,1),y=life*(h+40)-20,x=mod(q.x*w+Math.sin(t*.15+i)*32+t*2,w+50)-25+p.wind*12+px*.8,size=7+q.sx*7,alpha=Math.min(life*10,(1-life)*10,1);c.globalAlpha=this.paintIntensity*p.snow*alpha*.52;
    c.save();c.translate(x,y);c.rotate(Math.sin(t*.12+i)*.5);c.drawImage(this.atlas.snow,i%3===0?32:0,0,32,32,-size/2,-size/2,size,size);c.restore();
   }
  }
 }
 glassLight(c,p,t){
  const strength=p.snow*.45+p.rain*.25+p.sun*.25;if(strength<.015)return;
  const sprite=this.atlas.rims[p.snow>.4?'ice':p.sun>.5?'sun':'rain'];
  for(let i=0;i<this.rects.length;i++){const r=this.rects[i],width=r.w*(.38+.07*Math.sin(t*.025+i)),x=r.x+(r.w-width)*(.5+.35*Math.sin(t*.045+i));c.globalAlpha=this.paintIntensity*strength;c.drawImage(sprite,x,r.y,width,p.snow>.5?2:1)}
 }
 lightning(c,p,t,timestamp,reduced){
  if(p.storm<.015||reduced)return;
  const phase=mod((timestamp-(this.stormStartedAt??0))/1000,19),cycle=Math.floor((timestamp-(this.stormStartedAt??0))/19000),pulse=Math.exp(-Math.pow((phase-2.6)/.6,2));if(pulse<.012)return;
  const x=this.width*(.22+hash(cycle+91)*.55),y=this.height*.12,r=this.compact?210:430;c.globalAlpha=this.paintIntensity*p.storm*pulse*.75;c.drawImage(this.atlas.flash,x-r,y-r*.6,r*2,r*1.5);
  c.globalAlpha=this.paintIntensity*p.storm*pulse*.45;c.strokeStyle='#dce8ff';c.lineWidth=.9;c.lineJoin='round';c.beginPath();let lastX=x,lastY=y;
  for(let j=1;j<8;j++){const nextX=x+(hash(cycle*11+j)*2-1)*19,nextY=y+j*(this.compact?8:12);c.moveTo(lastX,lastY);c.lineTo(nextX,nextY);if(j===3||j===5){c.moveTo(nextX,nextY);c.lineTo(nextX+(j===3?15:-19),nextY+9);c.lineTo(nextX+(j===3?22:-25),nextY+17)}lastX=nextX;lastY=nextY}c.stroke();
 }
 draw(timestamp,staticFrame=false){
  if(!this.context||!this.width||!this.height||!this.hasWeather||!this.enabled||this.quiet())return;
  const started=performance.now(),cold=!this.atlas;
  if(!this.atlas&&!this.assetsRequested&&!this.landscapes?.media?.()){this.assetsRequested=true;loadAtlas().then(atlas=>{if(!atlas)return;this.atlas=atlas;this.texturesStartedAt=performance.now();this.schedule()})}
  const c=this.context,w=this.width,h=this.height,dt=clamp((timestamp-(this.previous||timestamp))/1000,0,.12);this.previous=timestamp;
  const blend=staticFrame?1:1-Math.exp(-dt/this.transitionSeconds),p=this.profile;
  for(const k of ['sky','low'])for(let i=0;i<3;i++)p[k][i]=mix(p[k][i],this.target[k][i],blend);
  for(const k of ['cloud','rain','snow','fog','sun','storm','night','wind','direction'])p[k]=mix(p[k],this.target[k],blend);
  const response=1-Math.exp(-dt/.6);this.smooth.x=mix(this.smooth.x,this.pointer.x,response);this.smooth.y=mix(this.smooth.y,this.pointer.y,response);
  if(this.rectDirty&&timestamp-(this.lastGeometry||0)>240){this.geometry();this.lastGeometry=timestamp}
  const reduced=this.reduced(),t=reduced?18:(performance.timeOrigin+timestamp)/1000,dark=document.documentElement.dataset.tone==='dark',px=reduced?0:(this.smooth.x-.5)*12,py=reduced?0:(this.smooth.y-.5)*8;
  c.setTransform(this.dpr,0,0,this.dpr,0,0);c.clearRect(0,0,w,h);const externalMedia=this.syncMedia();if(!externalMedia){this.backdrop(p,dark,timestamp,staticFrame);c.globalAlpha=this.intensity;c.drawImage(this.skyCanvas,0,0,w,h)}
  this.paintIntensity=this.intensity*(reduced?1:clamp((timestamp-(this.texturesStartedAt??timestamp))/650));
  if(this.atlas&&!this.landscapes?.active){this.celestial(c,p,t,px,py);this.cloudsAndMist(c,p,t,px,py)}
  this.landscapes?.paint(c,w,h,dark,timestamp,this.intensity,t,px,this.quality,reduced,externalMedia);
  if(this.atlas){if(!this.landscapes?.active&&(!this.landscapes||this.landscapes.particleChoice==='auto'))this.precipitation(c,p,t,px,reduced);this.glassLight(c,p,t);this.lightning(c,p,t,timestamp,reduced)}
  if(!reduced){for(let i=this.ripples.length-1;i>=0;i--){const r=this.ripples[i],age=(timestamp-r.time)/1100;if(age>=1){this.ripples.splice(i,1);continue}c.globalAlpha=this.intensity*Math.pow(1-age,2)*.23;c.strokeStyle='#e5f4ff';c.lineWidth=.8;c.beginPath();c.ellipse(r.x,r.y,8+age*56,4+age*20,0,0,TAU);c.stroke()}}
  c.globalAlpha=1;this.frames++;
  if(!cold&&!staticFrame){const cost=performance.now()-started;this.costSamples[this.costCursor++%120]=cost;this.costCount=Math.min(120,this.costCount+1);this.meanDrawMs=this.meanDrawMs?mix(this.meanDrawMs,cost,.035):cost;
   // Hysteresis prevents quality oscillation. It changes detail, never user settings.
   this.expensiveFrames=this.meanDrawMs>3.5?this.expensiveFrames+1:0;this.healthyFrames=this.meanDrawMs<1.4?this.healthyFrames+1:0;
   if(this.expensiveFrames>90&&this.quality===1){this.quality=.72;this.configureBuffer();this.expensiveFrames=0}
   else if(this.healthyFrames>900&&this.quality<1){this.quality=1;this.configureBuffer();this.healthyFrames=0}
  }
 }
 diagnostics(){const costs=Array.from(this.costSamples.slice(0,this.costCount)).sort((a,b)=>a-b);return{frames:this.frames,running:this.running(),reduced:this.reduced(),scene:this.target,mediaOnly:this.mediaOnly(),media:this.media?.diagnostics()||null,rendered:{...this.profile,sky:[...this.profile.sky],low:[...this.profile.low]},canvasCount:document.querySelectorAll('.oasis-weather-atmosphere').length,quality:this.quality,landscape:this.landscapes?.diagnostics()||null,assets:this.atlas?.source||'loading',cloudResolution:this.atlas?.cloudResolution||null,dpr:this.dpr,viewport:{width:this.width,height:this.height,hostHeight:this.hostHeight},pixels:this.canvas.width*this.canvas.height,renderMs:{mean:Number(this.meanDrawMs.toFixed(3)),p95:Number((costs[Math.floor(costs.length*.95)]||0).toFixed(3))}}}
}
window.oasisNativeSceneState=value=>{if(!value||typeof value.id!=='string')return;nativeFrames.set(value.id,value.ready===true);for(const scene of liveScenes){if(scene.media?.id===value.id){scene.media.ready=value.ready===true;scene.media.poster.hidden=value.ready===true}scene.schedule()}};
window.oasisWallpaperAudioOwner=value=>{for(const scene of liveScenes)if(scene.audioOwner!==!!value){scene.audioOwner=!!value;scene.syncMedia()}};
window.OasisWeatherScene=WeatherScene;window.OasisWeatherScene.profileFor=profileFor;window.OasisWeatherScene.readableColor=readableColor;window.OasisWeatherScene.motion={cloudPosition,rainPosition,snowPosition};window.OasisWeatherScene.bakeAtlas=bakeAtlas;window.OasisWeatherScene.bakeCloudAtlas=bakeCloudAtlas;window.OasisWeatherScene.cloudPixels=cloudPixels;
})();
