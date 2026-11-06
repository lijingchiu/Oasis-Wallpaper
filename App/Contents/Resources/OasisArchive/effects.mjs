const cssColour = (rgba) =>
  'rgba(' +
  rgba
    .slice(0, 3)
    .map((c) => Math.round(c * 255))
    .join(',') +
  ',' +
  rgba[3] +
  ')';

export function sceneEffects(ui) {
  const decorations = ui
    .all((row) => row.spin || row.colours || row.randomSize)
    .map((el) => {
      const {spin, colours, randomSize} = el.row;
      if (randomSize && el.art) {
        const length = randomSize[0] + Math.random() * (randomSize[1] - randomSize[0]);
        el.art.style.scale = String(length / Math.max(1, el.row.rect.size[0]));
      }
      return {
        el,
        spin: (spin || 0) * (Math.random() < 0.5 ? -1 : 1),
        phase: Math.random() * Math.PI * 2,
        colours
      };
    });
  const meter = ui.all((row) => row.spectrum)[0],
    bars = [];
  if (meter)
    for (let i = 0; i < 64; i++) {
      const bar = document.createElement('i');
      bar.className = 'frequency-bar';
      bar.style.left = 'calc(50% + ' + (i * meter.row.spectrum.space - 10) + 'px)';
      meter.append(bar);
      bars.push(bar);
    }
  const heights = new Float32Array(bars.length);
  let clock = 0;
  return function draw(dt, levels, seconds, playing) {
    clock += dt;
    for (const {el, spin, colours, phase} of decorations) {
      if (!el.art || el.closest('[hidden]')) continue;
      if (spin) el.art.style.rotate = clock * spin + 'deg';
      if (colours) {
        const mix = (Math.sin(clock + phase) + 1) / 2,
          colour = colours[0].map((n, i) => n + (colours[1][i] - n) * mix);
        el.art.style.opacity = String(colour[3]);
        if (el.art.tagName === 'I') el.art.style.backgroundColor = cssColour(colour);
      }
    }
    if (!meter) return;
    const first = Math.floor(seconds * (levels?.rate || 0)) * bars.length;
    for (let i = 0; i < bars.length; i++) {
      const {force, fall} = meter.row.spectrum,
        value = playing && levels ? (levels.values[first + i] || 0) / 255 : 0;
      heights[i] = Math.max(value * value * force * 0.5, heights[i] * Math.exp(-fall * dt));
      bars[i].style.transform = 'scaleY(' + heights[i] + ')';
    }
  };
}
