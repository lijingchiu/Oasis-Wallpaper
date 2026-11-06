import {createWriteStream} from 'node:fs';
import {copyFile, mkdir, open, readFile, statfs, writeFile} from 'node:fs/promises';
import {basename, dirname, extname, join, posix} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {crc32} from 'node:zlib';
import yauzl from 'yauzl';

const [archive, output, mode, originalName = 'Wallpaper.exe'] = process.argv.slice(2);
const MB = 1024 * 1024;
const fail = (code) => {
  throw Error(code);
};
const signature = (s) => s.normalize('NFC').toLowerCase();
const playable = /\.(mp4|m4v|mov|gif|png|jpe?g|webp)$/i;
const binary = /\.(?:exe|dll|msi|cmd|bat|com|ps1|vbs|dylib|so|sh)$/i;

async function checkApplication(file) {
  const handle = await open(file, 'r');
  try {
    const header = Buffer.alloc(64), pe = Buffer.alloc(26);
    if ((await handle.read(header, 0, 64, 0)).bytesRead !== 64 || header.readUInt16LE(0) !== 0x5a4d) fail('archive-invalid');
    const offset = header.readUInt32LE(60);
    if (offset < 64 || (await handle.read(pe, 0, pe.length, offset)).bytesRead !== pe.length ||
        pe.readUInt32LE(0) !== 0x4550 || !(pe.readUInt16LE(22) & 2) || pe.readUInt16LE(22) & 0x2000) fail('archive-invalid');
    const size=(await handle.stat()).size,sections=pe.readUInt16LE(6),optional=pe.readUInt16LE(20);
    if (!sections || sections>96 || optional<96 || offset+24+optional+sections*40>size) fail('archive-invalid');
    const table=Buffer.alloc(sections*40);await handle.read(table,0,table.length,offset+24+optional);
    for(let i=0;i<table.length;i+=40){
      const bytes=table.readUInt32LE(i+16),start=table.readUInt32LE(i+20);
      if(bytes&&(start<offset+24+optional+table.length||start+bytes>size))fail('archive-invalid');
    }
    if (![[0x8664,0x20b],[0x14c,0x10b]].some(([machine, magic]) => pe.readUInt16LE(4) === machine && pe.readUInt16LE(24) === magic)) fail('archive-architecture');
  } finally { await handle.close(); }
}
async function applicationManifest(entry, preview) {
  const directory = join(output, 'application');
  await checkApplication(join(directory, entry));
  await writeFile(join(directory, 'project.json'), JSON.stringify({type:'application', file:entry, preview}), {mode:0o600});
  return {kind:'application', file:'application'};
}
async function convert() {
  if (mode === 'exe') {
    const name = basename(originalName);
    if (!/\.exe$/i.test(name) || /[\\:\x00-\x1f]/.test(name) || name.startsWith('.')) fail('archive-invalid');
    const directory = join(output,'application','files');
    await mkdir(directory,{recursive:true,mode:0o700});
    await copyFile(archive,join(directory,name));
    return applicationManifest('files/'+name);
  }
  const zip = await yauzl.openPromise(archive, {autoClose: false, strictFileNames: true});
  try {
    const entries = new Map(),
      seen = new Set();
    if (zip.entryCount > 30000) fail('archive-size');
    for await (const entry of zip.eachEntry()) {
      const name = entry.fileName.replace(/\/$/, '');
      const parts = name.split('/');
      const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
      if (
        !name ||
        name.length > 1024 ||
        parts.length > 32 ||
        parts.some((p) => !p || p === '.' || p === '..' || p.length > 255 || /[\\:\x00-\x1f]/.test(p)) ||
        (mode && mode !== 0o100000 && mode !== 0o040000) ||
        entry.generalPurposeBitFlag & 1 ||
        !Number.isSafeInteger(entry.uncompressedSize)
      )
        fail('archive-invalid');
      const key = signature(name);
      if (seen.has(key)) fail('archive-invalid');
      seen.add(key);
      if (
        entry.fileName.endsWith('/') ||
        mode === 0o040000 ||
        parts.some((p) => p.startsWith('.')) ||
        parts[0] === '__MACOSX'
      )
        continue;
      entries.set(key, entry);
    }
    for (const name of entries.keys()) {
      const parts = name.split('/');
      for (let i = 1; i < parts.length; i++)
        if (entries.has(parts.slice(0, i).join('/'))) fail('archive-invalid');
    }
    const files = [...entries.values()];
    const lookup = (name) => entries.get(signature(name));
    const read = async (entry, limit, target) => {
      if (entry.uncompressedSize > limit) fail('archive-size');
      let total = 0,
        checksum = 0;
      const check = new Transform({
        transform(chunk, encoding, done) {
          total += chunk.length;
          if (total > entry.uncompressedSize || total > limit) return done(Error('archive-invalid'));
          checksum = crc32(chunk, checksum);
          done(null, chunk);
        }
      });
      const stream = await zip.openReadStreamPromise(entry);
      const chunks = [];
      if (target) {
        await mkdir(dirname(target), {recursive: true, mode: 0o700});
        await pipeline(stream, check, createWriteStream(target, {flags: 'wx', mode: 0o600}));
      } else {
        await pipeline(stream, check, async function (s) {
          for await (const chunk of s) chunks.push(chunk);
        });
      }
      if (total !== entry.uncompressedSize || checksum !== entry.crc32) fail('archive-invalid');
      return target ? target : Buffer.concat(chunks, total);
    };
    const space = async (size) => {
      const fs = await statfs(output);
      if (size + 96 * MB > Number(fs.bavail) * Number(fs.bsize)) fail('image-space');
    };
    const media = async (entry) => {
      await space(entry.uncompressedSize);
      const suffix = extname(entry.fileName).toLowerCase();
      await read(entry, Number.MAX_SAFE_INTEGER, join(output, 'media' + suffix));
      return {kind: /\.(mp4|m4v|mov)$/.test(suffix) ? 'video' : 'image', file: 'media' + suffix};
    };
    const web = async (entry, root, manifest) => {
      // Only this project's assets reach its isolated Web origin. Windows programs never run.
      const list = files.filter((f) => f.fileName.startsWith(root) && !binary.test(f.fileName));
      await space(list.reduce((sum, f) => sum + f.uncompressedSize, 0));
      const project = join(output, 'web');
      for (const f of list) {
        const name = f.fileName.slice(root.length);
        if (signature(name) === 'project.json') continue;
        await read(f, Number.MAX_SAFE_INTEGER, join(project, name));
      }
      await writeFile(
        join(project, 'project.json'),
        JSON.stringify({...manifest, type: 'web', file: entry.fileName.slice(root.length)}),
        {mode: 0o600}
      );
      return {kind: 'web', file: 'web'};
    };
    const application = async (target) => {
      await space(files.reduce((total, f) => total + f.uncompressedSize, 0));
      const directory = join(output,'application','files');
      for (const f of files) await read(f, Number.MAX_SAFE_INTEGER, join(directory, f.fileName));
      const preview = files.find(f => /^(preview|cover)\.(png|jpe?g|gif)$/i.test(basename(f.fileName)));
      return applicationManifest('files/'+target.fileName, preview ? 'files/'+preview.fileName : undefined);
    };
    const manifests = files
      .filter((f) => basename(f.fileName).toLowerCase() === 'project.json')
      .sort((a, b) => a.fileName.length - b.fileName.length);
    for (const file of manifests) {
      let project;
      try {
        project = JSON.parse((await read(file, 2 * MB)).toString('utf8').replace(/^\uFEFF/, ''));
      } catch {
        continue;
      }
      const root = file.fileName.slice(0, -'project.json'.length),
        target =
          typeof project?.file === 'string' ? lookup(root + project.file.replaceAll('\\', '/')) : null;
      if (!target) continue;
      if (mode === 'desktop' && ['application','exe'].includes(String(project.type).toLowerCase()) && /\.exe$/i.test(target.fileName)) return await application(target);
      if (String(project.type).toLowerCase() === 'web' && /\.html?$/i.test(target.fileName))
        return await web(target, root, project);
      if (String(project.type).toLowerCase() === 'video' && playable.test(target.fileName))
        return await media(target);
    }
    const unity = files
      .filter((f) => /\.exe$/i.test(f.fileName))
      .map((f) => f.fileName.slice(0, -4) + '_Data/')
      .find((root) => lookup(root + 'globalgamemanagers'));
    if (mode === 'desktop') {
      const candidates = files.filter(f => /\.exe$/i.test(f.fileName) && !/^(?:UnityCrashHandler\d*|unins\d*|uninstall(?:er)?|setup|install(?:er)?|vc_redist[^.]*)\.exe$/i.test(basename(f.fileName)));
      if (candidates.length) {
        const games = candidates.filter(f => lookup(f.fileName.slice(0,-4)+'_Data/globalgamemanagers'));
        const list = games.length ? games : candidates;
        const top = Math.min(...list.map(f => f.fileName.split('/').length));
        const leaders = list.filter(f => f.fileName.split('/').length === top);
        if (leaders.length !== 1) fail('archive-ambiguous');
        return await application(leaders[0]);
      }
    }
    if (unity) {
      const {makeUnityWallpaper} = await import('./unity.mjs');
      const records = files
        .filter((f) => signature(f.fileName).startsWith(signature(unity)))
        .map((entry) => ({entry, name: entry.fileName.slice(unity.length)}))
        .filter(
          (x) =>
            !x.name.includes('/') &&
            /^(?:globalgamemanagers(?:\.assets)?|level\d+|.*\.(?:assets|ress|resource))$/i.test(x.name)
        );
      // Decoding Unity objects is an in-memory operation in the worker; ordinary video ZIPs stream.
      if (records.reduce((n, x) => n + x.entry.uncompressedSize, 0) > 768 * MB) fail('archive-size');
      const assets = [];
      for (const {entry, name} of records) assets.push({name, data: await read(entry, 512 * MB)});
      await space(128 * MB);
      const player = await makeUnityWallpaper(assets, join(output, 'web'));
      return {kind: 'web', file: 'web', player};
    }
    const hasExecutable = files.some((f) => /\.exe$/i.test(f.fileName));
    const html = files
      .filter((f) => /^(index|wallpaper)\.html?$/i.test(basename(f.fileName)))
      .sort((a, b) => a.fileName.split('/').length - b.fileName.split('/').length);
    if (
      html.length === 1 &&
      (!hasExecutable ||
        /(?:^|\/)resources\/app\//i.test(html[0].fileName) ||
        lookup(posix.join(posix.dirname(html[0].fileName), 'package.json')))
    ) {
      const entry = html[0],
        parent = posix.dirname(entry.fileName);
      return await web(entry, parent === '.' ? '' : parent + '/', {});
    }
    if (files.some((f) => /\.exe$/i.test(f.fileName))) fail('archive-executable');
    const choices = files.filter(
      (f) =>
        playable.test(f.fileName) &&
        !/^(?:preview|thumbnail|thumb|cover|icon)\./i.test(basename(f.fileName))
    );
    if (choices.length === 1) return await media(choices[0]);
    fail('archive-format');
  } finally {
    zip.close();
  }
}

try {
  process.stdout.write(JSON.stringify(await convert()));
} catch (e) {
  process.stderr.write(
    /^(?:archive-(?:invalid|size|format|executable|rig|controls|architecture|ambiguous)|image-space)$/.test(e.message)
      ? e.message
      : 'archive-invalid'
  );
  process.exitCode = 1;
}
