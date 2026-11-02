(()=>{
'use strict';
const key='moleAppearanceV1',modes=['dark','light','system','custom'];
const tints={pearl:['霧白','#c1c7cb'],sage:['鼠尾草','#a5b89b'],sand:['暖沙','#c4b293'],mole:['薄荷','#9dcac2'],blue:['海藍','#93b3c9'],violet:['紫羅蘭','#b4a9c6'],amber:['琥珀','#cfb486'],rose:['玫瑰','#c5a0a7']};
const glassDefaults={glassBackgroundOpacity:25,glassSurfaceOpacity:50,glassFrost:150,glassRefraction:300,glassEdgeRange:75,glassRainbowRange:150,glassEmboss:true};
const glassControls=[['glassBackgroundOpacity','背景不透明度',0,100,1],['glassSurfaceOpacity','元件填色強度',0,100,1],['glassFrost','霧面強度',0,300,5],['glassRefraction','折射強度',0,400,5],['glassEdgeRange','邊角折射範圍',0,300,5],['glassRainbowRange','彩虹色差範圍',0,300,5]];
const cleanGlass=s=>Object.fromEntries(glassControls.map(([id,label,min,max])=>[id,typeof s?.[id]==='number'&&Number.isFinite(s[id])?Math.max(min,Math.min(max,s[id])):glassDefaults[id]]).concat([['glassEmboss',typeof s?.glassEmboss==='boolean'?s.glassEmboss:true]]));
const clean=s=>({...cleanGlass(s),material:'liquid',glassTint:Object.hasOwn(tints,s?.glassTint)?s.glassTint:'pearl',mode:modes.includes(s?.mode)?s.mode:'dark',background:/^#[0-9a-f]{6}$/i.test(s?.background)?s.background:'#21363c',accent:/^#[0-9a-f]{6}$/i.test(s?.accent)?s.accent:'#9dcac2'});
let saved;try{saved=JSON.parse(localStorage.getItem(key)||'null')}catch{}
let settings=clean(window.moleThemeInitial||saved),media=matchMedia('(prefers-color-scheme: dark)');
const rgb=h=>h.slice(1).match(/../g).map(x=>parseInt(x,16));
const hex=a=>'#'+a.map(x=>Math.round(x).toString(16).padStart(2,'0')).join('');
const mix=(a,b,t)=>hex(rgb(a).map((x,i)=>x*(1-t)+rgb(b)[i]*t));
const luminance=h=>rgb(h).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4}).reduce((a,x,i)=>a+x*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>(Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
function readable(color,bg,min=4.5){if(contrast(color,bg)>=min)return color;const target=contrast('#ffffff',bg)>contrast('#000000',bg)?'#ffffff':'#000000';for(let i=1;i<=20;i++){const c=mix(color,target,i/20);if(contrast(c,bg)>=min)return c}return target}
function across(color,backgrounds,min=4.5){const score=c=>Math.min(...backgrounds.map(bg=>contrast(c,bg)));if(score(color)>=min)return color;const target=score('#ffffff')>score('#000000')?'#ffffff':'#000000';for(let i=1;i<=40;i++){const c=mix(color,target,i/40);if(score(c)>=min)return c}return target}
function palette(s,dark){const bg=s.mode==='custom'?s.background:s.material==='liquid'?(dark?'#19242d':'#edf2f6'):dark?'#203239':'#f2f0e8',text=readable(dark?'#f3f0e9':'#202a2e',bg,7),away=luminance(text)>luminance(bg)?'#000000':'#ffffff',end=mix(bg,away,.15),surfaceTarget=s.mode==='custom'?away:text,panel=mix(bg,surfaceTarget,.045),strong=mix(bg,surfaceTarget,.09),backgrounds=[bg,end,panel,strong],muted=across(mix(bg,text,.67),backgrounds),accent=across(s.mode==='custom'?s.accent:dark?'#a8cfc5':'#376d65',backgrounds);return{bg,end,text,panel,muted,accent,line:mix(bg,text,.18),strong,danger:across(dark?'#ffaaa1':'#a33330',backgrounds),accentText:contrast('#ffffff',accent)>=contrast('#000000',accent)?'#ffffff':'#000000'}}
function glassPalette(s,dark){
 let p=palette(s,dark);if(s.material!=='liquid')return p;
 const tint=tints[s.glassTint||'pearl'][1];
 if(s.mode!=='custom'){
  const neutral=s.glassTint==='pearl'||!s.glassTint;
  p.bg=mix(dark?'#1c1c1e':'#f5f5f7',tint,neutral?0:.04);
  p.end=p.bg;
  p.panel=mix(p.bg,'#ffffff',dark?.035:.65);
  p.strong=mix(p.bg,dark?'#ffffff':'#000000',dark?.08:.045);
  p.line=mix(p.bg,dark?'#ffffff':'#000000',.12);
 }
 // Native regular material adapts to the desktop before the web tint is applied.
 // Test foregrounds against bounded material variation as well as solid fallbacks.
 p.backdropBlend=s.mode==='custom'?.08:.25;
 const backgrounds=[p.bg,p.end,p.panel,p.strong,...[p.bg,p.end].flatMap(c=>[mix(c,'#ffffff',p.backdropBlend),mix(c,'#000000',p.backdropBlend)]),...[p.panel,p.strong].flatMap(c=>[mix(c,'#ffffff',.06),mix(c,'#000000',.06)])];
 p.text=across(p.text,backgrounds,7);p.muted=across(p.muted,backgrounds);p.accent=across(s.mode==='custom'?s.accent:tint,backgrounds);p.danger=across(p.danger,backgrounds);
 p.accentText=contrast('#ffffff',p.accent)>contrast('#000000',p.accent)?'#ffffff':'#000000';
 return p;
}
const alphaHex=v=>Math.round(Math.max(0,Math.min(1,v))*255).toString(16).padStart(2,'0');
function apply(notify=false){const dark=settings.mode==='system'?media.matches:settings.mode==='custom'?luminance(settings.background)<.3:settings.mode==='dark',p=glassPalette(settings,dark),r=document.documentElement;r.dataset.nativeBackdrop=String(!!window.moleNativeBackdrop);r.dataset.appearance=settings.mode;r.dataset.material=settings.material;r.dataset.tone=dark?'dark':'light';r.dataset.glassEmboss=String(settings.glassEmboss);r.style.colorScheme=dark?'dark':'light';Object.entries({'text':p.text,'muted':p.muted,'line':p.line,'card':p.panel,'panel':p.panel,'surface':p.strong,'accent':p.accent,'accent-text':p.accentText,'danger':p.danger,'bg':p.bg,'theme-bg':p.bg,'theme-end':p.end,'scroll-thumb':p.accent+'4d','scroll-hover':p.text+'4d','glass-bg':p.bg+alphaHex(settings.glassBackgroundOpacity/100),'glass-end':p.end+alphaHex(settings.glassBackgroundOpacity/100),'glass-panel':p.panel+alphaHex((dark?77:87)/255*settings.glassSurfaceOpacity/50),'glass-surface':p.strong+alphaHex((dark?92:100)/255*settings.glassSurfaceOpacity/50),'glass-highlight':dark?'#ffffff05':'#ffffff2b','glass-glow':mix(p.panel,'#ffffff',dark?.035:.10),'glass-tint':tints[settings.glassTint][1],'glass-edge-intensity':settings.glassRefraction/100,'glass-edge-range':settings.glassEdgeRange/100,'glass-chromatic-range':settings.glassRainbowRange/100,...Object.fromEntries([['light','#ffffff',dark?48:94],['shade','#000000',18],['cool','#9cdeff',66],['violet','#c3adff',59],['warm','#ffbdd3',56],['amber','#ffe2a4',64]].map(([key,color,alpha])=>['glass-rim-'+key,color+alphaHex(alpha/255*settings.glassRefraction/300)]))}).forEach(([k,v])=>r.style.setProperty('--'+k,v));document.dispatchEvent(new CustomEvent('mole-theme-change',{detail:{...settings,dark}}));if(notify)window.webkit?.messageHandlers?.mole.postMessage({action:'appearance',...settings,dark,resolvedAccent:p.accent})}
function update(next){settings=clean({...settings,...next});localStorage.setItem(key,JSON.stringify(settings));apply(true)}
window.moleAppearanceState=value=>{settings=clean(value);localStorage.setItem(key,JSON.stringify(settings));apply()};
addEventListener('storage',event=>{if(event.key===key){try{settings=clean(JSON.parse(event.newValue));apply()}catch{}}});
media.addEventListener('change',()=>{if(settings.mode==='system')apply(true)});
function mount(container){
 container.innerHTML=`<div class="appearance-settings">
  <div class="appearance-copy"><strong>外觀與顏色</strong></div>
  <div class="appearance-modes" role="radiogroup" aria-label="顏色模式">${modes.map((mode,i)=>`<button type="button" role="radio" data-mode="${mode}">${['黑夜','白天','跟隨系統','自訂顏色'][i]}</button>`).join('')}</div>
  <div class="appearance-tints" role="radiogroup" aria-label="玻璃主要顏色">${Object.entries(tints).map(([id,[name,color]])=>`<button type="button" role="radio" data-tint="${id}" aria-label="${name}" title="${name}"><i aria-hidden="true" style="--swatch:${color}"></i><span>${name}</span></button>`).join('')}</div>
  <div class="appearance-colors"><label>整體背板<input type="color" aria-label="整體背板顏色"></label><label>主要顏色<input type="color" aria-label="主要顏色"></label></div>
  <section class="appearance-glass-controls" aria-label="玻璃調整">
   <div class="appearance-glass-heading"><h3>玻璃調整</h3><button type="button" class="btn small appearance-glass-reset">重設玻璃效果</button></div>
   <div class="appearance-glass-sliders">${glassControls.map(([id,label,min,max,step])=>`<label class="appearance-glass-slider"><span>${label}</span><output data-glass-output="${id}" aria-hidden="true"></output><input type="range" data-glass-setting="${id}" aria-label="${label}" min="${min}" max="${max}" step="${step}"></label>`).join('')}</div>
   <label class="appearance-glass-emboss"><span>浮雕效果</span><input type="checkbox" data-glass-emboss aria-label="浮雕效果"></label>
  </section>
  <button type="button" class="btn small appearance-reset">恢復預設外觀</button>
 </div>`;
 const groups=[['[data-mode]','mode','mode'],['[data-tint]','tint','glassTint']].map(([selector,data,setting])=>({buttons:[...container.querySelectorAll(selector)],data,setting}));
 const colors=container.querySelectorAll('.appearance-colors input');
 const sliders=[...container.querySelectorAll('[data-glass-setting]')],emboss=container.querySelector('[data-glass-emboss]');
 const refresh=()=>{
  for(const {buttons,data,setting} of groups)for(const button of buttons){const selected=button.dataset[data]===settings[setting];button.setAttribute('aria-checked',String(selected));button.tabIndex=selected?0:-1;button.classList.toggle('active',selected)}
  container.querySelector('.appearance-colors').hidden=settings.mode!=='custom';
  container.querySelector('.appearance-tints').hidden=settings.mode==='custom';
  colors[0].value=settings.background;colors[1].value=settings.accent;
  for(const slider of sliders){const value=settings[slider.dataset.glassSetting];slider.value=String(value);slider.setAttribute('aria-valuetext',value+'%');container.querySelector(`[data-glass-output="${slider.dataset.glassSetting}"]`).textContent=value+'%'}
  emboss.checked=settings.glassEmboss;
 };
 for(const {buttons,data,setting} of groups)buttons.forEach((button,index)=>{
  button.onclick=()=>{update({[setting]:button.dataset[data]});refresh()};
  button.onkeydown=event=>{if(event.altKey||event.ctrlKey||event.metaKey)return;let next;switch(event.key){case 'ArrowLeft':case 'ArrowUp':next=(index+buttons.length-1)%buttons.length;break;case 'ArrowRight':case 'ArrowDown':next=(index+1)%buttons.length;break;case 'Home':next=0;break;case 'End':next=buttons.length-1;break;default:return}event.preventDefault();update({[setting]:buttons[next].dataset[data]});refresh();buttons[next].focus()};
 });
 for(const slider of sliders){slider.oninput=()=>update({[slider.dataset.glassSetting]:Number(slider.value)});slider.onchange=slider.oninput}
 emboss.onchange=()=>update({glassEmboss:emboss.checked});
 container.querySelector('.appearance-glass-reset').onclick=()=>update({...glassDefaults});
 colors[0].oninput=()=>update({background:colors[0].value});colors[1].oninput=()=>update({accent:colors[1].value});
 container.querySelector('.appearance-reset').onclick=()=>{update({...glassDefaults,mode:'dark',material:'liquid',glassTint:'pearl',background:'#21363c',accent:'#9dcac2'});refresh()};
 const listener=()=>{if(!container.isConnected){document.removeEventListener('mole-theme-change',listener);return}refresh()};
 document.addEventListener('mole-theme-change',listener);refresh();
}
window.MoleTheme={mount,update,get:()=>({...settings}),contrast,palette,glassPalette};apply();
})();
