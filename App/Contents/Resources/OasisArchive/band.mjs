import {createRig} from './rig.mjs';
import {makeStage, pageImages} from './stage.mjs';
import {mountCanvas} from './author-canvas.mjs';
import {sceneEffects} from './effects.mjs';
import {readPreferences, savePreferences} from './prefs-client.mjs';
const get = async (file, method) => {
  const r = await fetch(file);
  if (!r.ok) throw Error('asset');
  return r[method]();
};
const [book, wasm, saved] = await Promise.all([
  get('collection.json', 'json'),
  get('mesh.wasm', 'arrayBuffer'),
  readPreferences()
]);
const ui = mountCanvas(document.querySelector('#stage'), book.layout),
  members = book.members,
  tracks = book.songs;
const byName = (name) => ui.all((r) => r.name === name);
const within = (parent, predicate) => ui.all(predicate).filter((el) => parent.contains(el));
const imageFor = (el, file) => {
  if (file && el?.art?.tagName === 'IMG') el.art.src = file;
};
const wrap = (n, length) => ((n % length) + length) % length;
const listPanel = byName('SongListPanel')[0],
  editor = byName('SelectAnimationPanel')[0];
// Unity opens this mask during the editor's slide-in. Its back tab is
// anchored just outside the mask and needs to receive pointer events there.
const editorMask = within(editor, (r) => r.name === 'Mask')[0];
if (editorMask) editorMask.style.overflow = 'visible';
const sidePanels = [byName('LeftCharactorPanel')[0], byName('RightCharactorPanel')[0]],
  banner = byName('BannerPanel')[0];
const audio = document.querySelector('audio');
const clampInt = (n, max, fallback = 0) => (Number.isInteger(n) && n >= 0 && n <= max ? n : fallback);
const settings = {
  sides: [...sidePanels, banner].map((panel, i) => {
    const value = saved.sides?.[i] || {};
    const source = within(panel, (r) => r.components.includes('SkeletonGraphic'))[0]?.row.skeleton;
    const original = members.findIndex((m) => m.entries.some((e) => e.definition === source)),
      member = clampInt(value.member, members.length - 1, Math.max(0, original));
    const originalPose = members[member].entries.findIndex((e) => e.definition === source);
    return {
      member,
      pose:
        i === 2
          ? 0
          : Math.max(
              1,
              clampInt(value.pose, members[member].entries.length - 1, Math.max(1, originalPose))
            ),
      speed: [0.5, 1, 1.5, 2].includes(value.speed) ? value.speed : 1
    };
  }),
  volume: Number.isFinite(saved.volume) ? Math.max(0, Math.min(1, saved.volume)) : 0.7,
  mode: clampInt(saved.mode, 2),
  song: clampInt(saved.song, tracks.length - 1)
};
let restoring = true;
const save = () => {
  if (!restoring) savePreferences(settings);
};
let sideEditing = 0,
  editMode = false,
  last = null,
  levels = null;
const effects = sceneEffects(ui),
  rgb = (colour) => 'rgb(' + colour.slice(0, 3).join(',') + ')';
function paintSurface(el, colour) {
  if (el && colour) {
    if (el.art) {
      el.art.style.filter = 'none';
      el.art.style.backgroundColor = rgb(colour);
      if (el.art.tagName === 'IMG') el.art.style.visibility = 'hidden';
    }
    el.style.backgroundColor = rgb(colour);
  }
}
function paintPattern(el, member) {
  if (!el?.art) return;
  const style = el.art.style;
  style.background = member.pattern ? 'url("' + member.pattern + '") repeat' : 'transparent';
  style.backgroundSize =
    100 / Math.max(1, member.tiling?.[0] || 1) + '% ' + 100 / Math.max(1, member.tiling?.[1] || 1) + '%';
  style.opacity = String(member.tint?.[3] ?? 0);
  el.art.classList.toggle('pattern-scroll', !!member.pattern);
}
const actors = [...sidePanels, banner].map((parent, i) => {
  const host = within(parent, (r) => r.components.includes('SkeletonGraphic'))[0];
  if (!host) throw Error('missing author canvas');
  const canvas = document.createElement('canvas');
  canvas.className = 'actor';
  host.append(canvas);
  const drawing = makeStage(canvas),
    actor = {canvas, drawing, ticket: 0, rig: null, box: null};
  const resize = () => {
    if (actor.box) drawing.resize(actor.box, i === 2 ? 0.99 : 0.98, i === 2 ? 0.98 : 0.98);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  observer.observe(document.querySelector('#stage'));
  actor.resize = resize;
  return actor;
});
async function select(i, who, pose) {
  const actor = actors[i],
    member = members[who],
    entry = member.entries[pose],
    ticket = ++actor.ticket,
    base = entry.dir + '/';
  actor.pending = {member: who, pose};
  const [model, atlas, scene] = await Promise.all([
    get(base + 'rig.json', 'json'),
    get(base + 'rig.atlas', 'text'),
    get(base + 'canvas.json', 'json')
  ]);
  const images = await pageImages(base, scene.pages);
  if (ticket !== actor.ticket) return;
  const rig = await createRig(wasm, model, atlas);
  if (ticket !== actor.ticket) return;
  rig.select([]);
  if (!(rig.play(entry.clip, true) > 0)) throw Error('animation');
  actor.drawing.setPages(images);
  actor.rig = rig;
  actor.box = scene.bounds;
  actor.resize();
  actor.drawing.draw(rig.frame(0));
  actor.canvas.setAttribute('aria-label', entry.clip);
  actor.canvas.dataset.member = member.name;
  const parent = sidePanels[i] || banner;
  if (i < 2) {
    for (const group of within(parent, (r) => r.name.startsWith('UIDecorate_Panel_')))
      group.hidden =
        group.row.name.toLowerCase().replace('yamata', 'yamada') !==
        'uidecorate_panel_' + member.name.toLowerCase();
    paintSurface(within(parent, (r) => r.name === 'CharactorBackground')[0], member.colour);
    paintPattern(within(parent, (r) => r.name === 'CharacterBackgroundEffect')[0], member);
  } else {
    paintSurface(within(banner, (r) => r.name === 'CharactorBackground')[0], member.colour);
    paintSurface(banner.parentElement, member.background);
  }
  Object.assign(settings.sides[i], {member: who, pose});
  save();
}
function navigateCharacter(i, delta) {
  const current = actors[i].pending || settings.sides[i],
    next = wrap(current.member + delta, members.length);
  return select(
    i,
    next,
    i === 2 ? 0 : Math.max(1, Math.min(current.pose, members[next].entries.length - 1))
  );
}
function draw(time) {
  const dt = last === null ? 0 : Math.min(0.1, (time - last) / 1000);
  last = time;
  actors.forEach((actor, i) => {
    if (actor.rig) actor.drawing.draw(actor.rig.frame(dt * settings.sides[i].speed));
  });
  effects(dt, levels, audio.currentTime, !audio.paused);
  requestAnimationFrame(draw);
}
function accessible(el, label, act) {
  el.setAttribute('aria-label', label);
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    act();
  });
}
function toggleEdit(value) {
  editMode = value;
  for (const p of sidePanels)
    for (const el of within(p, (r) => r.components.includes('Button'))) el.hidden = !value;
  if (!value) editor.hidden = true;
  ui.size();
}
function showPoses(i) {
  sideEditing = i;
  const who = settings.sides[i].member,
    member = members[who];
  editor.hidden = false;
  listPanel.hidden = true;
  poseSlots.forEach((slot) => slot.dispose());
  poseSlots.length = 0;
  poseList.replaceChildren();
  for (const [index, entry] of member.entries.slice(1).entries()) {
    const j = index + 1,
      btn = document.createElement('button');
    btn.type = 'button';
    btn.ariaLabel = entry.clip;
    btn.setAttribute('aria-current', String(settings.sides[i].pose === j));
    poseList.append(btn);
    const slot = mountCanvas(btn, book.poseSlot, true);
    poseSlots.push(slot);
    paintSurface(slot.all((r) => r.name === 'Background')[0], member.colour);
    paintPattern(slot.all((r) => r.name === 'BackgroundEffect')[0], member);
    const model = slot.all((r) => r.components.includes('SkeletonGraphic'))[0],
      thumb = document.createElement('i');
    thumb.className = 'pose-thumb';
    thumb.style.backgroundImage = 'url("' + entry.dir + '/poses.png")';
    thumb.style.animationDuration = entry.duration + 's';
    model.append(thumb);
    btn.onclick = () => {
      select(i, who, j);
      for (const other of poseList.children) other.setAttribute('aria-current', String(other === btn));
    };
  }
  for (const el of ui.all((r) => r.speed))
    el.setAttribute('aria-pressed', String(el.row.speed === settings.sides[i].speed));
  ui.size();
}
const poseSlots = [],
  poseList = document.createElement('div');
poseList.className = 'songs poses';
const grid = within(editor, (r) => r.grid)[0]?.row.grid;
if (grid) {
  poseList.style.gridTemplateColumns = 'repeat(' + grid.columns + ', minmax(0,1fr))';
  poseList.style.gap = grid.spacing[1] + 'px ' + grid.spacing[0] + 'px';
  const [l, r, t, b] = grid.padding;
  poseList.style.padding = [t, r, b, l].map((n) => n + 'px').join(' ');
}
within(editor, (r) => r.name === 'Viewport')[0].append(poseList);
const songList = document.createElement('div');
songList.className = 'songs';
within(listPanel, (r) => r.name === 'Viewport')[0].append(songList);
function rail(node, label, change) {
  const input = document.createElement('input');
  input.className = 'rail';
  input.type = 'range';
  input.min = 0;
  input.max = 1000;
  input.value = 0;
  input.setAttribute('aria-label', label);
  node.append(input);
  const fill = within(node, (r) => r.name === 'Fill')[0],
    handle = within(node, (r) => r.name === 'Handle')[0];
  const paint = (value) => {
    input.value = Math.round(1000 * value);
    if (fill) fill.style.clipPath = 'inset(0 ' + (100 - 100 * value) + '% 0 0)';
    if (handle) {
      handle.style.left = 100 * value + '%';
      handle.style.transform = 'translateX(-50%)';
    }
  };
  input.oninput = () => {
    const value = Number(input.value) / 1000;
    paint(value);
    change(value);
  };
  return {input, paint};
}
const volumeNode = byName('VolumeSlider')[0],
  volume = rail(volumeNode, 'Volume', (v) => {
    settings.volume = v;
    audio.volume = v;
    save();
  });
const seek = rail(byName('SongProgressSlider')[0], 'Song progress', (v) => {
  if (Number.isFinite(audio.duration)) audio.currentTime = v * audio.duration;
});
let seeking = false;
seek.input.addEventListener('pointerdown', (event) => {
  seeking = true;
  seek.input.setPointerCapture(event.pointerId);
});
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'])
  seek.input.addEventListener(event, () => {
    seeking = false;
  });
audio.volume = settings.volume;
volume.paint(settings.volume);
volumeNode.hidden = true;
const play = ui.all((r) => r.actions?.includes('PlayPause'))[0],
  cycle = ui.all((r) => r.actions?.includes('ChangeSongPlayMode'))[0];
const cycles = ['循環', '單曲循環', '隨機'];
const paintMode = () => {
  imageFor(cycle, book.icons[cycles[settings.mode]]);
  cycle.setAttribute('aria-label', cycles[settings.mode]);
};
let audioJob = null,
  objectURL = null,
  loaded = -1,
  wantsPlay = false;
function updateTrack() {
  const track = tracks[settings.song];
  if (!track) return;
  byName('SongNameText')[0].caption.textContent = track.alternate || track.title;
  for (const [role, key] of [
    ['Player', 'artist'],
    ['Lyricist', 'lyricist'],
    ['Composer', 'composer']
  ]) {
    const pane = within(listPanel, (r) => r.name === role)[0],
      caption = pane && within(pane, (r) => r.name === 'MainText')[0]?.caption;
    if (caption) caption.textContent = track[key] || '';
  }
  const album = within(listPanel, (r) => r.name === 'AlbumMask')[0];
  if (album && track.cover) {
    let cover = album.querySelector('.album');
    if (!cover) {
      cover = new Image();
      cover.className = 'surface album';
      album.append(cover);
    }
    cover.src = track.cover;
  }
  for (const [i, btn] of [...songList.children].entries()) {
    btn.setAttribute('aria-current', String(i === settings.song));
    for (const el of btn.querySelectorAll('[data-node="SelectBorder"],[data-node="Guitar"]'))
      el.hidden = i !== settings.song;
  }
}
function loadSong(index, start = true) {
  if (!tracks.length) return;
  index = wrap(index, tracks.length);
  wantsPlay = start;
  settings.song = index;
  save();
  updateTrack();
  if (index === loaded && objectURL) {
    if (start) audio.play().catch(() => {});
    else audio.pause();
    return;
  }
  audioJob?.terminate();
  audioJob = null;
  audio.pause();
  loaded = -1;
  levels = null;
  audio.removeAttribute('src');
  audio.load();
  if (objectURL) {
    URL.revokeObjectURL(objectURL);
    objectURL = null;
  }
  seek.paint(0);
  const job = new Worker('sound-worker.js');
  audioJob = job;
  job.onmessage = ({data}) => {
    if (job !== audioJob) return;
    job.terminate();
    audioJob = null;
    if (!data) throw Error('sound decode');
    levels = data.levels;
    objectURL = URL.createObjectURL(new Blob([data.pcm], {type: 'audio/wav'}));
    loaded = index;
    audio.src = objectURL;
    if (wantsPlay)
      audio.play().catch(() => {
        wantsPlay = false;
      });
    else audio.load();
  };
  job.onerror = () => {
    if (job === audioJob) {
      job.terminate();
      audioJob = null;
      wantsPlay = false;
    }
  };
  job.postMessage(tracks[index].file);
}
function nextSong(manual, delta = 1) {
  if (!manual && settings.mode === 1) {
    audio.currentTime = 0;
    audio.play().catch(() => {});
    return;
  }
  const n = tracks.length,
    step = settings.mode === 2 && n > 1 ? 1 + Math.floor(Math.random() * (n - 1)) : delta;
  loadSong(settings.song + step, true);
}
for (const [i, track] of tracks.entries()) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.ariaLabel = track.alternate || track.title;
  btn.onclick = () => loadSong(i, true);
  songList.append(btn);
  const slot = mountCanvas(btn, book.songSlot, true);
  for (const [label, value] of [
    ['NoText', String(i + 1).padStart(2, '0')],
    ['MainText', track.alternate || track.title],
    ['SubText', track.alternate ? track.title : '']
  ]) {
    const el = slot.all((r) => r.name === label)[0];
    if (el?.caption) el.caption.textContent = value;
  }
}
for (const el of ui.all((r) => r.components.includes('Button'))) {
  const action = el.row.actions?.[0],
    side = sidePanels.findIndex((panel) => panel.contains(el));
  switch (action) {
    case 'SwitchEditorMode':
      accessible(el, action, () => toggleEdit(!editMode));
      break;
    case 'OnClick_LastCharactor':
    case 'OnClick_NextCharactor':
      accessible(el, action, () => navigateCharacter(side, action.includes('Last') ? -1 : 1));
      break;
    case 'EnterSelectAnimationEditor':
      accessible(el, action, () => showPoses(side));
      break;
    case 'OnClick_Back':
      accessible(el, action, () => {
        editor.hidden = true;
        ui.size();
      });
      break;
    case 'OnClickLastArror':
    case 'OnClickNextArrow':
      accessible(el, action, () => navigateCharacter(2, action.includes('Last') ? -1 : 1));
      break;
    case 'OnClick':
      if (!el.row.speed) throw Error('unsupported button');
      accessible(el, el.row.name, () => {
        settings.sides[sideEditing].speed = el.row.speed;
        for (const b of ui.all((r) => r.speed)) b.setAttribute('aria-pressed', String(b === el));
        save();
      });
      break;
    case 'SwitchPanel':
      accessible(el, action, () => {
        listPanel.hidden = !listPanel.hidden;
        editor.hidden = true;
        ui.size();
      });
      break;
    case 'PlayPause':
      accessible(el, action, () => {
        if (audioJob) {
          wantsPlay = !wantsPlay;
          return;
        }
        if (loaded !== settings.song) loadSong(settings.song, true);
        else if (audio.paused) audio.play().catch(() => {});
        else audio.pause();
      });
      break;
    case 'LastSong':
    case 'NextSong':
      accessible(el, action, () => nextSong(true, action === 'LastSong' ? -1 : 1));
      break;
    case 'ChangeSongPlayMode':
      accessible(el, action, () => {
        settings.mode = (settings.mode + 1) % cycles.length;
        paintMode();
        save();
      });
      break;
    case 'OnClick_Volume':
      accessible(el, action, () => {
        volumeNode.hidden = !volumeNode.hidden;
        ui.size();
        volume.paint(settings.volume);
      });
      break;
    default:
      throw Error('unsupported button');
  }
}
audio.addEventListener('ended', () => nextSong(false));
audio.addEventListener('timeupdate', () => {
  if (!seeking)
    seek.paint(
      Number.isFinite(audio.duration) && audio.duration > 0 ? audio.currentTime / audio.duration : 0
    );
});
for (const event of ['play', 'pause', 'ended'])
  audio.addEventListener(event, () => {
    imageFor(play, book.icons[audio.paused ? '播放' : '暫停']);
    play.setAttribute('aria-pressed', String(!audio.paused));
  });
window.addEventListener(
  'pagehide',
  () => {
    audioJob?.terminate();
    if (objectURL) URL.revokeObjectURL(objectURL);
  },
  {once: true}
);
document.addEventListener('visibilitychange', () => {
  last = null;
});
toggleEdit(false);
updateTrack();
paintMode();
await Promise.all(settings.sides.map((s, i) => select(i, s.member, s.pose)));
document.body.dataset.ready = 'true';
requestAnimationFrame(draw);
if (tracks.length) loadSong(settings.song, true);
restoring = false;
