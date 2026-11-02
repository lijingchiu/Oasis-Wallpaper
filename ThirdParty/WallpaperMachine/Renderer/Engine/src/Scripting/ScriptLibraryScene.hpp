// Clean-room implementation from the WallpaperMachine spec e3-scripting.md; written without access to the original source.
//
// The script-side library of the SceneScript host, part 2: layer objects, the
// scene API, animation / sprite-sheet / video objects, layer creation and the
// audio buffers. Same function scope as `ScriptLibraryCore.hpp`.
#pragma once

namespace wallpaper::script_library
{

inline constexpr char kScene[] = R"JS(

// ---- small value helpers --------------------------------------------------
function num(x) { return typeof x === 'number' ? x : 0; }
function isVecLike(v) { return v instanceof Vec2 || v instanceof Vec3 || v instanceof Vec4; }
function parseNumbers(text) {
  var parts = text.trim().split(/[\s,]+/);
  var out = [];
  for (var i = 0; i < parts.length; ++i) { var v = parseFloat(parts[i]); out.push(isFinite(v) ? v : 0); }
  return out;
}
// A value written to a three-component layer property: a number fills every
// component, a two-component vector leaves z at 0, a plain object is read with
// missing components 0, a string is the scene file's whitespace form.
function vec3Parts(v) {
  if (typeof v === 'number') return [v, v, v];
  if (typeof v === 'string') { var p = parseNumbers(v); return [num(p[0]), num(p[1]), num(p[2])]; }
  if (v === null || typeof v !== 'object') return [0, 0, 0];
  return [num(v.x), num(v.y), num(v.z)];
}
function vec2Parts(v) {
  if (typeof v === 'number') return [v, v];
  if (typeof v === 'string') { var p = parseNumbers(v); return [num(p[0]), num(p[1])]; }
  if (v === null || typeof v !== 'object') return [0, 0];
  return [num(v.x), num(v.y)];
}
function toVec3(a) { return new Vec3(a[0], a[1], a[2]); }
var RAD = Math.PI / 180, DEG = 180 / Math.PI;

// ---- layers ---------------------------------------------------------------
var KEY = Symbol('layer');
var layerCache = new Map();

class Layer {
  constructor(key) {
    var st = { key: key, name: undefined, alpha: 1, alignment: 'center', plain: Object.create(null),
               playing: false, volume: 1, muted: false, timelines: null, sheet: null, video: null,
               listeners: null };
    Object.defineProperty(this, KEY, { value: st });
    this.originalOrigin = n.hasNode(key) ? toVec3(n.origin(key)) : new Vec3(0, 0, 0);
  }
  getParent() {
    var parent = n.parent(this[KEY].key);
    return parent ? getLayer(parent) : null;
  }
  // setParent(parent, adjustTransforms) or setParent(parent, attachment, adjustTransforms):
  // no parent puts the layer at the root; with adjustTransforms it stays where it is. A puppet
  // attachment to hang from is not followed: the layer hangs from the parent layer itself.
  setParent(parent, second, third) {
    var adjust = typeof second === 'boolean' || second === undefined ? !!second : !!third;
    var key = parent === undefined || parent === null ? '' :
      (typeof parent === 'number' ? n.layerNameAt(parent) : keyOf(parent));
    n.setParent(this[KEY].key, key, adjust);
  }
  getChildren() {
    var self = this[KEY].key, out = [], count = n.layerCount();
    for (var i = 0; i < count; ++i) {
      var k = n.layerNameAt(i);
      if (n.parent(k) === self) out.push(layerFor(k));
    }
    return out;
  }
  getEffectCount() { return n.effectCount(this[KEY].key); }
  getEffect(x) {
    var key = this[KEY].key;
    var ref = typeof x === 'number'
      ? (Number.isInteger(x) && x >= 0 ? n.effectAt(key, x) : '')
      : n.effectByName(key, String(x));
    return ref ? effectObjectOf(this, ref) : null;
  }
  getTransformMatrix() { return new Mat4(n.matrix(this[KEY].key)); }
  // Turns the layer about its own axes: Euler angles in radians (the `angles` property is in degrees).
  rotateObjectSpace(v) {
    var a = vec3Parts(v);
    n.rotateObjectSpace(this[KEY].key, a[0], a[1], a[2]);
  }
  getAnimation(name) {
    var st = this[KEY];
    if (st.timelines === null) st.timelines = new Map();
    // With no name it is the layer's first animation that has none.
    var key = name === undefined ? '' : String(name);
    var found = st.timelines.get(key);
    if (found === undefined) { found = new Timeline(st.key, key); st.timelines.set(key, found); }
    return found;
  }
  getAnimationLayer(x) { return animationLayerOf(this[KEY].key, x); }
  getAnimationLayerCount() { return n.puppet(this[KEY].key, '', 'layerCount'); }
  // A layer over the authored ones playing `animation` once (then it hides), or for good.
  playSingleAnimation(animation, config) { return addAnimationLayer(this, animation, true, config); }
  createAnimationLayer(animation) { return addAnimationLayer(this, animation, false, undefined); }
  destroyAnimationLayer(x) {
    var layer = x instanceof AnimationLayer ? x : this.getAnimationLayer(x);
    if (layer[KEY].index < 0) return false;
    layer.stop();
    layer.visible = false;
    return true;
  }
  // Bones, by name or index, as the last frame posed them.
  getBoneCount() { return n.bone(this[KEY].key, 'count'); }
  getBoneIndex(name) { return n.bone(this[KEY].key, 'index', String(name)); }
  getBoneParentIndex(bone) { return n.bone(this[KEY].key, 'parent', bone); }
  getBoneTransform(bone) { return boneMatrix(this, 'world', bone); }
  getLocalBoneTransform(bone) { return boneMatrix(this, 'local', bone); }
  getLocalBoneOrigin(bone) { var m = boneMatrix(this, 'local', bone); return m === undefined ? undefined : m.translation(); }
  getLocalBoneAngles(bone) {
    var m = boneMatrix(this, 'local', bone);
    return m === undefined ? undefined : anglesOfMatrix(m.m);
  }
  getTextureAnimation() {
    var st = this[KEY];
    if (st.sheet === null) st.sheet = new Sheet(st.key);
    return st.sheet;
  }
  getVideoTexture() {
    var st = this[KEY];
    if (st.video === null) st.video = new Video(st.key);
    return st.video;
  }
  // A sound layer's stream, a particle layer's system, else a flag the script keeps.
  play() { var st = this[KEY]; if (!n.soundPlay(st.key) && !n.particleControl(st.key, 'play')) st.playing = true; }
  pause() { var st = this[KEY]; if (!n.soundPause(st.key) && !n.particleControl(st.key, 'pause')) st.playing = false; }
  stop() { var st = this[KEY]; if (!n.soundStop(st.key) && !n.particleControl(st.key, 'stop')) st.playing = false; }
  isPlaying() {
    var st = this[KEY];
    if (n.hasSound(st.key)) return n.soundPlaying(st.key);
    if (n.hasParticles(st.key)) return n.particleControl(st.key, 'playing');
    return st.playing;
  }
  emitParticles(count) { n.emitParticles(this[KEY].key, count === undefined ? 1 : Number(count)); }
  on(event, fn) {
    var st = this[KEY];
    if (typeof event !== 'string' || typeof fn !== 'function') return;
    if (st.listeners === null) st.listeners = Object.create(null);
    var list = st.listeners[event];
    if (list === undefined) st.listeners[event] = list = [];
    list.push(fn);
  }
  emit(event, payload) {
    var st = this[KEY];
    var list = st.listeners === null ? undefined : st.listeners[event];
    if (list === undefined) return;
    var count = list.length;
    for (var i = 0; i < count; ++i) list[i](payload);
  }
}

function accessor(name, get, set) {
  Object.defineProperty(Layer.prototype, name, { get: get, set: set, configurable: true, enumerable: false });
}
accessor('name',
  function () { var st = this[KEY]; return st.name !== undefined ? st.name : n.authoredName(st.key); },
  function (v) { this[KEY].name = v; });
accessor('visible',
  function () { return n.visible(this[KEY].key); },
  function (v) { n.setVisible(this[KEY].key, !!v); });
// A particle layer's instance overrides; undefined on any other layer.
var PARTICLE_NUMBERS = ['alpha', 'size', 'count', 'speed', 'lifetime', 'rate'];
function particleInstanceOf(key) {
  var instance = {};
  PARTICLE_NUMBERS.forEach(function (field) {
    Object.defineProperty(instance, field, {
      get: function () { var v = n.particleInstance(key, field); return v === undefined ? undefined : v[0]; },
      set: function (value) { n.setParticleInstance(key, field, [Number(value)]); },
      enumerable: true
    });
  });
  Object.defineProperty(instance, 'colorn', {
    get: function () { var v = n.particleInstance(key, 'colorn'); return v === undefined ? undefined : toVec3(v); },
    set: function (value) {
      n.setParticleInstance(key, 'colorn', typeof value === 'number' ? [value] : materialConstantFloats(value));
    },
    enumerable: true
  });
  for (var i = 0; i < 8; ++i) {
    (function (field) {
      Object.defineProperty(instance, field, {
        get: function () { var v = n.particleInstance(key, field); return v === undefined ? undefined : toVec3(v); },
        set: function (value) { n.setParticleInstance(key, field, materialConstantFloats(value)); },
        enumerable: true
      });
    })('controlpoint' + i);
  }
  return instance;
}
accessor('instance',
  function () {
    var st = this[KEY];
    if (!n.hasParticles(st.key)) return undefined;
    if (st.particleInstance === undefined) st.particleInstance = particleInstanceOf(st.key);
    return st.particleInstance;
  },
  function () {});
accessor('origin',
  function () { return toVec3(n.origin(this[KEY].key)); },
  function (v) { var a = vec3Parts(v); n.setOrigin(this[KEY].key, a[0], a[1], a[2]); });
accessor('scale',
  function () { return toVec3(n.scale(this[KEY].key)); },
  function (v) { var a = vec3Parts(v); n.setScale(this[KEY].key, a[0], a[1], a[2]); });
accessor('angles',
  function () { var a = n.rotation(this[KEY].key); return new Vec3(a[0] * DEG, a[1] * DEG, a[2] * DEG); },
  function (v) { var a = vec3Parts(v); n.setRotation(this[KEY].key, a[0] * RAD, a[1] * RAD, a[2] * RAD); });
accessor('size',
  function () { var a = n.size(this[KEY].key); return new Vec2(a[0], a[1]); },
  function () {});
accessor('color',
  function () { return toVec3(n.color(this[KEY].key)); },
  function (v) { var a = vec3Parts(v); n.setColor(this[KEY].key, a[0], a[1], a[2]); });
accessor('alpha',
  function () {
    var st = this[KEY];
    var value = n.alpha(st.key);
    return value === undefined ? st.alpha : value;
  },
  function (v) {
    var st = this[KEY];
    var value = Number(v);
    if (!isFinite(value)) value = 0;
    st.alpha = value;
    n.setAlpha(st.key, value);
  });
accessor('text',
  function () { return n.text(this[KEY].key); },
  function (v) { n.setText(this[KEY].key, String(v)); });
accessor('alignment',
  function () { return this[KEY].alignment; },
  function (v) { var st = this[KEY]; st.alignment = String(v); n.setAlignment(st.key, st.alignment); });
accessor('parallaxDepth',
  function () { var a = n.parallax(this[KEY].key); return new Vec2(a[0], a[1]); },
  function (v) { var a = vec2Parts(v); n.setParallax(this[KEY].key, a[0], a[1]); });

var STYLE_WORDS = {
  horizontalalign: { left: 1, center: 1, right: 1 },
  verticalalign: { top: 1, center: 1, bottom: 1 }
};
function styleAccessor(name) {
  accessor(name,
    function () {
      var st = this[KEY];
      var value = n.textStyle(st.key, name);
      if (value === undefined) return st.plain[name];
      return name === 'pointsize' ? Number(value) : value;
    },
    function (value) {
      var st = this[KEY];
      if (n.textStyle(st.key, name) === undefined) { st.plain[name] = value; return; }
      var text = String(value);
      if (name === 'pointsize') {
        var size = Number(text);
        if (!(isFinite(size) && size > 0)) return;
      } else if (name !== 'font') {
        if (!hasOwn.call(STYLE_WORDS[name], text)) return;
      }
      n.setTextStyle(st.key, name, text);
    });
}
styleAccessor('font');
styleAccessor('pointsize');
styleAccessor('horizontalalign');
styleAccessor('verticalalign');

accessor('volume',
  function () { var st = this[KEY]; return n.hasSound(st.key) ? n.soundVolume(st.key) : st.volume; },
  function (v) {
    var st = this[KEY];
    var value = Number(v);
    if (!isFinite(value)) value = 0;
    if (n.hasSound(st.key)) n.soundSetVolume(st.key, value); else st.volume = value;
  });
accessor('muted',
  function () { var st = this[KEY]; return n.hasSound(st.key) ? n.soundMuted(st.key) : st.muted; },
  function (v) {
    var st = this[KEY];
    if (n.hasSound(st.key)) n.soundSetMuted(st.key, !!v); else st.muted = !!v;
  });

// What a script that decides an effect's visibility (or calls `layer.getEffect`) has: its layer,
// except that `name`, `visible` and `getMaterial` are the effect's own, so writing `visible`
// switches the effect and leaves the layer.
var effectCache = new Map();
var materialCache = new Map();
function materialConstantFloats(v) {
  if (typeof v === 'number') return [finiteOr(v, 0)];
  if (typeof v === 'boolean') return [v ? 1 : 0];
  if (typeof v === 'string') return parseNumbers(v);
  if (v instanceof Vec4) return [num(v.x), num(v.y), num(v.z), num(v.w)];
  if (v instanceof Vec3) return [num(v.x), num(v.y), num(v.z)];
  if (v instanceof Vec2) return [num(v.x), num(v.y)];
  if (Array.isArray(v)) {
    var out = [];
    for (var i = 0; i < v.length; ++i) out.push(finiteOr(Number(v[i]), 0));
    return out;
  }
  if (v !== null && typeof v === 'object') {
    if ('w' in v) return [num(v.x), num(v.y), num(v.z), num(v.w)];
    if ('z' in v) return [num(v.x), num(v.y), num(v.z)];
    if ('x' in v || 'y' in v) return [num(v.x), num(v.y)];
  }
  return [];
}
// A constant as the material holds it (a number, or a vector of its width), or what a script
// stored under a name the material does not have.
function materialConstantOf(reference, index, store, key) {
  var live = n.materialConstant(reference, index, key);
  if (live === undefined) return store[key];
  if (live.length === 1) return live[0];
  if (live.length === 2) return new Vec2(live[0], live[1]);
  if (live.length === 3) return new Vec3(live[0], live[1], live[2]);
  if (live.length === 4) return new Vec4(live[0], live[1], live[2], live[3]);
  return live;
}
function materialObjectOf(reference, index) {
  var id = reference + '\u0001' + index;
  var found = materialCache.get(id);
  if (found !== undefined) return found;
  var store = Object.create(null);
  var target = {
    getConstant: function (name) { return materialConstantOf(reference, index, store, String(name)); },
    setConstant: function (name, value) {
      var key = String(name);
      store[key] = value;
      var floats = materialConstantFloats(value);
      if (floats.length > 0) n.setMaterialConstant(reference, index, key, floats);
    }
  };
  found = new Proxy(target, {
    get: function (obj, prop) {
      if (typeof prop !== 'string' || prop in obj) return obj[prop];
      return materialConstantOf(reference, index, store, prop);
    },
    set: function (obj, prop, value) {
      if (typeof prop === 'string' && !(prop in obj)) obj.setConstant(prop, value);
      else obj[prop] = value;
      return true;
    }
  });
  materialCache.set(id, found);
  return found;
}
function effectObjectOf(layer, reference) {
  var found = effectCache.get(reference);
  if (found !== undefined) return found;
  var customName;
  var object = Object.create(layer);
  Object.defineProperty(object, 'name', {
    get: function () { return customName !== undefined ? customName : n.effectName(reference); },
    set: function (v) { customName = v; },
    enumerable: false, configurable: true
  });
  Object.defineProperty(object, 'visible', {
    get: function () { return n.effectVisible(reference); },
    set: function (v) { n.setEffectVisible(reference, !!v); },
    enumerable: false, configurable: true
  });
  Object.defineProperty(object, 'getMaterialCount', {
    value: function () { return n.effectMaterialCount(reference); },
    writable: true, enumerable: false, configurable: true
  });
  Object.defineProperty(object, 'getMaterial', {
    value: function (index) {
      var at = Number(index);
      if (!(Number.isInteger(at) && at >= 0 && at < n.effectMaterialCount(reference))) return null;
      return materialObjectOf(reference, at);
    },
    writable: true, enumerable: false, configurable: true
  });
  effectCache.set(reference, object);
  return object;
}
// What a script on a keyed setting has as `thisObject`: its layer, except that
// `getAnimation()` with no name is the setting's own animation.
function settingObjectOf(layer, reference) {
  var object = Object.create(layer);
  var own = null;
  Object.defineProperty(object, 'getAnimation', {
    value: function (name) {
      if (name !== undefined) return layer.getAnimation(name);
      if (own === null) own = new Timeline('\u0003' + reference, '');
      return own;
    },
    writable: true, enumerable: false, configurable: true
  });
  return object;
}

function layerFor(key) {
  var layer = layerCache.get(key);
  if (layer === undefined) { layer = new Layer(key); layerCache.set(key, layer); }
  return layer;
}
function keyOf(x) {
  if (x !== null && typeof x === 'object' && x[KEY] !== undefined) return x[KEY].key;
  return n.resolve(String(x));
}

// ---- timelines, animation layers, sprite sheets, video textures -----------
class Timeline {
  constructor(layerKey, name) { Object.defineProperty(this, KEY, { value: { layer: layerKey, name: name } }); }
  get name() { return this[KEY].name; }
  get fps() { return this.op('fps'); }
  get frameCount() { return this.op('frameCount'); }
  get duration() { var fps = this.fps; return fps > 0 ? this.frameCount / fps : 0; }
  get rate() { return this.op('rate'); }
  set rate(v) { if (typeof v === 'number' && isFinite(v)) this.op('setRate', v); }
  op(name, value) { var st = this[KEY]; return n.timeline(st.layer, st.name, name, value); }
  play() { this.op('play'); }
  pause() { this.op('pause'); }
  stop() { this.op('stop'); }
  isPlaying() { return this.op('isPlaying') !== 0; }
  getFrame() { return this.op('frame'); }
  setFrame(f) { if (typeof f === 'number' && isFinite(f)) this.op('setFrame', f); }
}
Object.defineProperty(Timeline.prototype, 'op', { enumerable: false });
var sceneTimelines = new Map();
function sceneAnimation(name) {
  var key = String(name);
  var found = sceneTimelines.get(key);
  if (found === undefined) { found = new Timeline('', key); sceneTimelines.set(key, found); }
  return found;
}

var endedListeners = new Map();
var animationLayers = new Map();
// The ids a layer's animation-layer objects and listeners are filed under, so they
// go when the layer does.
var animationIds = new Map();
class AnimationLayer {
  constructor(layerKey, ref, index, asked) {
    Object.defineProperty(this, KEY, { value: { layer: layerKey, ref: ref, index: index, asked: asked } });
  }
  op(name, value) {
    var st = this[KEY];
    return st.index < 0 ? undefined : n.puppet(st.layer, st.ref, name, value);
  }
  get name() { var st = this[KEY]; return st.index < 0 ? st.asked : n.puppetName(st.layer, st.ref); }
  get fps() { return num(this.op('fps')); }
  get frameCount() { var st = this[KEY]; return st.index < 0 ? 1 : this.op('frameCount'); }
  get duration() { var fps = this.fps; return fps > 0 ? this.frameCount / fps : 0; }
  get rate() { var st = this[KEY]; return st.index < 0 ? 1 : this.op('rate'); }
  set rate(v) { if (typeof v === 'number' && isFinite(v)) this.op('setRate', v); }
  get blend() { var st = this[KEY]; return st.index < 0 ? 1 : this.op('blend'); }
  set blend(v) { if (typeof v === 'number' && isFinite(v)) this.op('setBlend', v); }
  get visible() { var st = this[KEY]; return st.index < 0 ? true : this.op('visible') !== 0; }
  set visible(v) { this.op('setVisible', v ? 1 : 0); }
  play() { this.op('play'); }
  pause() { this.op('pause'); }
  stop() { this.op('stop'); }
  isPlaying() { return num(this.op('isPlaying')) !== 0; }
  getFrame() { return num(this.op('frame')); }
  setFrame(f) { if (typeof f === 'number' && isFinite(f)) this.op('setFrame', f); }
  getCurrentTime() { var fps = this.fps; return fps > 0 ? this.getFrame() / fps : 0; }
  addEndedCallback(fn) {
    var st = this[KEY];
    if (st.index < 0 || typeof fn !== 'function') return;
    var id = st.layer + '\u0001' + st.index;
    var list = endedListeners.get(id);
    if (list === undefined) {
      list = [];
      endedListeners.set(id, list);
      var ids = animationIds.get(st.layer);
      if (ids === undefined) animationIds.set(st.layer, ids = []);
      ids.push(id);
    }
    list.push(fn);
  }
  removeEndedCallback(fn) {
    var st = this[KEY];
    var list = endedListeners.get(st.layer + '\u0001' + st.index);
    if (list === undefined) return;
    var at = list.indexOf(fn);
    if (at >= 0) list.splice(at, 1);
  }
}
Object.defineProperty(AnimationLayer.prototype, 'op', { enumerable: false });

function addAnimationLayer(layer, animation, once, config) {
  var key = layer[KEY].key;
  var name = animation !== null && typeof animation === 'object' ? animation.name : animation;
  var index = n.puppetAddLayer(key, String(name), once);
  if (index < 0) return undefined;
  var made = animationLayerOf(key, index);
  if (config !== null && typeof config === 'object') {
    if (config.rate !== undefined) made.rate = Number(config.rate);
    if (config.blend !== undefined) made.blend = Number(config.blend);
  }
  return made;
}
function boneMatrix(layer, space, bone) {
  var m = n.bone(layer[KEY].key, space, bone);
  return m === undefined ? undefined : new Mat4(m);
}
// The angles of a matrix in degrees, as a layer's `angles` reads them (R = Rz * Ry * Rx).
function anglesOfMatrix(m) {
  var col = function (c) {
    var x = m[c * 4], y = m[c * 4 + 1], z = m[c * 4 + 2], l = Math.sqrt(x * x + y * y + z * z) || 1;
    return [x / l, y / l, z / l];
  };
  var c0 = col(0), c1 = col(1), c2 = col(2);
  var sinY = Math.max(-1, Math.min(1, -c0[2]));
  var x = 0, y = Math.asin(sinY), z = 0;
  if (Math.abs(sinY) < 1 - 1e-9) { x = Math.atan2(c1[2], c2[2]); z = Math.atan2(c0[1], c0[0]); }
  else { x = Math.atan2(-c2[1], c1[1]); }
  return new Vec3(x * DEG, y * DEG, z * DEG);
}
function animationLayerOf(layerKey, x) {
  var ref = String(x);
  var index = -1;
  if (n.puppet(layerKey, '', 'layerCount') > 0) index = n.puppet(layerKey, ref, 'index');
  var id = layerKey + (index >= 0 ? '\u0001' + index : '\u0002' + ref);
  var found = animationLayers.get(id);
  if (found === undefined) {
    found = new AnimationLayer(layerKey, index >= 0 ? String(index) : ref, index, ref);
    animationLayers.set(id, found);
    var ids = animationIds.get(layerKey);
    if (ids === undefined) animationIds.set(layerKey, ids = []);
    ids.push(id);
  }
  return found;
}

function notifyAnimationLayerEnded(layerKey, index) {
  var list = endedListeners.get(layerKey + '\u0001' + index);
  if (list === undefined || list.length === 0) return;
  var copy = list.slice();
  var failed = false, failure;
  for (var i = 0; i < copy.length; ++i) {
    // A listener an earlier one removed never fires.
    if (list.indexOf(copy[i]) < 0) continue;
    try { copy[i](); } catch (e) { if (!failed) { failed = true; failure = e; } }
  }
  if (failed) reportError('layer-ended notice', failure);
}

class Sheet {
  constructor(layerKey) { Object.defineProperty(this, KEY, { value: { key: layerKey } }); }
  info(at) { var i = n.sheetInfo(this[KEY].key); return i === undefined ? undefined : i[at]; }
  get name() { var v = this.info(0); return v === undefined ? '' : v; }
  get frameCount() { return num(this.info(1)); }
  get duration() { return num(this.info(2)); }
  get fps() { return num(this.info(3)); }
  get rate() { return n.sheet(this[KEY].key, 'rate'); }
  set rate(v) { n.sheet(this[KEY].key, 'setRate', Number(v)); }
  play() { n.sheet(this[KEY].key, 'play'); }
  pause() { n.sheet(this[KEY].key, 'pause'); }
  stop() { n.sheet(this[KEY].key, 'stop'); }
  isPlaying() { return n.sheet(this[KEY].key, 'isPlaying') !== 0; }
  setFrame(f) { n.sheet(this[KEY].key, 'setFrame', Number(f)); }
  getFrame() { return n.sheet(this[KEY].key, 'frame'); }
}
Object.defineProperty(Sheet.prototype, 'info', { enumerable: false });

class Video {
  constructor(layerKey) { Object.defineProperty(this, KEY, { value: { key: layerKey } }); }
  play() { n.video(this[KEY].key, 'play'); }
  pause() { n.video(this[KEY].key, 'pause'); }
  stop() { n.video(this[KEY].key, 'stop'); }
  isPlaying() { return n.video(this[KEY].key, 'isPlaying') !== 0; }
  getCurrentTime() { return n.video(this[KEY].key, 'time'); }
  setCurrentTime(t) { n.video(this[KEY].key, 'setTime', Number(t)); }
  get duration() { return n.video(this[KEY].key, 'duration'); }
  get rate() { return n.video(this[KEY].key, 'rate'); }
  set rate(v) { n.video(this[KEY].key, 'setRate', Number(v)); }
}

// ---- scene API ------------------------------------------------------------
function getLayer(x) {
  if (typeof x === 'number') {
    if (!(Number.isInteger(x) && x >= 0 && x < n.layerCount())) return null;
    return layerFor(n.layerNameAt(x));
  }
  return layerFor(n.resolve(String(x)));
}

// What each forwarded text-layer key is converted to (R58, R129); order is not significant.
var TEXT_KEY_KINDS = {
  font: 'text', horizontalalign: 'text', verticalalign: 'text', anchor: 'text',
  pointsize: 'number', padding: 'number', maxwidth: 'number', maxrows: 'number',
  alpha: 'number', brightness: 'number',
  limitwidth: 'flag', limitrows: 'flag', limituseellipsis: 'flag', perspective: 'flag',
  color: 'vec3', size: 'vec2'
};
var TEXT_CONVERTERS = {
  text: function (v) { return String(v); },
  number: function (v) { var x = Number(v); return isFinite(x) ? x : undefined; },
  flag: function (v) { return !!v; },
  vec3: function (v) { return vec3Parts(v).join(' '); },
  vec2: function (v) { return vec2Parts(v).join(' '); }
};
// A `{ value }` wrapper stands for the value inside it.
function unwrap(v) {
  if (v !== null && typeof v === 'object' && !isVecLike(v) && !Array.isArray(v) && 'value' in v) return v.value;
  return v;
}
function textConfig(cfg) {
  var body = unwrap(cfg.text);
  var out = { visible: true, text: body === undefined || body === null ? '' : String(body) };
  Object.keys(TEXT_KEY_KINDS).forEach(function (key) {
    var raw = unwrap(cfg[key]);
    if (raw === undefined || raw === null) return;
    var converted = TEXT_CONVERTERS[TEXT_KEY_KINDS[key]](raw);
    if (converted !== undefined) out[key] = converted;
  });
  return JSON.stringify(out);
}

// The layer a `parent` option names (a layer object, its name, or an object with a
// name), or undefined.
function parentKeyOf(parent) {
  if (typeof parent === 'string') return n.resolve(parent);
  if (parent === null || typeof parent !== 'object') return undefined;
  if (parent[KEY] !== undefined) return parent[KEY].key;
  return typeof parent.name === 'string' ? n.resolve(parent.name) : undefined;
}
// Options that do not depend on one another: each is the layer member of that name.
var INDEPENDENT_OPTIONS = ['parallaxDepth', 'origin', 'scale', 'angles', 'color', 'alpha', 'visible',
                           'alignment'];
function applyCreateOptions(layer, cfg) {
  var st = layer[KEY];
  // The parent comes first so placement options are relative to it.
  var parentKey = parentKeyOf(cfg.parent);
  if (parentKey !== undefined && parentKey !== st.key && n.hasNode(parentKey)) n.setParent(st.key, parentKey);
  if (cfg.name !== undefined && cfg.name !== null) {
    var wanted = String(cfg.name);
    if (n.nameLayer(st.key, wanted)) st.name = wanted;
  }
  if (cfg.size !== undefined && cfg.size !== null) {
    var extent = vec2Parts(cfg.size);
    n.setSize(st.key, extent[0], extent[1]);
  }
  INDEPENDENT_OPTIONS.forEach(function (member) {
    if (cfg[member] !== undefined && cfg[member] !== null) layer[member] = cfg[member];
  });
  // Recorded once everything else has taken effect.
  layer.originalOrigin = layer.origin;
}

function createLayer(cfg, creatorKey, workshopId) {
  var template, key;
  var options = {};
  if (typeof cfg === 'string') {
    template = cfg;
  } else if (cfg !== null && typeof cfg === 'object') {
    options = cfg;
    if (cfg.image !== undefined && cfg.image !== null) template = String(cfg.image);
    else if (cfg.text === undefined) throw new Error('Unable to create layer: ');
  } else {
    throw new Error('Unable to create layer: ' + String(cfg));
  }
  if (template !== undefined) {
    key = n.createFromTemplate(template, creatorKey, workshopId === undefined ? '' : String(workshopId));
    if (!key) throw new Error('Unable to create layer: ' + template);
  } else {
    key = n.createText(textConfig(options), creatorKey);
    if (!key) throw new Error('Unable to create text layer');
  }
  var layer = layerFor(key);
  if (template !== undefined) layer.template = template;
  applyCreateOptions(layer, options);
  return layer;
}

function destroyLayer(x) {
  var key = keyOf(x);
  var result = n.destroyLayer(key);
  if (!result[0]) return false;
  for (var i = 1; i < result.length; ++i) {
    var gone = result[i];
    layerCache.delete(gone);
    var ids = animationIds.get(gone);
    if (ids !== undefined) {
      for (var j = 0; j < ids.length; ++j) { animationLayers.delete(ids[j]); endedListeners.delete(ids[j]); }
      animationIds.delete(gone);
    }
  }
  return true;
}

var sceneApi = {
  getLayer: getLayer,
  getObject: getLayer,
  getSprite: getLayer,
  getLayerCount: function () { return n.layerCount(); },
  enumerateLayers: function () {
    var out = [];
    var count = n.layerCount();
    for (var i = 0; i < count; ++i) out.push(layerFor(n.layerNameAt(i)));
    return out;
  },
  getLayerByID: function (id) {
    // An id written as text (`String(id)`) finds the layer the number does.
    if (typeof id === 'string' && id.trim() !== '') id = Number(id);
    if (typeof id !== 'number' || !isFinite(id)) return null;
    var key = n.layerById(id);
    return key ? layerFor(key) : null;
  },
  getLayerIndex: function (x) { return n.layerIndex(keyOf(x)); },
  sortLayer: function (x, index) {
    var at = Math.floor(Number(index));
    if (!(at > 0)) at = 0;
    n.sortLayer(keyOf(x), at);
  },
  getInitialLayerConfig: function (x) {
    n.requestConfig();
    var json = n.initialConfig(keyOf(x));
    return json ? JSON.parse(json) : null;
  },
  getAnimation: sceneAnimation,
  // The scene camera's static transforms (Wallpaper Engine's CameraTransforms).
  getCameraTransforms: function () {
    var a = n.cameraTransforms();
    return { eye: toVec3(a.slice(0, 3)), center: toVec3(a.slice(3, 6)), up: toVec3(a.slice(6, 9)), zoom: a[9] };
  },
  setCameraTransforms: function (t) {
    if (t === null || typeof t !== 'object') return;
    var now = n.cameraTransforms();
    // A field the object leaves out keeps what the camera has.
    var lanes = function (v, at) {
      var f = v === undefined ? [] : materialConstantFloats(v);
      return f.length >= 3 ? f.slice(0, 3) : now.slice(at, at + 3);
    };
    var zoom = t.zoom === undefined ? NaN : Number(t.zoom);
    n.setCameraTransforms(lanes(t.eye, 0).concat(lanes(t.center, 3), lanes(t.up, 6), [zoom]));
  },
  createLayer: function (cfg) { return createLayer(cfg, '', ''); },
  destroyLayer: destroyLayer,
  on: addListener
};
var sceneProxy = new Proxy(sceneApi, {
  get: function (target, prop) {
    if (typeof prop !== 'string' || prop in target) return target[prop];
    return propertyFallback(prop);
  },
  set: function (target, prop, value) { target[prop] = value; return true; }
});

// ---- audio buffers --------------------------------------------------------
var audioBuffers = [];
// The generation every registered buffer holds, or -1 while one of them still waits
// for its first fill: when the analysis has produced nothing new there is nothing to do.
var audioUpToDate = -1;
// Generous for a scene whose layers each register once; each entry costs a few hundred bytes.
var MAX_AUDIO_REGISTRATIONS = 1024;
engine.registerAudioBuffers = function (resolution) {
  var size = resolution >>> 0;
  if (size !== 16 && size !== 32 && size !== 64) size = 64;
  if (audioBuffers.length >= MAX_AUDIO_REGISTRATIONS) throw new RangeError('Too many audio buffer registrations');
  n.audioMark();
  var buffer = { size: size, generation: -1, left: new Float32Array(size), right: new Float32Array(size),
                 average: new Float32Array(size) };
  audioBuffers.push(buffer);
  audioUpToDate = -1;
  return { left: buffer.left, right: buffer.right, average: buffer.average };
};
function refreshAudio() {
  if (audioBuffers.length === 0) return;
  var generation = n.audioGeneration();
  if (generation === audioUpToDate) return;
  // One snapshot per resolution that needs it, however many buffers share it.
  var snapshot, snapshotSize = 0;
  for (var i = audioBuffers.length - 1; i >= 0; --i) {
    var buffer = audioBuffers[i];
    if (buffer.generation === generation) continue;
    if (snapshotSize !== buffer.size) { snapshot = n.audio(buffer.size); snapshotSize = buffer.size; }
    try {
      buffer.left.set(snapshot[0]);
      buffer.right.set(snapshot[1]);
      buffer.average.set(snapshot[2]);
      buffer.generation = generation;
    } catch (_) {
      audioBuffers.splice(i, 1);
    }
  }
  audioUpToDate = generation;
}

// ---- user shortcuts -------------------------------------------------------
var shortcutBudget = Infinity;
engine.openUserShortcut = function (name) {
  if (typeof name !== 'string') throw new TypeError('openUserShortcut needs the name of a user shortcut property');
  var value = n.shortcutValue(name);
  if (value === undefined) throw new ReferenceError("Unknown user property '" + name + "'");
  if (shortcutBudget < 1) return;
  shortcutBudget -= 1;
  n.requestShortcut(name, value);
};
)JS";

} // namespace wallpaper::script_library
