const encoder = new TextEncoder();
export function normalizeRig(rig) {
  const version = String(rig.skeleton?.spine || '');
  if (
    !/^4\.[123](?:\.|$)/.test(version) ||
    !rig.animations ||
    !Array.isArray(rig.skins) ||
    !Array.isArray(rig.slots)
  )
    throw Error('archive-rig');
  if (!rig.constraints) {
    const types = ['ik', 'transform', 'path', 'physics'];
    rig.constraints = types
      .flatMap((type) =>
        (rig[type] || []).map((original) => {
          const c = {...original, type};
          if (type === 'transform') {
            c.source = c.target;
            c.localSource = !!c.local;
            c.localTarget = !!c.local;
            c.additive = !!c.relative;
            c.properties = Object.fromEntries(
              ['rotate', 'x', 'y', 'scaleX', 'scaleY', 'shearY'].map((p) => [p, {to: {[p]: {scale: 1}}}])
            );
          }
          if (type === 'path') c.slot = c.target;
          if (type === 'ik' && c.uniform) c.scaleY = 'uniform';
          return c;
        })
      )
      .sort((a, b) => (a.order || 0) - (b.order || 0));
  }
  return rig;
}

export function initialState(model, scene) {
  const animations = Object.keys(model.animations);
  return {
    pose: 0,
    style: 0,
    colour: 0,
    theme: 0,
    skin: null,
    expression: null,
    idle:
      scene.initial || animations.find((n) => /^(idle|loop|normal)(?:$|[ _-])/i.test(n)) || animations[0]
  };
}
export function chosenSkins(model, scene, state) {
  const names = model.skins.map((s) => s.name).filter((n) => n !== 'default');
  if (state.skin) return [state.skin];
  const declared = scene.skinTable || [];
  if (!scene.buttons.flat().some((b) => b.action === 'pose') || !declared.length)
    return names.length === 1 ? [names[0]] : [];
  const groups = [...new Set(declared.map((n) => n.split('/')[0]))];
  const feet = groups.filter((n) => /feet/i.test(n)).sort();
  const choice = scene.buttons.flat().find((b) => b.action === 'colour' && b.value === state.colour);
  const white = /white/i.test(choice?.label || '');
  const sock = scene.buttons.flat().find((b) => b.action === 'style' && b.value === state.style);
  const hold = /clip|hold|break/i.test(sock?.label || ''),
    bare = !sock || /no|bare|none/i.test(sock.label);
  const variant = bare ? 0 : hold ? (white ? 2 : 1) : white ? 4 : 3;
  const index = bare ? 0 : white ? (hold ? 4 : 3) : hold ? 2 : 1;
  const leg = groups.find((n) => /^leg$/i.test(n)),
    expression = groups.find((n) => /emoji|expression/i.test(n));
  const expressions = names.filter((n) => n.split('/')[0] === expression);
  return [
    declared.filter((n) => n.split('/')[0] === leg)[index],
    declared.filter((n) => n.split('/')[0] === feet[state.pose])[variant],
    expressions.find((n) => n === state.expression) ||
      expressions.find((n) => /normal|default/i.test(n)) ||
      expressions[0]
  ].filter(Boolean);
}
function withSkins(model, selected) {
  const skin = {name: 'oasis-selected', attachments: Object.create(null)};
  for (const name of selected) {
    const source = model.skins.find((s) => s.name === name);
    if (!source) continue;
    for (const [slot, items] of Object.entries(source.attachments || {}))
      Object.assign((skin.attachments[slot] ||= Object.create(null)), items);
    for (const key of ['bones', 'ik', 'transform', 'path', 'physics'])
      if (source[key]) skin[key] = [...new Set([...(skin[key] || []), ...source[key]])];
  }
  return {...model, skins: [...model.skins, skin]};
}
export async function createRig(bytes, model, atlas) {
  const {instance} = await WebAssembly.instantiate(bytes, {});
  const api = instance.exports;
  function input(data) {
    const ptr = api.input(data.length);
    if (!ptr) throw Error('archive-rig');
    new Uint8Array(api.memory.buffer, ptr, data.length).set(data);
  }
  return {
    select(names) {
      const json = encoder.encode(JSON.stringify(withSkins(model, names))),
        text = encoder.encode(atlas);
      const all = new Uint8Array(json.length + text.length);
      all.set(json);
      all.set(text, json.length);
      input(all);
      if (!api.open_rig(json.length)) throw Error('archive-rig');
    },
    play(name, loop = true) {
      input(encoder.encode(name));
      return api.play(loop);
    },
    frame(dt) {
      const count = api.pose(dt);
      if (!count) throw Error('archive-rig');
      return {
        vertices: new Float32Array(api.memory.buffer, api.vertices(), count),
        batches: new Uint32Array(api.memory.buffer, api.batches(), api.batch_count() * 4)
      };
    }
  };
}
