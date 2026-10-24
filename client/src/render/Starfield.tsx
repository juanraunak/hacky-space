// Mid layer: stars of the galaxy around us as point sprites at true positions,
// with real parallax. Flux-correct and tiny (1..3 px); extra energy goes above
// 1 so bloom becomes the point spread function. Colour from temperature.
//
// Relativity (special): Doppler shifts each star's TEMPERATURE, never its hue,
// and aberration bunches stars forward. Both are capped, fade in above
// beta 0.3, and scale with PHYSICS_FX. Ships and the HUD stay true colour.

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { BLACKBODY_GLSL } from './sky';
import { Q } from './quality';
import { origin } from './origin';
import { mulberry32 } from '../universe/hash';
import { ship } from '../play/game';
import { C, PHYSICS_FX } from '../game/constants';

const VERT = /* glsl */ `
attribute float aTemp;
attribute float aMag;
uniform vec3 uBeta; // ship velocity / c, world axes
uniform float uFx;
uniform float uDpr;
varying vec3 vCol;
varying float vSpike;
varying float vCore;
${BLACKBODY_GLSL}
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 rel = wp.xyz - cameraPosition;
  float d = length(rel);
  vec3 dir = rel / d;
  float b = length(uBeta);
  float temp = aTemp;
  float boost = 1.0;
  if (b > 0.001) {
    vec3 bh = uBeta / b;
    float fade = smoothstep(0.3, 0.6, b) * uFx;
    float cosT = dot(dir, bh);
    // aberration: forward bunching
    float cosO = (cosT + b) / (1.0 + b * cosT);
    vec3 perp = dir - bh * cosT;
    float pl = length(perp);
    vec3 dirO = pl > 1e-5 ? bh * cosO + (perp / pl) * sqrt(max(0.0, 1.0 - cosO * cosO)) : dir;
    dir = normalize(mix(dir, dirO, fade));
    // Doppler on temperature, clamped 0.5..2; brightness capped about x3
    float D = clamp(sqrt((1.0 + b * cosT) / max(1e-3, 1.0 - b * cosT)), 0.5, 2.0);
    D = mix(1.0, D, fade);
    temp *= D;
    boost = min(3.0, D * D * D);
  }
  vec3 shown = cameraPosition + dir * d;
  gl_Position = projectionMatrix * viewMatrix * vec4(shown, 1.0);
  // flux from magnitude: F = 10^(-0.4 m), relative to a reference
  float flux = pow(10.0, -0.4 * aMag) * boost * (2.0e8 / (d * d + 1.0e6));
  float px = clamp(sqrt(flux) * 2.2, 1.0, 3.0);
  // energy that does not fit in the sprite goes into luminance above 1
  float energy = flux / (px * px * 0.25);
  // the brightest few get James Webb's six-point diffraction spikes
  vSpike = smoothstep(6.0, 20.0, energy);
  float size = mix(px, 34.0, vSpike);
  vCore = px / size;
  gl_PointSize = size * uDpr;
  vec3 tint = mix(vec3(1.0), blackbody(temp), 0.5); // desaturated toward white
  vCol = tint * clamp(energy, 0.05, 40.0);
}
`;

const FRAG = /* glsl */ `
varying vec3 vCol;
varying float vSpike;
varying float vCore;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float core = exp(-(r * r) / max(1e-4, vCore * vCore) * 3.0);
  float spikes = 0.0;
  if (vSpike > 0.0) {
    for (int i = 0; i < 3; i++) {
      float a = float(i) * 1.0471976 + 1.5707963;
      vec2 dir = vec2(cos(a), sin(a));
      float perp = abs(dot(p, vec2(-dir.y, dir.x)));
      spikes += exp(-perp * 90.0) * pow(1.0 - r, 2.0);
    }
    spikes += 0.4 * exp(-abs(p.y) * 120.0) * pow(1.0 - r, 3.0); // the faint short horizontal pair
  }
  gl_FragColor = vec4(vCol * (core + spikes * vSpike * 0.35), 1.0);
}
`;

export function Starfield({ seed }: { seed: number }) {
  const ref = useRef<THREE.Points>(null);
  const { geometry, material } = useMemo(() => {
    const n = Q.stars;
    const r = mulberry32((seed ^ 0x51a7) >>> 0);
    const pos = new Float32Array(n * 3), temp = new Float32Array(n), mag = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const z = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - z * z);
      // more stars near the galactic plane
      const flat = r() < 0.6 ? 0.25 : 1;
      const d = 6000 + Math.pow(r(), 0.6) * 54000;
      pos[i * 3] = s * Math.cos(a) * d; pos[i * 3 + 1] = z * d * flat; pos[i * 3 + 2] = s * Math.sin(a) * d;
      const t = r();
      temp[i] = t < 0.6 ? 2800 + r() * 2200 : t < 0.9 ? 5000 + r() * 3000 : 8000 + r() * 22000;
      mag[i] = -1.5 + Math.pow(r(), 0.35) * 8;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aTemp', new THREE.BufferAttribute(temp, 1));
    g.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    const m = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending, transparent: true,
      uniforms: { uBeta: { value: new THREE.Vector3() }, uFx: { value: PHYSICS_FX }, uDpr: { value: 1 } },
    });
    return { geometry: g, material: m };
  }, [seed]);

  useFrame(({ gl }) => {
    const p = ref.current;
    if (!p) return;
    p.position.set(-origin.x, -origin.y, -origin.z);
    material.uniforms.uBeta.value.set(ship.vel.x / C, ship.vel.y / C, ship.vel.z / C);
    material.uniforms.uDpr.value = gl.getPixelRatio();
  });

  return <points ref={ref} geometry={geometry} material={material} renderOrder={-20} frustumCulled={false} />;
}
