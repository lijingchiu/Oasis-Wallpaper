// Unity object references, rather than asset filenames, link songs, characters,
// animations, atlases and cover art. Some artists rename these files independently.
const bytes = (a) =>
  Buffer.from(a.reader.bytes.buffer, a.reader.bytes.byteOffset, a.reader.bytes.byteLength);
export function collectionFrom(env, assets) {
  const assetsByKey = new Map(assets.map((a) => [a.file + '#' + a.pathId, a])),
    classes = new Map();
  const resolve = (a, ptr) => {
    const o = env.resolve(ptr, a.reader).object;
    return o && assetsByKey.get(o.fileName + '#' + o.pathId);
  };
  for (const a of assets.filter((x) => x.type === 'MonoBehaviour')) {
    const script = resolve(a, a.data.script);
    if (script?.type === 'MonoScript') classes.set(a, script.data.className);
  }
  const first = (c) => [...classes].find(([, name]) => name === c)?.[0];
  const list = first('CharactorListSO'),
    songList = first('SongListSO');
  if (!list || !first('CharactorPanel')) return null;
  const known = new Set([
    'SwitchEditorMode',
    'OnClickLastArror',
    'OnClickNextArrow',
    'SwitchPanel',
    'OnClick_Back',
    'ChangeSongPlayMode',
    'PlayPause',
    'LastSong',
    'NextSong',
    'OnClick_Volume',
    'OnClick_LastCharactor',
    'OnClick_NextCharactor',
    'EnterSelectAnimationEditor',
    'OnClick',
    'OnSongVolumeValueChange',
    'OnSongProgressValueChange',
    'OnSongProgressValuePointerDown',
    'OnSongProgressValuePointerUp'
  ]);
  function strings(a) {
    const b = bytes(a),
      names = [];
    for (let i = 28; i + 4 <= b.length; i += 4) {
      const n = b.readUInt32LE(i);
      if (n < 2 || n > 300 || i + 4 + n > b.length) continue;
      const text = b.toString('utf8', i + 4, i + 4 + n);
      if (!/[\x00-\x1f\ufffd]/.test(text)) names.push(text);
    }
    return names;
  }
  // Check each persisted UI event. A new compiled method needs a real adapter.
  for (const [a, c] of classes) {
    if (!['Button', 'EventTrigger', 'Slider'].includes(c) || !/^level\d+$/.test(a.file)) continue;
    const words = strings(a);
    for (let i = 0; i + 1 < words.length; i++)
      if (/, Assembly-CSharp$/.test(words[i]) && !known.has(words[i + 1]))
        throw Error('archive-controls');
  }
  function refs(a, type) {
    const b = bytes(a),
      out = [],
      seen = new Set();
    for (let i = 32; i + 12 <= b.length; i += 4) {
      const file = b.readInt32LE(i),
        id = b.readBigInt64LE(i + 4);
      if (file < 0 || file > 64 || id <= 0n) continue;
      const target =
        file === 0 ? assetsByKey.get(a.file + '#' + id) : resolve(a, {m_FileID: file, m_PathID: id});
      if (target && (target.type === type || classes.get(target) === type) && !seen.has(target)) {
        out.push(target);
        seen.add(target);
      }
    }
    return out;
  }
  function member(a) {
    const b = bytes(a),
      fields = 32 + ((b.readUInt32LE(28) + 3) & ~3);
    const colour = (offset) =>
      [0, 4, 8, 12].map((i) =>
        Math.round(255 * Math.min(1, Math.max(0, b.readFloatLE(fields + offset + i))))
      );
    const material = refs(a, 'Material')[0],
      props = material?.data.savedProperties;
    const uv = props?.colors.find(([k]) => k === '_PatternMapST')?.[1];
    const tint = props?.colors.find(([k]) => k === '_PatternColor')?.[1];
    const ptr = props?.texEnvs.find(([k]) => k === '_PatternMap')?.[1].texture;
    const pattern = ptr && resolve(material, ptr);
    let pos = fields + 160;
    function entry() {
      if (pos + 20 > b.length) throw Error('archive-rig');
      const def = resolve(a, {m_FileID: b.readInt32LE(pos + 4), m_PathID: b.readBigInt64LE(pos + 8)});
      const len = b.readUInt32LE(pos + 16);
      if (!def || classes.get(def) !== 'SkeletonDataAsset' || len > 256 || pos + 20 + len > b.length)
        throw Error('archive-rig');
      const clip = b.toString('utf8', pos + 20, pos + 20 + len);
      pos += 20 + ((len + 3) & ~3);
      const atlasAsset = refs(def, 'SpineAtlasAsset')[0];
      const skeleton = refs(def, 'TextAsset')[0],
        atlas = atlasAsset && refs(atlasAsset, 'TextAsset')[0];
      if (!skeleton || !atlas) throw Error('archive-rig');
      return {skeleton, atlas, clip, definition: def.name};
    }
    const banner = entry(),
      count = b.readUInt32LE(pos);
    pos += 4;
    if (!count || count > 64) throw Error('archive-rig');
    return {
      name: a.name.replace(/^\d+[_ -]/, ''),
      colour: colour(8),
      dark: colour(36),
      panelColour: colour(64),
      arrowColour: colour(80),
      bannerColour: colour(112),
      background: colour(128),
      fontColour: colour(144),
      pattern,
      tiling: uv && [uv.r, uv.g, uv.b, uv.a],
      tint: tint && [tint.r, tint.g, tint.b, tint.a],
      entries: [banner, ...Array.from({length: count}, entry)]
    };
  }
  const members = refs(list, 'CharactorSO').map(member);
  if (
    members.length < 1 ||
    members.length > 32 ||
    members.some((x) => !x.entries.length) ||
    members.reduce((n, m) => n + m.entries.length, 0) > 128
  )
    throw Error('archive-rig');
  const songs = songList
    ? refs(songList, 'SongSO').map((s) => {
        const clip = refs(s, 'AudioClip')[0],
          cover = refs(s, 'Sprite')[0],
          captions = strings(s).filter((x) => x !== s.name);
        if (!clip) throw Error('archive-format');
        return {
          title: captions[0] || clip.name,
          alternate: captions[1],
          artist: captions[2],
          lyricist: captions[3],
          composer: captions[4],
          clip,
          cover
        };
      })
    : [];
  return {members, songs};
}
