import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {Readable} from 'node:stream';
import {runInNewContext} from 'node:vm';
import {unpackPage} from '../App/Contents/Resources/OasisArchive/atlas.mjs';
import {normalizeRig} from '../App/Contents/Resources/OasisArchive/rig.mjs';
import {workshopRuntime} from '../App/Contents/Resources/OasisWorkshopRuntime.mjs';

test('Spine 4.1 path constraints keep their author slot and drawing order', () => {
  const rig = normalizeRig({
    skeleton: {spine: '4.1.24'},
    animations: {},
    skins: [],
    slots: [],
    ik: [{name: 'arm', target: 'hand', order: 2}],
    path: [{name: 'hair', target: 'hair-line', order: 1}]
  });
  assert.deepEqual(
    rig.constraints.map((c) => [c.name, c.slot]),
    [
      ['hair', 'hair-line'],
      ['arm', undefined]
    ]
  );
});

test('a continuous wallpaper animation schedules one browser frame across pause and resume', () => {
  const callbacks = new Map(),
    events = {},
    root = {
      location: {pathname: '/test/', href: 'http://localhost/test/'},
      URL,
      document: {hidden: false, addEventListener() {}},
      clearInterval,
      Map,
      queueMicrotask
    };
  let id = 0,
    draws = 0;
  Object.assign(root, {
    window: root,
    parent: root,
    addEventListener: (event, f) => {
      events[event] = f;
    },
    requestAnimationFrame: (f) => {
      callbacks.set(++id, f);
      return id;
    },
    cancelAnimationFrame: (k) => callbacks.delete(k)
  });
  runInNewContext(workshopRuntime, root);
  function draw() {
    draws++;
    root.requestAnimationFrame(draw);
  }
  root.requestAnimationFrame(draw);
  for (let i = 1; i <= 8; i++) {
    assert.equal(callbacks.size, 1);
    const [k, tick] = [...callbacks][0];
    callbacks.delete(k);
    tick(i * 40);
  }
  assert.equal(draws, 8);
  for (const [paused, count] of [
    [true, 0],
    [false, 1]
  ]) {
    runInNewContext(
      'applyPause({source:parent,data:{type:"oasis-wallpaper-control",paused:' + paused + '}})',
      Object.assign(root, {applyPause: events.message})
    );
    assert.equal(callbacks.size, count);
  }
});

test('trimmed regions normalize to their original orientation at every pack rotation', () => {
  for (const angle of [0, 90, 180, 270]) {
    // A B       Two transparent margins in the 4x4 original.
    // C D       The data page is also scaled independently on each axis.
    // E F
    const width = angle % 180 ? 3 : 2,
      height = angle % 180 ? 2 : 3,
      rgba = Buffer.alloc(width * 2 * height * 4);
    for (let y = 0; y < 3; y++)
      for (let x = 0; x < 2; x++) {
        const [px, py] =
          angle === 0 ? [x, y] : angle === 90 ? [y, 1 - x] : angle === 180 ? [1 - x, 2 - y] : [2 - y, x];
        for (let i = 0; i < 2; i++) {
          const offset = 4 * (py * width * 2 + px * 2 + i);
          rgba[offset] = 1 + x + y * 2;
          rgba[offset + 3] = 255;
        }
      }
    const packed = unpackPage(
      'art.png\nsize:' +
        width +
        ',' +
        height +
        '\nart\nbounds:0,0,2,3\noffsets:1,0,4,4\nrotate:' +
        angle,
      {rgba, width: width * 2, height}
    );
    const [l, t, w, h] = packed.atlas
      .match(/bounds:(.*)/)[1]
      .split(',')
      .map(Number);
    const pixel = (x, y) =>
      packed.rgba[
        4 * ((t + Math.floor(((y + 0.5) * h) / 4)) * packed.width + l + Math.floor(((x + 0.5) * w) / 4))
      ];
    assert.deepEqual(
      [pixel(0, 1), pixel(1, 0), pixel(1, 1), pixel(2, 1), pixel(1, 2), pixel(2, 3), pixel(3, 3)],
      [0, 0, 1, 2, 3, 6, 0],
      String(angle)
    );
  }
});
test(
  'archive import keeps local projects separate and rejects invalid Windows/ZIP content',
  {skip: !process.env.OASIS_WALLPAPER_TEST_APP},
  async () => {
    const resources = join(resolve(process.env.OASIS_WALLPAPER_TEST_APP), 'Contents', 'Resources'),
      tmp = await mkdtemp(join(tmpdir(), 'oasis-archive-'));
    const {createWeather} = await import(join(resources, 'OasisWeather.mjs'));
    const {uploadWallpaperArchive} = await import(join(resources, 'OasisWeatherUpload.mjs'));
    const path = join(tmp, 'data', 'oasis-weather.json');
    let weather = createWeather({path});
    async function upload(bytes, name, desktopTarget) {
      return uploadWallpaperArchive(Readable.from([bytes]), {
        weather,
        name,
        settingsPath: path,
        length: bytes.length,
        desktopTarget
      });
    }
    try {
      const work = join(tmp, 'fixture');
      await mkdir(work);
      const html = '<main><button onclick="document.body.dataset.pressed=1">Touch</button></main>';
      await writeFile(join(work, 'index.html'), html);
      execFileSync('/usr/bin/zip', ['-q', join(tmp, 'web.zip'), 'index.html'], {cwd: work});
      const data = await readFile(join(tmp, 'web.zip'));
      let finish;
      const slow = Readable.from(
        (async function* () {
          await new Promise((r) => {
            finish = r;
          });
          yield Buffer.from('bad archive');
        })()
      );
      const firstUpload = uploadWallpaperArchive(slow, {weather, settingsPath: path, name: 'slow.zip'});
      try {
        while (!finish) await new Promise((r) => setTimeout(r, 5));
        await assert.rejects(upload(data, 'busy.zip'), /image-busy/);
      } finally {
        finish();
        await assert.rejects(firstUpload, /archive-invalid/);
      }
      const desktopTarget = {
        screen: 'sample',
        expected: 'follow',
        expectedEnabled: false,
        displays: ['sample', 'other'],
        enable: true
      };
      const first = await upload(data, 'Alpha.zip', desktopTarget),
        alpha = first.customImages.at(-1);
      assert.equal(first.settings.desktop.screens.sample, alpha.id);
      assert.equal(first.settings.background, 'live');
      assert.notEqual(first.settings.desktop.screens.other, alpha.id);
      await assert.rejects(upload(data, 'Stale.zip', desktopTarget), /workshop-selection-changed/);
      const second = await upload(data, 'Beta.zip');
      assert.equal(second.customImages.length, 2);
      assert.equal(second.customImages[0].id, alpha.id);
      const beta = second.customImages.at(-1);
      assert.equal(second.settings.background, beta.id);
      assert.equal(beta.workshopID, undefined);
      weather.close();
      weather = createWeather({path});
      const a = await weather.nativeScene({desktopHost: true, screen: 'sample'}),
        b = await weather.nativeScene({});
      assert.equal(a.web.id, alpha.id);
      assert.equal(b.web.id, beta.id);
      assert.ok((await (await fetch(b.web.url)).text()).includes(html));
      await weather.action({action: 'deleteImage', id: alpha.id});
      assert.equal((await fetch(a.web.url)).status, 404);
      assert.equal((await fetch(b.web.url)).status, 200);
      assert.equal((await fetch(new URL('_oasis/controls', b.web.url))).status, 404);
      await writeFile(join(work, 'project.json'), JSON.stringify({type: 'web', file: 'index.html'}));
      const trusted = await weather.importWorkshop(work, 'Controls', {
        title: 'Controls',
        archivePlayer: 'band'
      });
      const imported = trusted.customImages.at(-1);
      assert.equal(imported.archivePlayer, 'band');
      const stateURL = new URL('_oasis/controls', (await weather.nativeScene({})).web.url);
      const choices = {
        sides: [0, 1, 2].map((member) => ({member, pose: 2, speed: 1.5})),
        song: 4,
        volume: 0.37,
        mode: 1
      };
      const post = (origin, value) =>
        fetch(stateURL, {
          method: 'POST',
          headers: {Origin: origin, 'Content-Type': 'application/json'},
          body: JSON.stringify(value)
        });
      assert.equal((await post('https://invalid.example', choices)).status, 403);
      assert.equal((await post(stateURL.origin, {...choices, volume: 50})).status, 400);
      assert.equal((await post(stateURL.origin, choices)).status, 200);
      weather.close();
      weather = createWeather({path});
      const reopened = (await weather.nativeScene({})).web.url;
      assert.notEqual(reopened, stateURL.href);
      assert.deepEqual(await (await fetch(new URL('_oasis/controls', reopened))).json(), choices);
      await weather.action({action: 'deleteImage', id: imported.id});
      await weather.action({action: 'settings', settings: {background: beta.id}});
      // A desktop EXE retains its directory and appears only on the requested screen.
      const pe=Buffer.alloc(1024);pe.writeUInt16LE(0x5a4d);pe.writeUInt32LE(0x80,60);
      pe.writeUInt32LE(0x4550,0x80);pe.writeUInt16LE(0x8664,0x84);pe.writeUInt16LE(1,0x86);pe.writeUInt16LE(240,0x94);pe.writeUInt16LE(2,0x96);pe.writeUInt16LE(0x20b,0x98);
      const desktopID='EXECUTABLE-TEST',scope={screen:desktopID,expected:'follow',enable:true,expectedEnabled:true,displays:[desktopID]};
      await mkdir(join(work,'Game'));await writeFile(join(work,'Game','Original.exe'),pe);
      await writeFile(join(work,'Game','Original.dll'),'asset');await writeFile(join(work,'Game','UnityCrashHandler64.exe'),pe);
      execFileSync('/usr/bin/zip',['-qr',join(tmp,'game.zip'),'Game'],{cwd:work});
      const packageBytes=await readFile(join(tmp,'game.zip'));
      const importedApp=await upload(packageBytes,'game.zip',scope);
      const game=importedApp.customImages.find(x=>x.mediaType==='application');
      assert.ok(game);assert.equal(game.entry,'files/Game/Original.exe');assert.match(game.digest,/^[a-f0-9]{64}$/);
      let session=(await weather.nativeScene({desktopManagement:true,desktopScreens:[desktopID]})).applications[desktopID];
      assert.equal(session.id,game.id);assert.deepEqual(await readFile(join(session.root,session.entry)),pe);
      assert.equal(await readFile(join(session.root,'files/Game/Original.dll'),'utf8'),'asset');
      assert.deepEqual((await weather.nativeScene({desktopHost:true,screen:desktopID})).applications,{});
      const {workshopProject}=await import(join(resources,'OasisWorkshopPackages.mjs'));
      await assert.rejects(workshopProject(session.root),/workshop-format/);
      weather.close();weather=createWeather({path});
      assert.equal((await weather.nativeScene({desktopManagement:true,desktopScreens:[desktopID]})).applications[desktopID].digest,game.digest);
      await assert.rejects(upload(Buffer.from('invalid'),'broken.exe',{...scope,expected:game.id}),/archive-invalid/);
      const arm=Buffer.from(pe);arm.writeUInt16LE(0xaa64,0x84);
      await assert.rejects(upload(arm,'arm.exe',{...scope,expected:game.id}),/archive-architecture/);
      const single=await upload(pe,'Standalone.exe',{...scope,expected:game.id});
      assert.equal(single.customImages.find(x=>x.entry==='files/Standalone.exe').mediaType,'application');
      // The main app's non-desktop ZIP importer still rejects Windows-only files.
      execFileSync('python3', [
        '-c',
        `import zipfile,sys
for name,path in [('exe','not-a-game.exe'),('traversal','../escape'),('bad-link','link')]:
 with zipfile.ZipFile(sys.argv[1]+'/'+name+'.zip','w') as z:
  i=zipfile.ZipInfo(path)
  if name=='bad-link':
   i.create_system=3
   i.external_attr=0o120777<<16
  z.writestr(i,b'payload')`,
        tmp
      ]);
      for (const [file, code] of [
        ['exe', 'archive-executable'],
        ['traversal', 'archive-invalid'],
        ['bad-link', 'archive-invalid']
      ])
        await assert.rejects(
          upload(await readFile(join(tmp, file + '.zip')), file + '.zip'),
          new RegExp(code)
        );
      assert.equal((await weather.nativeScene({})).selected, beta.id);
    } finally {
      weather.close();
      await rm(tmp, {recursive: true, force: true});
    }
  }
);
