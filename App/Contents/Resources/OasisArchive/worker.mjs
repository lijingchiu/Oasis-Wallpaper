import {createWriteStream} from 'node:fs';
import {mkdir, readFile, statfs, writeFile} from 'node:fs/promises';
import {basename, dirname, extname, join, posix} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {crc32} from 'node:zlib';
import yauzl from 'yauzl';

const [archive, output] = process.argv.slice(2);
const MB = 1024 * 1024;
const fail = (code) => {
  throw Error(code);
};
const signature = (s) => s.normalize('NFC').toLowerCase();
const playable = /\.(mp4|m4v|mov|gif|png|jpe?g|webp)$/i;
const binary = /\.(?:exe|dll|msi|cmd|bat|com|ps1|vbs|dylib|so|sh)$/i;

async function convert() {
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
      if (String(project.type).toLowerCase() === 'web' && /\.html?$/i.test(target.fileName))
        return await web(target, root, project);
      if (String(project.type).toLowerCase() === 'video' && playable.test(target.fileName))
        return await media(target);
    }
    const unity = files
      .filter((f) => /\.exe$/i.test(f.fileName))
      .map((f) => f.fileName.slice(0, -4) + '_Data/')
      .find((root) => lookup(root + 'globalgamemanagers'));
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
    /^(?:archive-(?:invalid|size|format|executable|rig|controls)|image-space)$/.test(e.message)
      ? e.message
      : 'archive-invalid'
  );
  process.exitCode = 1;
}
