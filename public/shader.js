/**
 * WebGL Shader Background Renderer using Three.js
 * Optimized for Ultra-Low Mobile Data & Battery Usage
 */
function initWebGLShader(canvasId = 'webgl-canvas') {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof THREE === 'undefined') return;

  const isMobile = window.innerWidth < 768;

  const vertexShader = `
    attribute vec3 position;
    void main() {
      gl_Position = vec4(position, 1.0);
    }
  `;

  const fragmentShader = `
    precision ${isMobile ? 'mediump' : 'highp'} float;
    uniform vec2 resolution;
    uniform float time;
    uniform float xScale;
    uniform float yScale;
    uniform float distortion;

    void main() {
      vec2 p = (gl_FragCoord.xy * 2.0 - resolution) / min(resolution.x, resolution.y);
      
      float d = length(p) * distortion;
      
      float rx = p.x * (1.0 + d);
      float gx = p.x;
      float bx = p.x * (1.0 - d);

      float r = 0.05 / abs(p.y + sin((rx + time) * xScale) * yScale);
      float g = 0.05 / abs(p.y + sin((gx + time) * xScale) * yScale);
      float b = 0.05 / abs(p.y + sin((bx + time) * xScale) * yScale);
      
      gl_FragColor = vec4(r, g, b, 1.0);
    }
  `;

  const scene = new THREE.Scene();
  const renderer = new THREE.WebGLRenderer({ canvas, powerPreference: 'low-power' });
  renderer.setPixelRatio(isMobile ? 0.75 : Math.min(window.devicePixelRatio, 1.5));
  renderer.setClearColor(new THREE.Color(0x050811));
  renderer.setSize(window.innerWidth, window.innerHeight);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, -1);

  const uniforms = {
    resolution: { value: [window.innerWidth, window.innerHeight] },
    time: { value: 0.0 },
    xScale: { value: 1.0 },
    yScale: { value: 0.5 },
    distortion: { value: 0.05 },
  };

  const position = [
    -1.0, -1.0, 0.0,
     1.0, -1.0, 0.0,
    -1.0,  1.0, 0.0,
     1.0, -1.0, 0.0,
     1.0,  1.0, 0.0,
    -1.0,  1.0, 0.0,
  ];

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));

  const material = new THREE.RawShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  let lastTime = 0;
  const fpsInterval = isMobile ? 1000 / 25 : 1000 / 60; // 25 FPS on mobile to save data & battery

  function animate(now) {
    requestAnimationFrame(animate);
    const elapsed = now - lastTime;
    if (elapsed > fpsInterval) {
      lastTime = now - (elapsed % fpsInterval);
      uniforms.time.value += 0.01;
      renderer.render(scene, camera);
    }
  }

  animate(performance.now());

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    uniforms.resolution.value = [window.innerWidth, window.innerHeight];
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initWebGLShader();
});
