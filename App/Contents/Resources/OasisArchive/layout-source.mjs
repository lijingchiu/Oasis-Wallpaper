import {gameObject, rectTransform} from './scene.mjs';
const raw = (a) =>
  Buffer.from(a.reader.bytes.buffer, a.reader.bytes.byteOffset, a.reader.bytes.byteLength);
const color = (b, p) =>
  Array.from({length: 4}, (_, i) => Math.min(1, Math.max(0, b.readFloatLE(p + 4 * i))));
export async function readCanvas(env, assets, saveArt, prefabClass = null) {
  const map = new Map(assets.map((a) => [a.file + '#' + a.pathId, a]));
  const prefab =
    prefabClass &&
    assets.find(
      (a) =>
        a.type === 'MonoBehaviour' &&
        !/^level\d+$/.test(a.file) &&
        resolve(a, a.data.script)?.data?.className === prefabClass
    );
  if (prefabClass && !prefab) throw Error('archive-controls');
  const level = prefab
    ? prefab.file
    : assets.find((a) => /^level\d+$/.test(a.file) && a.classId === 1)?.file;
  const nodes = new Map(),
    rects = new Map(),
    captures = new Map();
  function resolve(a, ptr) {
    const t = env.resolve(ptr, a.reader).object;
    return t && map.get(t.fileName + '#' + t.pathId);
  }
  function assetAt(a, b, off) {
    return resolve(a, {m_FileID: b.readInt32LE(off), m_PathID: b.readBigInt64LE(off + 4)});
  }
  for (const a of assets.filter((a) => a.file === level)) {
    if (a.classId === 1) {
      const info = gameObject(a);
      if (info)
        nodes.set(String(a.pathId), {
          id: String(a.pathId),
          name: info.name,
          active: info.active,
          components: [],
          children: []
        });
    }
    if (a.classId === 224) {
      const rect = rectTransform(a);
      if (rect) rects.set(String(a.pathId), {...rect, bytes: raw(a)});
    }
  }
  for (const [id, r] of rects) {
    const n = nodes.get(String(r.owner));
    if (!n) continue;
    captures.set(id, n);
    const b = r.bytes,
      q = [0, 1, 2, 3].map((i) => b.readFloatLE(12 + i * 4));
    n.rect = {
      min: r.min,
      max: r.max,
      pos: r.pos,
      size: r.size,
      pivot: r.pivot,
      scale: r.scale,
      angle:
        (-Math.atan2(2 * (q[3] * q[2] + q[0] * q[1]), 1 - 2 * (q[1] ** 2 + q[2] ** 2)) * 180) / Math.PI
    };
  }
  for (const [id, r] of rects) {
    const n = captures.get(id);
    if (n) n.children = r.children.map((c) => captures.get(String(c))?.id).filter(Boolean);
  }
  let root = prefab ? nodes.get(String(prefab.data.gameObject.m_PathID)) : null,
    reference = root?.rect?.size || [1920, 1080],
    match = 0.5;
  const subtree = new Set();
  function visit(n) {
    if (!n || subtree.has(n) || subtree.size >= 3000) throw Error('archive-controls');
    subtree.add(n);
    for (const id of n.children) visit(nodes.get(id));
  }
  if (prefab) visit(root);
  for (const a of assets.filter((a) => a.file === level && a.type === 'MonoBehaviour')) {
    const h = a.data,
      n = nodes.get(String(h.gameObject.m_PathID)),
      script = resolve(a, h.script),
      cls = script?.data?.className;
    if (!n || !h.enabled || !cls || (prefab && !subtree.has(n))) continue;
    const b = raw(a);
    n.components.push(cls);
    if (cls === 'CanvasScaler' && n.active && !root) {
      root = n;
      reference = [b.readFloatLE(44), b.readFloatLE(48)];
      match = b.readFloatLE(56);
    }
    if (cls === 'Mask') n.showMask = !!b[32];
    if (cls === 'SkeletonGraphic') n.skeleton = assetAt(a, b, 88)?.name;
    if (cls === 'UIRotate') n.spin = b.readFloatLE(32);
    if (cls === 'UIRandomSize') n.randomSize = [b.readFloatLE(32), b.readFloatLE(36)];
    if (cls === 'UIRandomColorTransition') n.colours = [color(b, 32), color(b, 48)];
    if (cls === 'UIFlip') n.flip = [b[32] ? -1 : 1, b[36] ? -1 : 1];
    if (cls === 'SongVisableManager')
      n.spectrum = {space: b.readFloatLE(56), fall: b.readFloatLE(60), force: b.readFloatLE(64)};
    if (cls === 'Image' && b.length >= 100) {
      const sprite = assetAt(a, b, 88);
      n.image = {tint: color(b, 44), file: sprite?.type === 'Sprite' ? await saveArt(sprite) : null};
      if (sprite?.type === 'Sprite') n.image.sprite = sprite.name;
    }
    if (cls === 'HorizontalLayoutGroup' || cls === 'VerticalLayoutGroup') {
      n.layout = {
        vertical: cls.startsWith('V'),
        padding: [32, 36, 40, 44].map((p) => b.readInt32LE(p)),
        align: b.readInt32LE(48),
        spacing: b.readFloatLE(52),
        expandW: !!b[56],
        expandH: !!b[57],
        controlW: !!b[60],
        controlH: !!b[61],
        reverse: !!b[64]
      };
    }
    if (cls === 'GridLayoutGroup')
      n.grid = {
        padding: [32, 36, 40, 44].map((p) => b.readInt32LE(p)),
        cell: [b.readFloatLE(60), b.readFloatLE(64)],
        spacing: [b.readFloatLE(68), b.readFloatLE(72)],
        columns: b.readInt32LE(76) === 1 ? b.readInt32LE(80) : 0
      };
    if (cls === 'TextMeshProUGUI' && b.length > 300) {
      const len = b.readUInt32LE(88),
        aligned = (len + 3) & ~3;
      if (len <= 4096 && 292 + aligned < b.length) {
        n.text = b.toString('utf8', 92, 92 + len);
        n.font = b.readFloatLE(284 + aligned);
      }
    }
    if (cls === 'AnimationSpeedButton') n.speed = b.readFloatLE(32);
    if (cls === 'Button' || cls === 'Slider' || cls === 'EventTrigger') {
      const names = [];
      for (let i = 32; i + 4 <= b.length; i += 4) {
        const len = b.readUInt32LE(i);
        if (len < 2 || len > 150 || i + 4 + len > b.length) continue;
        const s = b.toString('utf8', i + 4, i + 4 + len);
        if (/^[a-z][A-Za-z0-9 _,.()-]+$/i.test(s)) names.push(s);
      }
      const methods = names.flatMap((str, i) =>
        str.endsWith(', Assembly-CSharp') && names[i + 1] ? [names[i + 1]] : []
      );
      n.actions = [...new Set([...(n.actions || []), ...methods])];
    }
  }
  if (!root || !reference.every((f) => Number.isFinite(f) && f >= (prefab ? 1 : 240) && f <= 16384))
    throw Error('archive-controls');
  if (prefab) root.active = true;
  const visibleTree = [];
  function collect(n, depth) {
    if (!n || depth > 64 || visibleTree.length >= 3000) throw Error('archive-controls');
    visibleTree.push(n);
    for (const id of n.children) collect(nodes.get(id), depth + 1);
  }
  collect(root, 0);
  return {root: root.id, reference, match, nodes: visibleTree};
}
