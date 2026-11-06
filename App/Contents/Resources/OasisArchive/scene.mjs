// Read the serialized Unity canvas. Use the author's button order, sprite, enum
// values and RectTransforms; a compiled callback without an adapter is not a button we can run.
const controlClasses = new Map([
  ['FeetStyleButton', 'pose'],
  ['SockStyleButton', 'style'],
  ['SockColorButton', 'colour'],
  ['DarkModeButton', 'theme']
]);
const key = (file, id) => file + '#' + id;
const bytes = (a) =>
  Buffer.from(a.reader.bytes.buffer, a.reader.bytes.byteOffset, a.reader.bytes.byteLength);
const f2 = (b, p) => [b.readFloatLE(p), b.readFloatLE(p + 4)];
export function gameObject(a) {
  const b = bytes(a),
    n = b.readInt32LE(0),
    offset = 8 + 12 * n;
  if (n < 0 || offset + 4 > b.length) return null;
  const length = b.readInt32LE(offset);
  if (length < 0 || length > 1024 || offset + 4 + length > b.length) return null;
  const end = (offset + 4 + length + 3) & ~3;
  return {
    name: b.toString('utf8', offset + 4, offset + 4 + length),
    active: end + 2 < b.length && b[end + 2] !== 0,
    components: []
  };
}
export function rectTransform(a) {
  const b = bytes(a);
  if (b.length < 108) return null;
  const n = b.readInt32LE(52),
    father = 56 + n * 12,
    tail = b.length - 40;
  if (n < 0 || father + 12 > tail) return null;
  const children = Array.from({length: n}, (_, i) => b.readBigInt64LE(60 + i * 12));
  return {
    owner: b.readBigInt64LE(4),
    father: b.readBigInt64LE(father + 4),
    children,
    min: f2(b, tail),
    max: f2(b, tail + 8),
    pos: f2(b, tail + 16),
    size: f2(b, tail + 24),
    pivot: f2(b, tail + 32),
    scale: f2(b, 40)
  };
}
function serializedNames(asset, names) {
  if (!asset) return [];
  const b = bytes(asset);
  return names.filter((name) => {
    const text = Buffer.from(name),
      at = b.indexOf(text);
    return at >= 4 && b.readUInt32LE(at - 4) === text.length;
  });
}
export function unityCanvas(env, assets, model) {
  const all = new Map(assets.map((a) => [key(a.file, a.pathId), a]));
  function resolve(a, ptr) {
    const target = env.resolve(ptr, a.reader).object;
    return target && all.get(key(target.fileName, target.pathId));
  }
  const level = assets.find((a) => /^level\d+$/i.test(a.file) && a.classId === 1)?.file;
  const nodes = new Map(),
    rects = new Map();
  for (const a of assets.filter((a) => a.file === level)) {
    if (a.classId === 1) {
      const node = gameObject(a);
      if (node) nodes.set(a.pathId, node);
    }
    if (a.classId === 224) {
      const r = rectTransform(a);
      if (r) rects.set(a.pathId, r);
    }
  }
  for (const [id, r] of rects) {
    const node = nodes.get(r.owner);
    if (node) {
      node.rect = r;
      node.id = id;
      node.parent = nodes.get(rects.get(r.father)?.owner);
    }
  }
  for (const a of assets.filter((a) => a.file === level && a.type === 'MonoBehaviour')) {
    const h = a.data,
      node = nodes.get(h.gameObject.m_PathID),
      script = resolve(a, h.script);
    if (node && h.enabled && script?.type === 'MonoScript')
      node.components.push([script.data.className, a]);
  }
  const component = (n, c) => n?.components.find(([name]) => name === c)?.[1];
  const active = (n) => {
    for (let p = n, i = 0; p; p = p.parent) if (!p.active || ++i > 64) return false;
    return true;
  };
  const children = (n) =>
    (n?.rect?.children || []).map((id) => nodes.get(rects.get(id)?.owner)).filter(Boolean);
  const find = (cls) => [...nodes.values()].find((n) => component(n, cls));
  const skinNames = model.skins.map((s) => s.name);
  const names = Object.keys(model.animations);
  const graphic = find('SkeletonGraphic'),
    scaler = component(find('CanvasScaler'), 'CanvasScaler');
  const reference = scaler && bytes(scaler).length >= 52 ? f2(bytes(scaler), 44) : [1920, 1080];
  const spriteOf = (n) => {
    const a = component(n, 'Image');
    if (!a) return null;
    const raw = bytes(a);
    // Unity UI Image stores its Sprite after its Graphic/MaskableGraphic fields.
    for (let off = 68; off + 12 <= Math.min(raw.length, 140); off += 4) {
      const file = raw.readInt32LE(off),
        id = raw.readBigInt64LE(off + 4);
      if (file < 0 || file > 64 || id <= 0n) continue;
      const asset = resolve(a, {m_FileID: file, m_PathID: id});
      if (asset?.type === 'Sprite') return asset;
    }
    return null;
  };
  const geometry = (r) => r && {min: r.min, max: r.max, pos: r.pos, size: r.size, pivot: r.pivot};
  const canvas = {
    reference: reference.every((n) => n > 0 && n <= 16384) ? reference : [1920, 1080],
    buttons: [],
    decoration: [],
    icons: new Map(),
    initial: serializedNames(component(graphic, 'SkeletonGraphic'), names)[0],
    touch: null,
    settings: null
  };
  const storeSprite = (a) => {
    if (!a) return null;
    const id = 'sprite-' + canvas.icons.size + '.png';
    if (!canvas.icons.has(a)) canvas.icons.set(a, id);
    return canvas.icons.get(a);
  };
  const controls = new Map();
  for (const n of nodes.values()) {
    if (!active(n)) continue;
    if (component(n, 'TouchEvent')) canvas.touch = geometry(n.rect);
    const button = component(n, 'Button');
    if (!button) continue;
    const raw = bytes(button),
      recognized = n.components.find(([name]) => controlClasses.has(name));
    let action, value;
    if (recognized) {
      action = controlClasses.get(recognized[0]);
      const b = bytes(recognized[1]);
      value = b.readInt32LE(b.length - 4);
    } else if (raw.includes(Buffer.from('OnClickReset'))) {
      action = 'reset';
    } else {
      const clip = serializedNames(button, names)[0],
        skin = serializedNames(button, skinNames)[0];
      if (clip) {
        action = 'animation';
        value = clip;
      } else if (skin) {
        action = 'skin';
        value = skin;
      } else throw Error('archive-controls');
    }
    const layers = children(n);
    const icon =
      spriteOf(layers.find((child) => /^icon$/i.test(child.name))) ||
      layers.map(spriteOf).find(Boolean) ||
      spriteOf(n);
    const parent = n.parent;
    const group = parent?.name || action;
    if (!controls.has(group)) controls.set(group, []);
    controls
      .get(group)
      .push({
        action,
        value,
        label: n.name === 'Background' && action === 'reset' ? 'Reset' : n.name,
        icon: storeSprite(icon),
        order: children(parent).indexOf(n)
      });
    if (!canvas.settings && parent?.parent?.rect) canvas.settings = geometry(parent.parent.rect);
  }
  // Respect Unity's transform sibling order inside layout groups.
  const settings = find('VerticalLayoutGroup'),
    order = children(settings).map((n) => n.name);
  canvas.buttons = [...controls]
    .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
    .map(([, buttons]) => buttons.sort((a, b) => a.order - b.order));
  for (const n of nodes.values()) {
    if (!active(n) || !n.rect || n.parent !== graphic?.parent || component(n, 'Button')) continue;
    const img = spriteOf(n);
    if (img)
      canvas.decoration.push({
        name: n.name,
        icon: storeSprite(img),
        rect: geometry(n.rect),
        dark: undefined
      });
  }
  // Only activate the role-specific control bindings if their serialized callbacks exist.
  canvas.skinTable = serializedNames(component(find('CustomSkin'), 'CustomSkin'), skinNames);
  return canvas;
}
