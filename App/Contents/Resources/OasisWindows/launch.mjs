import {spawn, execFile} from 'node:child_process';
import {mkdir, lstat, realpath, stat, symlink, readlink, unlink, access, writeFile} from 'node:fs/promises';
import {join, basename, dirname, relative, sep} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline';
import {promisify} from 'node:util';
import {prepareEngine, version} from './engine.mjs';
const here = dirname(fileURLToPath(import.meta.url)),
  self = fileURLToPath(import.meta.url);
const exec = promisify(execFile),
  controller = new AbortController();
const cache = join(homedir(), 'Library', 'Caches', 'Oasis Windows Runtime');
const report = (line) => process.stdout.write(line + '\n');
let forceQuit = null,
  player = null,
  closed = false,
  paused = false,
  engine,
  env,
  sandbox = [];
async function safeDir(path) {
  await mkdir(path, {recursive: true, mode: 0o700});
  if (!(await lstat(path)).isDirectory() || (await realpath(path)) !== path) throw Error('profile-invalid');
  return path;
}
function childResult(child) {
  return new Promise((ok, no) => {
    child.once('error', no);
    child.once('exit', (code, signal) => ok({code, signal}));
  });
}
const lines = createInterface({input: process.stdin, terminal: false});
let proxy = null,
  volume = null;
function stop() {
  if (closed) return;
  closed = true;
  controller.abort();
  proxy?.stdin.end();
  if (player) {
    const own = player;
    own.kill('SIGCONT');
    if (own.stdin.writable) own.stdin.write('quit\n');
    forceQuit = setTimeout(() => {
      own.kill('SIGKILL');
    }, 4000);
  }
}
lines.on('close', stop);
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
lines.on('line', (line) => {
  if (/^volume (?:100|[0-9]{1,2})(?:\.[0-9]+)?$/.test(line)) {
    volume = Number(line.slice(7));
    if (!proxy && player?.stdin.writable) player.stdin.write(line + '\n');
  }
  if (line === 'quit') {
    stop();
    return;
  }
  if (line === 'pause' || line === 'play') {
    paused = line === 'pause';
    if (player) player.kill(paused ? 'SIGSTOP' : 'SIGCONT');
  }
  if (proxy?.stdin.writable) {
    proxy.stdin.write(line + '\n');
    return;
  }
  if (!paused && player?.stdin.writable && /^(down|up|drag|move) -?[\d.]+ -?[\d.]+$/.test(line))
    player.stdin.write(line + '\n');
});
function silentPipe(stream) {
  stream?.on('error', () => {});
}
async function locked(args, passInput = true) {
  const child = spawn('/usr/bin/lockf', args, {stdio: ['pipe', 'pipe', 'ignore']});
  silentPipe(child.stdin);
  child.stdout.pipe(process.stdout, {end: false});
  proxy = child;
  if (closed) child.stdin.end();
  else if (passInput) {
    if (paused) child.stdin.write('pause\n');
    if (volume !== null) child.stdin.write('volume ' + volume + '\n');
  }
  try {
    const result = await childResult(child);
    if (!closed && result.code !== 0) throw Error('runtime-failed');
  } finally {
    proxy = null;
  }
}
async function start(opt, managedCache) {
  if (
    !/^custom-[0-9a-f-]{36}$/.test(opt.id) ||
    !/^[a-zA-Z0-9_-]{1,80}$/.test(opt.screen) ||
    !/^files\/.+\.exe$/i.test(opt.entry) ||
    opt.entry.split('/').some((x) => !x || x === '.' || x === '..' || /[\\:\x00-\x1f]/.test(x))
  )
    throw Error('application-invalid');
  const root = await realpath(opt.root);
  if (root !== opt.root || basename(root) !== opt.id || basename(dirname(root)) !== 'weather-packages')
    throw Error('application-invalid');
  const files = join(root, 'files'),
    exe = join(root, opt.entry);
  if ((await realpath(exe)) !== exe || !(await lstat(exe)).isFile()) throw Error('application-invalid');
  if (process.arch === 'arm64') {
    try {
      await exec('/usr/bin/arch', ['-x86_64', '/usr/bin/true']);
    } catch {
      throw Error('rosetta-required');
    }
  }
  await safeDir(managedCache);
  // Registry and saves are isolated per package and screen. The OS releases both locks on exit.
  const profiles = await safeDir(join(dirname(dirname(root)), 'weather-windows'));
  const titleDir = await safeDir(join(profiles, opt.id)),
    instance = await safeDir(join(titleDir, opt.screen));
  if (process.argv[2] === 'start') {
    try {
      await access(join(managedCache, version, 'complete'));
    } catch {
      report('preparing');
      await locked(
        ['-k', join(managedCache, 'prepare.lock'), process.execPath, self, 'install', managedCache],
        false,
      );
    }
    if (closed) return;
    await locked([
      '-k',
      join(instance, 'play.lock'),
      process.execPath,
      self,
      'play',
      JSON.stringify(opt),
      managedCache,
    ]);
    return;
  }
  if (closed) return;
  engine = await prepareEngine(managedCache, controller.signal);
  const run = await safeDir(join(instance, 'session')),
    prefix = await safeDir(join(run, 'prefix')),
    tmp = await safeDir(join(run, 'tmp'));
  const dos = await safeDir(join(prefix, 'dosdevices')),
    home = await safeDir(join(run, 'home'));
  await safeDir(join(prefix, 'drive_c'));
  try {
    await symlink('../drive_c', join(dos, 'c:'));
  } catch (e) {
    if (e.code !== 'EEXIST' || (await readlink(join(dos, 'c:'))) !== '../drive_c')
      throw Error('profile-invalid');
  }
  try {
    await symlink('/', join(dos, 'z:'));
  } catch (e) {
    if (e.code !== 'EEXIST' || (await readlink(join(dos, 'z:'))) !== '/') throw Error('profile-invalid');
  }
  await unlink(join(dos, 'w:')).catch((e) => {
    if (e.code !== 'ENOENT') throw e;
  });
  await symlink(files, join(dos, 'w:'));
  const info = await stat(prefix, {bigint: true}),
    socket = join(
      '/private/tmp',
      '.wine-' + process.getuid(),
      'server-' + info.dev.toString(16) + '-' + info.ino.toString(16),
    );
  await safeDir(dirname(socket));
  await safeDir(socket);
  const host = join(here, 'OasisWinHost'),
    displayID = Number(opt.display);
  if (!Number.isInteger(displayID) || displayID < 1 || displayID > 0xffffffff) throw Error('screen-invalid');
  env = {
    PATH: '/usr/bin:/bin',
    LANG: 'en_US.UTF-8',
    HOME: home,
    TMPDIR: tmp,
    WINEPREFIX: prefix,
    WINEDEBUG: '-all',
    WINELOADER: join(engine, 'bin/wine'),
    WINESERVER: join(engine, 'bin/wineserver'),
    WINEDLLOVERRIDES: 'winemenubuilder.exe=d;mscoree,mshtml=',
    MVK_CONFIG_USE_METAL_ARGUMENT_BUFFERS: '1',
    MVK_CONFIG_LOG_LEVEL: '0',
    DXVK_LOG_LEVEL: 'none',
    DXVK_STATE_CACHE_PATH: tmp,
    VK_ICD_FILENAMES: join(engine, 'share/vulkan/icd.d/MoltenVK_icd.json'),
    OASIS_DISPLAY_ID: String(displayID),
    OASIS_WALLPAPER_VOLUME: String(volume ?? opt.volume ?? 0),
  };
  sandbox = [
    '-D',
    'ENGINE=' + engine,
    '-D',
    'FILES=' + files,
    '-D',
    'RUNDIR=' + run,
    '-D',
    'WINESOCK=' + socket,
    '-D',
    'PLAYER=' + host,
    '-D',
    'AUDIO=' + join(here, 'libOasisWallpaperAudio.dylib'),
    '-f',
    join(here, 'wallpaper.sb'),
  ];
  const boot = join(engine, 'bin/wine'),
    complete = join(instance, 'profile-' + version);
  let status, timer;
  try {
    try {
      await access(complete);
      await access(join(prefix, 'drive_c/windows/system32/kernel32.dll'));
    } catch {
      report('starting');
      await unlink(join(prefix, '.update-timestamp')).catch((e) => {
        if (e.code !== 'ENOENT') throw e;
      });
      await exec('/usr/bin/sandbox-exec', [...sandbox, boot, 'wineboot.exe', '-u'], {
        env,
        cwd: run,
        signal: controller.signal,
        timeout: 120000,
        maxBuffer: 1024 * 1024,
      });
      await exec('/usr/bin/sandbox-exec', [...sandbox, join(engine, 'bin/wineserver'), '-w'], {
        env,
        signal: controller.signal,
        timeout: 120000,
      });
      await access(join(prefix, 'drive_c/windows/system32/kernel32.dll'));
      await writeFile(complete, version, {mode: 0o600});
    }
    const windowsPath = 'W:\\' + relative(files, exe).split(sep).join('\\'),
      args = [...sandbox, host, engine, windowsPath];
    const unity = await access(exe.slice(0, -4) + '_Data/globalgamemanagers').then(
      () => true,
      () => false,
    );
    if (unity) {
      args.push(
        '-screen-fullscreen',
        '0',
        '-popupwindow',
        '-screen-width',
        String(Math.min(16384, Math.max(200, Math.round(opt.width)))),
        '-screen-height',
        String(Math.min(16384, Math.max(140, Math.round(opt.height)))),
      );
    }
    if (closed) return;
    report('starting');
    player = spawn('/usr/bin/sandbox-exec', args, {
      cwd: dirname(exe),
      env,
      stdio: ['pipe', 'ignore', 'ignore', 'pipe'],
    });
    silentPipe(player.stdin);
    let ready = false;
    status = createInterface({input: player.stdio[3]});
    status.on('line', (line) => {
      if (line === 'audio-ready') {
        report(line);
        return;
      }
      if (/^ready \d+ \d+$/.test(line)) {
        ready = true;
        report(line);
        if (volume !== null) player?.stdin.write('volume ' + volume + '\n');
        if (paused) player?.kill('SIGSTOP');
      }
    });
    timer = setTimeout(() => {
      if (!ready && !closed) {
        report('error startup-timeout');
        player?.kill('SIGTERM');
      }
    }, 120000);
    const result = await childResult(player);
    if (!closed && (!ready || result.code !== 0)) throw Error('application-exited');
  } finally {
    clearTimeout(timer);
    clearTimeout(forceQuit);
    player = null;
    status?.close();
    // Scope both commands to this prefix. A display switching away cannot stop another game.
    for (const op of ['-k', '-w'])
      await exec('/usr/bin/sandbox-exec', [...sandbox, join(engine, 'bin/wineserver'), op], {
        env,
        timeout: 8000,
      }).catch(() => {});
  }
}
try {
  if (process.argv[2] === 'install') {
    let previous = -1;
    await prepareEngine(process.argv[3], controller.signal, (n) => {
      if (n !== previous) {
        previous = n;
        report('progress ' + n);
      }
    });
  } else if (['start', 'play'].includes(process.argv[2])) {
    await start(JSON.parse(process.argv[3]), process.argv[4] || cache);
  } else throw Error('application-invalid');
} catch (error) {
  if (!closed) {
    const code = [
      'rosetta-required',
      'engine-checksum',
      'engine-space',
      'startup-timeout',
      'application-invalid',
      'application-exited',
      'engine-download',
      'profile-invalid',
      'runtime-failed',
    ].includes(error.message)
      ? error.message
      : 'runtime-failed';
    report('error ' + code);
    process.exitCode = 1;
  }
} finally {
  lines.close();
  process.stdin.destroy();
}
