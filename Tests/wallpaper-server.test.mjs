import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,open,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {once} from 'node:events';

test('standalone service imports safely, isolates settings, and serves desktop controls',{skip:!process.env.OASIS_WALLPAPER_TEST_APP},async()=>{
 const app=resolve(process.env.OASIS_WALLPAPER_TEST_APP),root=await mkdtemp(join(tmpdir(),'oasis-wallpaper-http-')),source=join(root,'.config','mole'),destination=join(root,'Library','Application Support','Oasis Wallpaper');
 let child;
 try{
  await mkdir(join(source,'weather-images'),{recursive:true});const initial={settings:{background:'live',desktop:{enabled:true,fps:144}},customImages:[]};await writeFile(join(source,'oasis-weather.json'),JSON.stringify(initial));await writeFile(join(source,'weather-images','fixture.jpg'),'fixture');
  child=spawn(join(app,'Contents/MacOS/node'),[join(app,'Contents/Resources/OasisWallpaperServer.mjs')],{env:{...process.env,HOME:root,OASIS_WALLPAPER_DATA:destination,MOLE_GUI_NATIVE_TOKEN:'fixture-native-token',MOLE_GUI_APP_BUNDLE:app},stdio:['ignore','pipe','pipe']});
  const ready=await new Promise((resolveReady,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('service startup timeout')),15000);child.on('error',reject);child.on('exit',code=>reject(Error('service exited '+code)));child.stdout.on('data',data=>{text+=data;const match=/OASIS_WALLPAPER_READY (\d+)/.exec(text);if(match){clearTimeout(timer);resolveReady(Number(match[1]))}})});
  const base=`http://127.0.0.1:${ready}`;
  async function post(path,body={},headers={}){const response=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});return [response.status,await response.json()]}
  assert.equal((await fetch(base+'/')).status,200);assert.equal((await fetch(base+'/desktop-wallpaper')).status,200);assert.equal((await fetch(base+'/weather-scenes/coast-thumb.jpg')).status,404);
  assert.equal((await post('/api/native-import'))[0],403);
  assert.equal((await post('/api/native-scene',{}))[0],403);
  assert.equal((await post('/api/weather',{}, {origin:'https://outside.invalid'}))[0],403);
  assert.equal((await post('/api/weather/workshop/browse',{rating:'unsupported'}))[1].error,'workshop-browse-input');
  const native={'x-mole-native':'fixture-native-token'};
  // A pipe holds the real import at its settings read until the HTTP checks finish.
  const settingsFile=join(source,'oasis-weather.json'),original=await readFile(settingsFile);
  const saved=join(root,'original-settings.json');
  await rename(settingsFile,saved);
  execFileSync('/usr/bin/mkfifo',[settingsFile]);
  const importing=post('/api/native-import',{},native);
  let writer;
  for(let attempt=0;attempt<100&&!writer;attempt++){
   try{writer=await open(settingsFile,constants.O_WRONLY|constants.O_NONBLOCK)}
   catch(error){if(error.code!=='ENXIO')throw error;await delay(30)}
  }
  assert.ok(writer,'import did not reach the settings read');
  try{
   await rm(settingsFile);await rename(saved,settingsFile);
   const assets=['/','/theme.js','/weather.js','/wallpaper-app.js','/wallpaper-app.css','/weather-catalog.js'];
   const statuses=await Promise.all(assets.map(async path=>[path,(await fetch(base+path)).status]));
   assert.deepEqual(statuses,assets.map(path=>[path,200]),'bundled UI during library import');
   assert.equal((await fetch(base+'/theme.js',{headers:{origin:'https://outside.invalid'}})).status,403);
   assert.equal((await post('/api/weather',{action:'settings',desktop:{enabled:true}}))[0],409);
   assert.equal((await post('/api/native-import',{},native))[0],409);
  }finally{
   await writer.writeFile(original);await writer.close();
   assert.equal((await importing)[0],200);
  }
  let [,state]=await post('/api/weather',{action:'snapshot'});assert.equal(state.settings.background,'live');assert.equal(state.settings.desktop.enabled,false);assert.equal(state.settings.desktop.fps,144);
  assert.deepEqual(JSON.parse(await readFile(join(source,'oasis-weather.json'),'utf8')),initial);
  [,state]=await post('/api/weather',{action:'settings',desktop:{enabled:true,fps:144,screens:{displayA:'live'}}});assert.equal(state.settings.desktop.screens.displayA,'live');
  [,state]=await post('/api/weather',{action:'settings',wallpaper:{id:'live',surface:'desktop',screen:'displayA',brightness:65}});assert.equal(state.settings.wallpaperDesktop.displayA.live.brightness,65);
  const [status,scene]=await post('/api/native-scene',{desktopHost:true,screen:'displayA'},native);assert.equal(status,200);assert.equal(scene.desktop.fps,144);assert.equal(scene.display.brightness,65);
  assert.equal((await post('/api/native-import',{},native))[1].error,'already-configured');
 }finally{if(child&&child.exitCode===null){child.kill('SIGTERM');await Promise.race([once(child,'exit'),new Promise(resolveWait=>setTimeout(resolveWait,3000))])}await rm(root,{recursive:true,force:true})}
});
