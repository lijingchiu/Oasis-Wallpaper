import {mkdir, readFile, writeFile, copyFile} from 'node:fs/promises';
import {join, posix} from 'node:path';
import {load} from 'unity-asset-reader';
import {decodeImage} from 'unity-asset-reader-texture';
import {PNG} from 'pngjs';
import {unpackPage} from './atlas.mjs';
import {readCanvas} from './layout-source.mjs';
import {collectionFrom} from './collection.mjs';
import {readFsb5} from 'unity-asset-reader-audio';
import {unityCanvas} from './scene.mjs';
import {normalizeRig, initialState, chosenSkins, createRig} from './rig.mjs';

const local = (name) => new URL(name, import.meta.url);
const key = (name) => posix.basename(name).normalize('NFC').toLowerCase();
const atlasKey = (name) => key(name).replace(/(?:\.atlas(?:\.txt)?|\.json|\.png|\.webp|\.jpg)$/, '');
const packetError = () => {
  throw Error('archive-rig');
};

function readRig(assets, descriptor) {
  const text = assets.filter((a) => a.type === 'TextAsset' && a.byteSize < 16 * 1024 * 1024);
  const textures = assets.filter((a) => a.type === 'Texture2D');
  const atlases = text.filter((a) => /\.atlas(?:\.txt)?$/i.test(a.name));
  for (const skeleton of descriptor ? [descriptor.skeleton] : text) {
    const raw = skeleton.data.text?.trimStart();
    if (!raw?.startsWith('{')) continue;
    let rig;
    try {
      rig = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!rig?.skeleton?.spine || !Array.isArray(rig.bones)) continue;
    const atlas =
      descriptor?.atlas ||
      atlases.find((a) => atlasKey(a.name) === atlasKey(skeleton.name)) ||
      (atlases.length === 1 ? atlases[0] : null);
    if (!atlas) continue;
    const data = atlas.data.text
      .replace(/^\uFEFF/, '')
      .replace(/\r/g, '')
      .trim();
    const pages = data.split(/\n\s*\n/).map((block) => block.split('\n')[0].trim());
    if (!pages.length || pages.length > 32) packetError();
    const images = pages.map((name) => {
      const matches = textures.filter((a) => atlasKey(a.name) === atlasKey(name));
      return (
        matches.find((a) => a.file === atlas.file) ||
        (matches.length === 1 && matches[0]) ||
        packetError()
      );
    });
    return {model: normalizeRig(rig), atlas: data, pages: images};
  }
  throw Error('archive-executable');
}
function bounds(vertices) {
  let l = Infinity,
    r = -Infinity,
    b = Infinity,
    t = -Infinity;
  for (let i = 0; i < vertices.length; i += 8) {
    l = Math.min(l, vertices[i]);
    r = Math.max(r, vertices[i]);
    b = Math.min(b, vertices[i + 1]);
    t = Math.max(t, vertices[i + 1]);
  }
  if (!Number.isFinite(l + r + b + t) || r <= l || t <= b) packetError();
  return [l, b, r, t];
}
function raster(frame, pages, box, width, height, transparent = false) {
  const out = Buffer.alloc(width * height * 4, transparent ? 0 : 255);
  const scale = Math.min(width / (box[2] - box[0]), height / (box[3] - box[1])) * 0.92;
  const ox = width / 2 - ((box[0] + box[2]) * scale) / 2,
    oy = height / 2 + ((box[1] + box[3]) * scale) / 2;
  const v = frame.vertices;
  for (let j = 0; j < frame.batches.length; j += 4) {
    const page = pages[frame.batches[j]],
      start = frame.batches[j + 2],
      end = start + frame.batches[j + 3];
    if (!page) continue;
    for (let tri = start; tri < end; tri += 3) {
      const a = tri * 8,
        b = a + 8,
        c = a + 16;
      const ax = ox + v[a] * scale,
        ay = oy - v[a + 1] * scale,
        bx = ox + v[b] * scale,
        by = oy - v[b + 1] * scale,
        cx = ox + v[c] * scale,
        cy = oy - v[c + 1] * scale;
      const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(den) < 1e-7) continue;
      for (
        let y = Math.max(0, Math.floor(Math.min(ay, by, cy)));
        y < Math.min(height, Math.ceil(Math.max(ay, by, cy)));
        y++
      )
        for (
          let x = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
          x < Math.min(width, Math.ceil(Math.max(ax, bx, cx)));
          x++
        ) {
          const w = ((by - cy) * (x + 0.5 - cx) + (cx - bx) * (y + 0.5 - cy)) / den,
            k = ((cy - ay) * (x + 0.5 - cx) + (ax - cx) * (y + 0.5 - cy)) / den,
            h = 1 - w - k;
          if (w < 0 || k < 0 || h < 0) continue;
          const fx = Math.max(
            0,
            Math.min(page.width - 1, (w * v[a + 2] + k * v[b + 2] + h * v[c + 2]) * page.width - 0.5)
          );
          const fy = Math.max(
            0,
            Math.min(page.height - 1, (w * v[a + 3] + k * v[b + 3] + h * v[c + 3]) * page.height - 0.5)
          );
          const u = Math.floor(fx),
            t = Math.floor(fy),
            du = fx - u,
            dv = fy - t,
            dst = 4 * (y * width + x);
          let alpha = 0,
            red = 0,
            green = 0,
            blue = 0;
          for (let j = 0; j < 2; j++)
            for (let i = 0; i < 2; i++) {
              const texel =
                4 * (Math.min(page.height - 1, t + j) * page.width + Math.min(page.width - 1, u + i));
              const weight =
                (((i ? du : 1 - du) * (j ? dv : 1 - dv) * page.rgba[texel + 3]) / 255) * v[a + 7];
              alpha += weight;
              red += page.rgba[texel] * weight;
              green += page.rgba[texel + 1] * weight;
              blue += page.rgba[texel + 2] * weight;
            }
          const previous = (out[dst + 3] / 255) * (1 - alpha),
            combined = alpha + previous;
          if (combined <= 0) continue;
          out[dst] = Math.round((out[dst] * previous + red * v[a + 4]) / combined);
          out[dst + 1] = Math.round((out[dst + 1] * previous + green * v[a + 5]) / combined);
          out[dst + 2] = Math.round((out[dst + 2] * previous + blue * v[a + 6]) / combined);
          out[dst + 3] = Math.round(combined * 255);
        }
    }
  }
  return out;
}
async function writeActor(assets, env, destination, wasm, descriptor) {
  const {model, atlas: packedAtlas, pages} = readRig(assets, descriptor);
  const scene = descriptor
    ? {buttons: [], decoration: [], icons: new Map(), initial: descriptor.clip}
    : unityCanvas(env, assets, model);
  await mkdir(destination, {recursive: true, mode: 0o700});
  // The browser receives self-contained data with locally generated filenames.
  let pixels = 0;
  async function picture(asset, name, atlasPage = null) {
    const tex = asset.type === 'Texture2D' ? asset.data : null;
    if (tex && (tex.width < 1 || tex.height < 1 || tex.width * tex.height > 33554432)) packetError();
    let p = await decodeImage(asset);
    if (atlasPage) {
      p = unpackPage(atlasPage, {
        ...p,
        rgba: Buffer.from(p.rgba.buffer, p.rgba.byteOffset, p.rgba.byteLength)
      });
    }
    pixels += p.width * p.height;
    if (pixels > 67108864) packetError();
    await writeFile(
      join(destination, name),
      PNG.sync.write({width: p.width, height: p.height, data: p.rgba})
    );
    return p;
  }
  const decoded = [],
    blocks = packedAtlas.split(/\n\s*\n/);
  scene.pages = [];
  for (const [i, page] of pages.entries()) {
    const name = 'page-' + i + '.png';
    scene.pages.push(name);
    decoded.push(await picture(page, name, blocks[i]));
  }
  const atlas = decoded.map((p) => p.atlas).join('\n\n');
  const rig = await createRig(wasm, model, atlas);
  const state = initialState(model, scene);
  rig.select(chosenSkins(model, scene, state));
  if (descriptor && !(descriptor.clip in model.animations)) packetError();
  const duration = rig.play(state.idle);
  if (!(duration > 0)) packetError();
  const frame = rig.frame(0);
  scene.bounds = bounds(frame.vertices);
  for (const [asset, name] of scene.icons) {
    await picture(asset, name);
    const items = scene.decoration.filter((d) => d.icon === name);
    const alternate =
      items.length && assets.find((a) => a.type === 'Texture2D' && a.name === asset.name + '_w');
    if (alternate) {
      const dark = 'dark-' + name;
      await picture(alternate, dark);
      for (const item of items) item.dark = dark;
    }
  }
  if (!descriptor)
    scene.layout = await readCanvas(env, assets, async (asset) => {
      if (scene.icons.has(asset)) return scene.icons.get(asset);
      const name = 'sprite-' + scene.icons.size + '.png';
      scene.icons.set(asset, name);
      await picture(asset, name);
      return name;
    });
  delete scene.icons;
  if (!descriptor || descriptor.preview)
    await writeFile(
      join(destination, 'preview.png'),
      PNG.sync.write({width: 1280, height: 720, data: raster(frame, decoded, scene.bounds, 1280, 720)})
    );
  if (descriptor && !descriptor.preview) {
    const width = 112,
      height = 224,
      frames = 12,
      sheet = Buffer.alloc(width * height * frames * 4);
    for (let i = 0; i < frames; i++) {
      const pose = i ? rig.frame(duration / frames) : frame;
      raster(pose, decoded, scene.bounds, width, height, true).copy(sheet, i * width * height * 4);
    }
    await writeFile(
      join(destination, 'poses.png'),
      PNG.sync.write({width, height: height * frames, data: sheet})
    );
  }
  await writeFile(join(destination, 'rig.json'), JSON.stringify(model));
  await writeFile(join(destination, 'rig.atlas'), atlas);
  await writeFile(join(destination, 'canvas.json'), JSON.stringify(scene));
  return {clip: state.idle, duration};
}

export async function makeUnityWallpaper(files, destination) {
  const env = load(files),
    assets = [...env.assets()],
    collection = collectionFrom(env, assets);
  const wasm = await readFile(local('mesh.wasm'));
  await mkdir(destination, {recursive: true, mode: 0o700});
  const common = [
    'stage.mjs',
    'rig.mjs',
    'mesh.wasm',
    'author-canvas.mjs',
    'author.css',
    'prefs-client.mjs'
  ];
  let entry;
  if (collection) {
    const catalog = {members: [], songs: []};
    const artwork = new Map();
    async function saveArt(asset) {
      if (!asset) return null;
      if (artwork.has(asset)) return artwork.get(asset);
      const name = 'art-' + artwork.size + '.png',
        img = await decodeImage(asset);
      if (img.width * img.height > 8 * 1024 * 1024) packetError();
      await writeFile(
        join(destination, name),
        PNG.sync.write({width: img.width, height: img.height, data: img.rgba})
      );
      artwork.set(asset, name);
      return name;
    }
    for (const [i, member] of collection.members.entries()) {
      const entries = [];
      for (const [j, descriptor] of member.entries.entries()) {
        const dir = 'actor-' + i + '-' + j;
        const result = await writeActor(assets, env, join(destination, dir), wasm, {
          ...descriptor,
          preview: j === 0
        });
        entries.push({dir, ...result, definition: descriptor.definition});
      }
      const {pattern, entries: _, ...appearance} = member;
      catalog.members.push({...appearance, pattern: await saveArt(pattern), entries});
    }
    await copyFile(
      join(destination, catalog.members[0].entries[0].dir, 'preview.png'),
      join(destination, 'preview.png')
    );
    catalog.layout = await readCanvas(env, assets, saveArt);
    catalog.poseSlot = await readCanvas(env, assets, saveArt, 'AnimationSlot');
    catalog.songSlot = await readCanvas(env, assets, saveArt, 'SongSlot');
    catalog.icons = {};
    for (const sprite of assets.filter(
      (a) => a.type === 'Sprite' && ['播放', '暫停', '循環', '單曲循環', '隨機'].includes(a.name)
    ))
      catalog.icons[sprite.name] = await saveArt(sprite);
    for (const {title, alternate, artist, lyricist, composer, clip, cover} of collection.songs) {
      const data = clip.data.audioData;
      const bank = readFsb5(data),
        sample = bank.samples[0];
      if (
        !sample ||
        ![1, 2, 4, 6, 7, 16].includes(bank.codec) ||
        sample.sampleCount * sample.channels * 4 > 256 * 1024 * 1024
      )
        throw Error('archive-format');
      const file = 'song-' + catalog.songs.length + '.fsb';
      await writeFile(join(destination, file), data);
      catalog.songs.push({
        title,
        alternate,
        artist,
        lyricist,
        composer,
        file,
        cover: await saveArt(cover),
        duration: sample.sampleCount / sample.frequency
      });
    }
    await writeFile(join(destination, 'collection.json'), JSON.stringify(catalog));
    common.push('band.html', 'band.mjs', 'effects.mjs', 'sound-worker.js');
    entry = 'band.html';
  } else {
    await writeActor(assets, env, destination, wasm);
    common.push('viewer.html', 'viewer.mjs');
    entry = 'viewer.html';
  }
  for (const name of common) await copyFile(local(name), join(destination, name));
  await writeFile(
    join(destination, 'project.json'),
    JSON.stringify({type: 'web', file: entry, preview: 'preview.png'})
  );
  return collection ? 'band' : 'actor';
}
