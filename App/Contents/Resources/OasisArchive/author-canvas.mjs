// Evaluate Unity RectTransform anchors in the author's reference resolution.
// Keep inactive panels in their original sibling order when an action opens them.
let canvasNumber = 0;
export function mountCanvas(stage, layout, slot = false) {
  const prefix = 'oasis-art-' + ++canvasNumber + '-';
  const rows = new Map(layout.nodes.map((n) => [n.id, n])),
    elements = new Map(),
    parents = new Map();
  const ns = 'http://www.w3.org/2000/svg',
    svg = document.createElementNS(ns, 'svg'),
    defs = document.createElementNS(ns, 'defs'),
    filters = new Map();
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.position = 'absolute';
  svg.append(defs);
  stage.append(svg);
  function tintImage(art, r, g, b) {
    if (r === 1 && g === 1 && b === 1) return;
    const key = [r, g, b].join('/');
    let id = filters.get(key);
    if (!id) {
      id = prefix + filters.size;
      filters.set(key, id);
      const f = document.createElementNS(ns, 'filter'),
        matrix = document.createElementNS(ns, 'feColorMatrix');
      f.id = id;
      f.setAttribute('color-interpolation-filters', 'sRGB');
      matrix.setAttribute(
        'values',
        [r, 0, 0, 0, 0, 0, g, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, 1, 0].join(' ')
      );
      f.append(matrix);
      defs.append(f);
    }
    art.style.filter = 'url(#' + id + ')';
  }
  function create(id, parent) {
    const row = rows.get(id),
      el = document.createElement('div');
    el.className = 'node';
    el.dataset.node = row.name;
    el.hidden = !row.active;
    el.row = row;
    elements.set(id, el);
    if (parent) {
      parents.set(id, parent);
      parent.append(el);
    } else stage.append(el);
    if (row.image) {
      const {file, tint} = row.image,
        [r, g, b, a] = tint;
      if (a > 0 && row.showMask !== false) {
        const art = file ? document.createElement('img') : document.createElement('i');
        art.className = 'surface';
        art.alt = '';
        art.draggable = false;
        if (file) {
          art.src = file;
          tintImage(art, r, g, b);
        } else
          art.style.backgroundColor = 'rgb(' + [r, g, b].map((c) => Math.round(c * 255)).join(',') + ')';
        art.style.opacity = a;
        el.art = art;
        el.append(art);
      }
    }
    if (row.components.includes('Mask') || row.components.includes('RectMask2D'))
      el.style.overflow = 'hidden';
    if (row.text !== undefined) {
      const span = document.createElement('span');
      span.className = 'caption';
      span.textContent = row.text;
      el.caption = span;
      span.style.fontSize = (row.font > 8 && row.font < 400 ? row.font : 54) + 'px';
      el.append(span);
    }
    if (!slot && (row.components.includes('Button') || row.components.includes('TouchEvent'))) {
      el.classList.add('hit');
      el.setAttribute('role', 'button');
      el.tabIndex = 0;
      el.setAttribute('aria-label', row.actions?.[0] || row.name);
      el.onkeydown = (e) => {
        if (e.target === el && ['Enter', ' '].includes(e.key)) {
          e.preventDefault();
          el.click();
        }
      };
    }
    if (row.flip && el.art) el.art.style.transform = 'scale(' + row.flip.join(',') + ')';
    for (const c of row.children) create(c, el);
    return el;
  }
  const root = create(layout.root, null);
  const clamp = (n) => (Number.isFinite(n) ? Math.max(0, n) : 0);
  function rect(r, w, h) {
    const W = (r.max[0] - r.min[0]) * w + r.size[0],
      H = (r.max[1] - r.min[1]) * h + r.size[1];
    return {
      x: w * (r.min[0] + (r.max[0] - r.min[0]) * r.pivot[0]) + r.pos[0] - W * r.pivot[0],
      y: h * (r.min[1] + (r.max[1] - r.min[1]) * r.pivot[1]) + r.pos[1] - H * r.pivot[1],
      w: clamp(W),
      h: clamp(H)
    };
  }
  function place(el, box, isRoot = false) {
    const n = el.row,
      r = n.rect;
    Object.assign(el.style, {
      left: box.x + 'px',
      bottom: box.y + 'px',
      width: box.w + 'px',
      height: box.h + 'px'
    });
    if (!isRoot) {
      el.style.transformOrigin = r.pivot[0] * 100 + '% ' + (1 - r.pivot[1]) * 100 + '%';
      el.style.transform = 'rotate(' + r.angle + 'deg) scale(' + r.scale.join(',') + ')';
    }
    const kids = n.children.map((id) => elements.get(id)),
      boxes = kids.map((k) => rect(k.row.rect, box.w, box.h)),
      g = n.layout;
    if (g) {
      const ids = kids.map((_, i) => i).filter((i) => !kids[i].hidden);
      if (g.reverse) ids.reverse();
      const [l, rr, t, b] = g.padding,
        v = g.vertical,
        availW = box.w - l - rr,
        availH = box.h - t - b,
        major = v ? 'h' : 'w';
      const unfilled =
        (v ? availH : availW) -
        ids.reduce((s, i) => s + boxes[i][major], 0) -
        g.spacing * Math.max(0, ids.length - 1);
      const expand = v ? g.expandH : g.expandW,
        control = v ? g.controlH : g.controlW,
        extra = expand && ids.length ? Math.max(0, unfilled) / ids.length : 0;
      const ax = (g.align % 3) / 2,
        ay = Math.floor(g.align / 3) / 2;
      let at = (v ? t : l) + (expand ? 0 : Math.max(0, unfilled) * (v ? ay : ax));
      for (const i of ids) {
        const q = boxes[i],
          slot = q[major] + extra;
        if (control) q[major] = slot;
        if (v) {
          if (g.controlW) q.w = availW;
          q.x = l + (availW - q.w) * ax;
          q.y = box.h - at - q.h - (slot - q.h) * ay;
        } else {
          if (g.controlH) q.h = availH;
          q.x = at + (slot - q.w) * ax;
          q.y = b + (availH - q.h) * (1 - ay);
        }
        at += slot + g.spacing;
      }
    }
    kids.forEach((child, i) => place(child, boxes[i]));
  }
  function size() {
    const w = stage.clientWidth,
      h = stage.clientHeight,
      scale =
        (w / layout.reference[0]) ** (1 - layout.match) * (h / layout.reference[1]) ** layout.match;
    if (!(scale > 0)) return;
    root.style.transform = 'scale(' + scale + ')';
    root.style.transformOrigin = '0 100%';
    place(root, {x: 0, y: 0, w: w / scale, h: h / scale}, true);
  }
  const observer = new ResizeObserver(size);
  observer.observe(stage);
  size();
  const all = (fn) => [...elements.values()].filter((el) => fn(el.row, el));
  const ancestor = (el, fn) => {
    for (let p = el; p; p = parents.get(p.row.id)) if (fn(p.row)) return p;
    return null;
  };
  return {root, all, ancestor, size, dispose: () => observer.disconnect()};
}
