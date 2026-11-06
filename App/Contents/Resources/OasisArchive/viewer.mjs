import {createRig, initialState, chosenSkins} from './rig.mjs';
import {makeStage, pageImages} from './stage.mjs';
import {mountCanvas} from './author-canvas.mjs';
import {readPreferences, savePreferences} from './prefs-client.mjs';

const get = async (file, kind) => {
  const r = await fetch(file);
  if (!r.ok) throw Error('asset');
  return r[kind]();
};
const [model, atlas, scene, wasm, preferences] = await Promise.all([
  get('rig.json', 'json'),
  get('rig.atlas', 'text'),
  get('canvas.json', 'json'),
  get('mesh.wasm', 'arrayBuffer'),
  readPreferences()
]);
const ui = mountCanvas(document.querySelector('#stage'), scene.layout);
const graphic = ui.all((r) => r.components.includes('SkeletonGraphic'))[0];
const canvas = document.createElement('canvas');
canvas.className = 'actor';
(graphic || ui.root).before(canvas);
if (!graphic) ui.root.append(canvas);
const rig = await createRig(wasm, model, atlas),
  drawing = makeStage(canvas);
drawing.setPages(await pageImages('', scene.pages));
const defaults = initialState(model, scene),
  buttons = [];
let selection = {...defaults},
  remaining = 0,
  last = null;
for (const key of ['pose', 'style', 'colour', 'theme']) {
  if (scene.buttons.flat().some((b) => b.action === key && b.value === preferences[key]))
    selection[key] = preferences[key];
}
const clips = Object.keys(model.animations),
  skins = model.skins.map((s) => s.name);
const touchClip = clips.find((n) => /^touch(?:$|[ _-])|^click(?:$|[ _-])/i.test(n));
const bg = ui
  .all((r) => r.name === 'Background' && r.image?.tint?.[3] > 0)
  .find((n) => n.parentElement === ui.root);
const decorations = scene.decoration.map((d) => ({
  d,
  el: ui.all((r) => r.name === d.name).find((e) => e.art)
}));
function choose(clip = selection.idle, loop = true) {
  rig.select(chosenSkins(model, scene, selection));
  const duration = rig.play(clip, loop);
  if (!(duration > 0)) throw Error('unsupported animation');
  canvas.setAttribute('aria-label', clip);
  remaining = loop ? 0 : duration;
}
function paint() {
  document.body.classList.toggle('dark', selection.theme === 1);
  if (bg?.art) bg.art.style.backgroundColor = selection.theme === 1 ? '#242424' : 'white';
  for (const {d, el} of decorations)
    if (el?.art) el.art.src = selection.theme === 1 && d.dark ? d.dark : d.icon;
  for (const {b, el} of buttons)
    if (!['reset', 'animation'].includes(b.action)) {
      const selected = selection[b.action] === b.value;
      el.setAttribute('aria-pressed', String(selected));
      const backdrop = [...el.children].find((c) => c.row?.name === 'Background');
      if (backdrop) backdrop.style.opacity = selected ? '1' : '.38';
    }
}
for (const b of scene.buttons.flat()) {
  const el = ui.all(
    (r) =>
      r.components.includes('Button') &&
      (r.name === b.label || (b.action === 'reset' && r.actions?.includes('OnClickReset')))
  )[0];
  if (!el) continue;
  el.setAttribute('aria-label', b.label);
  buttons.push({el, b});
  el.addEventListener('click', () => {
    selection.expression = null;
    if (b.action === 'reset') selection = {...defaults};
    else if (b.action !== 'animation') selection[b.action] = b.value;
    if (b.action === 'animation') choose(b.value, false);
    else choose();
    paint();
    const {pose, style, colour, theme} = selection;
    savePreferences({pose, style, colour, theme});
  });
}
const touch = ui.all((r) => r.components.includes('TouchEvent'))[0];
if (touch && touchClip) {
  touch.setAttribute('aria-label', 'Touch');
  touch.addEventListener('click', () => {
    const expressions = skins.filter((s) => /\/(?:touch|click)/i.test(s));
    selection.expression = expressions.length
      ? expressions[Math.floor(Math.random() * expressions.length)]
      : null;
    choose(touchClip, false);
  });
}
function size() {
  drawing.resize(scene.bounds);
}
function tick(time) {
  const dt = last === null ? 0 : Math.min(0.1, (time - last) / 1000);
  last = time;
  if (remaining > 0 && (remaining -= dt) <= 0) {
    selection.expression = null;
    choose();
  }
  drawing.draw(rig.frame(dt));
  requestAnimationFrame(tick);
}
choose();
paint();
size();
new ResizeObserver(size).observe(canvas);
document.addEventListener('visibilitychange', () => {
  last = null;
});
requestAnimationFrame(tick);
