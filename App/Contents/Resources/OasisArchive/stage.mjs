export async function pageImages(base, pages) {
  return Promise.all(
    pages.map(async (file) => {
      const img = new Image();
      img.src = base + file;
      await img.decode();
      return img;
    })
  );
}
export function makeStage(canvas) {
  const gl = canvas.getContext('webgl', {alpha: true, antialias: true, premultipliedAlpha: true});
  if (!gl) throw Error('WebGL');
  function shader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error('shader');
    return s;
  }
  const program = gl.createProgram();
  gl.attachShader(
    program,
    shader(
      gl.VERTEX_SHADER,
      'attribute vec2 xy,uv;attribute vec4 tint;uniform vec4 camera;varying vec2 v;varying vec4 color;void main(){v=uv;color=tint;gl_Position=vec4((xy-camera.xy)*camera.zw,0.,1.);}'
    )
  );
  gl.attachShader(
    program,
    shader(
      gl.FRAGMENT_SHADER,
      'precision mediump float;varying vec2 v;varying vec4 color;uniform sampler2D page;void main(){vec4 t=texture2D(page,v)*color;gl_FragColor=vec4(t.rgb*t.a,t.a);}'
    )
  );
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error('program');
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  for (const [name, size, offset] of [
    ['xy', 2, 0],
    ['uv', 2, 8],
    ['tint', 4, 16]
  ]) {
    const attr = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(attr);
    gl.vertexAttribPointer(attr, size, gl.FLOAT, false, 32, offset);
  }
  gl.enable(gl.BLEND);
  gl.clearColor(0, 0, 0, 0);
  let textures = [];
  let lastFrame = null;
  const camera = gl.getUniformLocation(program, 'camera');
  function setPages(images) {
    textures.forEach((tex) => gl.deleteTexture(tex));
    textures = images.map((img) => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      for (const [p, v] of [
        [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
        [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
        [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
        [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]
      ])
        gl.texParameteri(gl.TEXTURE_2D, p, v);
      return tex;
    });
  }
  function resize(bounds, fillWidth = 0.76, fillHeight = 0.91) {
    const {width: w, height: h} = canvas.getBoundingClientRect(),
      ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(w * ratio)),
      height = Math.max(1, Math.round(h * ratio));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    gl.viewport(0, 0, width, height);
    const [l, b, r, t] = bounds,
      scale = Math.min((w * fillWidth) / (r - l), (h * fillHeight) / (t - b));
    gl.uniform4f(
      camera,
      (l + r) / 2,
      (b + t) / 2,
      (2 * scale) / Math.max(1, w),
      (2 * scale) / Math.max(1, h)
    );
    if (lastFrame) draw(lastFrame);
  }
  function draw(frame) {
    const {vertices, batches} = frame;
    lastFrame = frame;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
    gl.clear(gl.COLOR_BUFFER_BIT);
    for (let i = 0; i < batches.length; i += 4) {
      const [page, blend, first, count] = batches.subarray(i, i + 4);
      gl.bindTexture(gl.TEXTURE_2D, textures[page]);
      const src = blend === 2 ? gl.DST_COLOR : gl.ONE,
        dst = blend === 1 ? gl.ONE : blend === 3 ? gl.ONE_MINUS_SRC_COLOR : gl.ONE_MINUS_SRC_ALPHA;
      gl.blendFuncSeparate(src, dst, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.TRIANGLES, first, count);
    }
  }
  canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
  canvas.addEventListener('webglcontextrestored', () => location.reload());
  return {setPages, resize, draw};
}
