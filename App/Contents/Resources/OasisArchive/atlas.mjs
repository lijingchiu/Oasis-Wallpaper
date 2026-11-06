// Unity can resize each packed texture independently. Rebuild upright, untrimmed
// regions at their decoded resolution before the same atlas reaches either renderer.
const invalid = () => {
  throw Error('archive-rig');
};
const numbers = (value) => value.split(',').map((n) => Number(n.trim()));
const nextPower = (n) => 2 ** Math.ceil(Math.log2(Math.max(n, 1)));
export function unpackPage(text, image) {
  const lines = text.trim().split(/\r?\n/),
    page = lines.shift().trim();
  let sourceWidth = image.width,
    sourceHeight = image.height,
    region = null;
  const regions = [];
  for (const row of lines) {
    const line = row.trim(),
      split = line.indexOf(':');
    if (!line) continue;
    if (split < 0) {
      region = {name: line, angle: 0, offset: [0, 0], index: -1};
      regions.push(region);
      continue;
    }
    const key = line.slice(0, split),
      value = line.slice(split + 1).trim(),
      nums = numbers(value);
    if (!region) {
      if (key === 'size') [sourceWidth, sourceHeight] = nums;
      continue;
    }
    if (key === 'bounds') {
      region.xy = nums.slice(0, 2);
      region.size = nums.slice(2);
    }
    if (key === 'xy') region.xy = nums;
    if (key === 'size') region.size = nums;
    if (key === 'offsets') {
      region.offset = nums.slice(0, 2);
      region.original = nums.slice(2);
    }
    if (key === 'offset') region.offset = nums;
    if (key === 'orig') region.original = nums;
    if (key === 'rotate') region.angle = value === 'true' ? 90 : value === 'false' ? 0 : Number(value);
    if (key === 'index') region.index = nums[0];
  }
  if (
    !regions.length ||
    regions.length > 16384 ||
    ![sourceWidth, sourceHeight].every((n) => Number.isSafeInteger(n) && n > 0)
  )
    invalid();
  const sx = image.width / sourceWidth,
    sy = image.height / sourceHeight,
    unique = new Map();
  let total = 0,
    maxWidth = 0;
  for (const reg of regions) {
    const {xy, size, angle, offset} = reg,
      original = reg.original || size;
    if (
      !xy ||
      !size ||
      !original ||
      ![...xy, ...size, ...original, ...offset].every(Number.isSafeInteger) ||
      ![0, 90, 180, 270].includes(angle) ||
      size.some((n) => n <= 0) ||
      original.some((n) => n <= 0 || n > 32768) ||
      offset.some((n) => n < 0)
    )
      invalid();
    const [x, y] = xy,
      [a, b] = size,
      [ow, oh] = original,
      [dx, dy] = offset,
      turned = angle % 180 !== 0;
    if (
      x < 0 ||
      y < 0 ||
      x + (turned ? b : a) > sourceWidth ||
      y + (turned ? a : b) > sourceHeight ||
      a + dx > ow ||
      b + dy > oh
    )
      invalid();
    const key = [x, y, a, b, ow, oh, dx, dy, angle].join(','),
      w = Math.max(1, Math.round(ow * (turned ? sy : sx))),
      h = Math.max(1, Math.round(oh * (turned ? sx : sy)));
    if (w + 2 > 8192 || h + 2 > 8192) invalid();
    if (!unique.has(key)) {
      unique.set(key, {w, h, x, y, a, b, ow, oh, dx, dy, angle});
      total += (w + 2) * (h + 2);
      maxWidth = Math.max(maxWidth, w + 2);
    }
    reg.packed = unique.get(key);
  }
  if (total > 24 * 1024 * 1024) invalid();
  const width = Math.min(8192, nextPower(Math.max(Math.sqrt(total), maxWidth))),
    sorted = [...unique.values()].sort((a, b) => b.h - a.h || b.w - a.w);
  let x = 0,
    y = 0,
    rowHeight = 0;
  for (const patch of sorted) {
    if (x + patch.w + 2 > width) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    patch.left = x + 1;
    patch.top = y + 1;
    x += patch.w + 2;
    rowHeight = Math.max(rowHeight, patch.h + 2);
  }
  const height = y + rowHeight;
  if (height > 8192 || width * height > 32 * 1024 * 1024) invalid();
  const rgba = Buffer.alloc(width * height * 4);
  for (const p of sorted) {
    for (let v = -1; v <= p.h; v++)
      for (let u = -1; u <= p.w; u++) {
        const ix = ((Math.min(p.w - 1, Math.max(0, u)) + 0.5) * p.ow) / p.w - p.dx;
        const iy = ((Math.min(p.h - 1, Math.max(0, v)) + 0.5) * p.oh) / p.h - (p.oh - p.b - p.dy);
        if (ix < 0 || ix >= p.a || iy < 0 || iy >= p.b) continue;
        let tx = ix,
          ty = iy;
        if (p.angle === 90) {
          tx = iy;
          ty = p.a - ix;
        } else if (p.angle === 180) {
          tx = p.a - ix;
          ty = p.b - iy;
        } else if (p.angle === 270) {
          tx = p.b - iy;
          ty = ix;
        }
        const px = Math.min(image.width - 1, Math.floor((p.x + tx) * sx)),
          py = Math.min(image.height - 1, Math.floor((p.y + ty) * sy));
        const source = 4 * (py * image.width + px),
          dest = 4 * ((p.top + v) * width + p.left + u);
        rgba.writeUInt32LE(image.rgba.readUInt32LE(source), dest);
      }
  }
  const output = [page, 'size:' + width + ',' + height, 'filter:Linear,Linear'];
  for (const reg of regions) {
    const p = reg.packed;
    output.push(reg.name, 'bounds:' + [p.left, p.top, p.w, p.h].join(','));
    if (reg.index >= 0) output.push('index:' + reg.index);
  }
  return {width, height, rgba, atlas: output.join('\n')};
}
