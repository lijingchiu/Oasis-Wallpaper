import {open, rename, unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';

const integer = (n, max) => Number.isInteger(n) && n >= 0 && n <= max;
function sanitize(value, kind) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (kind === 'actor') {
    const {pose, style, colour, theme} = value;
    return [pose, style, colour, theme].every((n) => integer(n, 64))
      ? {pose, style, colour, theme}
      : null;
  }
  const {sides, song, volume, mode} = value;
  if (
    !Array.isArray(sides) ||
    sides.length !== 3 ||
    !integer(song, 4095) ||
    !integer(mode, 2) ||
    !Number.isFinite(volume) ||
    volume < 0 ||
    volume > 1
  )
    return null;
  if (
    !sides.every(
      (s) => s && integer(s.member, 31) && integer(s.pose, 127) && [0.5, 1, 1.5, 2].includes(s.speed)
    )
  )
    return null;
  return {sides: sides.map(({member, pose, speed}) => ({member, pose, speed})), song, mode, volume};
}
export async function archivePreferences(req, res, {root, kind, origin}) {
  const headers = {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff'
  };
  const send = (status, body) => {
    res.writeHead(status, headers);
    res.end(req.method === 'HEAD' ? undefined : JSON.stringify(body));
  };
  if (!['actor', 'band'].includes(kind)) return send(404, null);
  const dest = join(root, '.oasis-preferences.json');
  if (req.method === 'GET' || req.method === 'HEAD') {
    let file;
    try {
      file = await open(dest, constants.O_RDONLY | constants.O_NOFOLLOW);
      if ((await file.stat()).size > 2048) return send(200, {});
      return send(200, sanitize(JSON.parse(await file.readFile('utf8')), kind) || {});
    } catch {
      return send(200, {});
    } finally {
      await file?.close();
    }
  }
  if (
    req.method !== 'POST' ||
    req.headers.origin !== origin ||
    req.headers['content-type'] !== 'application/json'
  )
    return send(403, null);
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 2048) return send(413, null);
    chunks.push(chunk);
  }
  let value;
  try {
    value = sanitize(JSON.parse(Buffer.concat(chunks).toString('utf8')), kind);
  } catch {}
  if (!value) return send(400, null);
  const temp = join(root, '.oasis-preferences-' + randomUUID());
  let file;
  try {
    file = await open(temp, 'wx', 0o600);
    await file.writeFile(JSON.stringify(value));
    await file.close();
    file = null;
    await rename(temp, dest);
    send(200, true);
  } finally {
    await file?.close();
    await unlink(temp).catch(() => {});
  }
}
