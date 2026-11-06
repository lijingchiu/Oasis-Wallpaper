import {createHash} from 'node:crypto';
import {createWriteStream} from 'node:fs';
import {access, copyFile, mkdir, mkdtemp, rename, rm, statfs, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const exec = promisify(execFile);
export const version = 'wine-11.21-dxvk-1.10.3-r1';
const wine = {
  url: 'https://github.com/Gcenx/macOS_Wine_builds/releases/download/11.21/wine-devel-11.21-osx64.tar.xz',
  sha: '9909b486657e10ab66c7279371ae1f990345b596b3b1b3a0cf21f28af24fa0ce',
  size: 225612636,
};
const dxvk = {
  url: 'https://github.com/Gcenx/DXVK-macOS/releases/download/v1.10.3-20230507-repack/dxvk-macOS-async-v1.10.3-20230507-repack-builtin.tar.gz',
  sha: '810b1e5caf8ce975b784fae866a130ad23fa0ea233b0e5609cbc4a45f3ef6f00',
  size: 2785833,
};
const winePath = 'Wine Devel.app/Contents/Resources/wine';
const dxvkPath = 'dxvk-macOS-async-v1.10.3-20230507-repack-builtin';
async function download(item, file, signal, progress) {
  const timeout = AbortSignal.any([signal, AbortSignal.timeout(900000)]);
  let response;
  try {
    response = await fetch(item.url, {signal: timeout});
  } catch {
    throw Error('engine-download');
  }
  if (!response.ok || !response.body) throw Error('engine-download');
  const hash = createHash('sha256');
  let count = 0;
  await pipeline(
    response.body,
    new Transform({
      transform(chunk, _, done) {
        count += chunk.length;
        if (count > item.size) return done(Error('engine-checksum'));
        hash.update(chunk);
        progress(count);
        done(null, chunk);
      },
    }),
    createWriteStream(file, {flags: 'wx', mode: 0o600}),
    {signal: timeout},
  );
  if (count !== item.size || hash.digest('hex') !== item.sha) throw Error('engine-checksum');
}
export async function prepareEngine(cache, signal, progress = () => {}) {
  const target = join(cache, version),
    engine = join(target, 'engine');
  const ready = () =>
    access(join(target, 'complete')).then(
      () => true,
      () => false,
    );
  if (await ready()) return engine;
  await mkdir(cache, {recursive: true, mode: 0o700});
  // A new screen can be selected while the first screen is still downloading.
  // Hold an OS advisory lock in the caller; also publish a complete directory atomically.
  const available = await statfs(cache);
  if (available.bavail * available.bsize < 1300 * 1024 * 1024) throw Error('engine-space');
  const temp = await mkdtemp(join(cache, '.prepare-'));
  try {
    await download(wine, join(temp, 'base.tar'), signal, (n) =>
      progress(Math.floor((95 * n) / (wine.size + dxvk.size))),
    );
    await download(dxvk, join(temp, 'graphics.tar'), signal, (n) =>
      progress(Math.floor((95 * (wine.size + n)) / (wine.size + dxvk.size))),
    );
    await exec('/usr/bin/tar', ['-xf', join(temp, 'base.tar'), '-C', temp, winePath], {signal});
    await exec('/usr/bin/tar', ['-xf', join(temp, 'graphics.tar'), '-C', temp], {signal});
    const packageDir = join(temp, 'publish');
    await mkdir(packageDir);
    const root = join(packageDir, 'engine');
    await rename(join(temp, winePath), root);
    for (const arch of ['x86_64-windows', 'i386-windows']) {
      for (const file of ['d3d11.dll', 'd3d10core.dll']) {
        await copyFile(join(temp, dxvkPath, arch, file), join(root, 'lib', 'wine', arch, file));
      }
    }
    await access(join(root, 'bin/wineserver'));
    await access(join(root, 'lib/wine/x86_64-unix/ntdll.so'));
    await writeFile(join(packageDir, 'complete'), version, {mode: 0o600});
    try {
      await rename(packageDir, target);
    } catch (e) {
      if (!(await ready())) throw e;
    }
    progress(100);
    return engine;
  } finally {
    await rm(temp, {recursive: true, force: true});
  }
}
