// The far sky, baked once per run into a half-float cubemap: dense faint
// stars, a galactic band, H-alpha / OIII nebula glow and dust lanes, all from
// the run seed (technique after wwwtyro/space-3d, Unlicense; our own code).
// Sky B is a different piece of sky, seen through wormhole mouths.
//
// Lens shaders sample `sky.a` / `sky.b`. scene.background is sky A.

import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Q } from './quality';

export const sky = {
  a: null as THREE.CubeTexture | null,
  b: null as THREE.CubeTexture | null,
  version: 0,
};

export const NOISE_GLSL = /* glsl */ `
float h31(vec3 p) { p = fract(p * vec3(443.897, 441.423, 437.195)); p += dot(p, p.yzx + 19.19); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p, int oct) { float s = 0.0, a = 0.5; for (int i = 0; i < 8; i++) { if (i >= oct) break; s += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
float ridged(vec3 p, int oct) { float s = 0.0, a = 0.5; for (int i = 0; i < 8; i++) { if (i >= oct) break; s += a * (1.0 - abs(vnoise(p) * 2.0 - 1.0)); p = p * 2.07 + 5.3; a *= 0.5; } return s; }
`;

/** Approximate blackbody colour (normalised) for 1000..40000 K. */
export const BLACKBODY_GLSL = /* glsl */ `
vec3 blackbody(float t) {
  t = clamp(t, 1000.0, 40000.0) / 100.0;
  float r = t <= 66.0 ? 1.0 : clamp(1.292936 * pow(t - 60.0, -0.1332047592), 0.0, 1.0);
  float g = t <= 66.0 ? clamp(0.3900815788 * log(t) - 0.6318414438, 0.0, 1.0) : clamp(1.129890861 * pow(t - 60.0, -0.0755148492), 0.0, 1.0);
  float b = t >= 66.0 ? 1.0 : (t <= 19.0 ? 0.0 : clamp(0.5432067891 * log(t - 10.0) - 1.19625408914, 0.0, 1.0));
  return vec3(r, g, b);
}
`;

const SKY_FRAG = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform float uSeed;
uniform vec3 uGal;
uniform float uHue;
${NOISE_GLSL}
${BLACKBODY_GLSL}

vec3 starLayer(vec3 d, float scale, float density, float bright) {
  vec3 p = d * scale + uSeed;
  vec3 c = floor(p);
  vec3 col = vec3(0.0);
  for (int i = 0; i < 2; i++) for (int j = 0; j < 2; j++) for (int k = 0; k < 2; k++) {
    vec3 cc = c + vec3(float(i), float(j), float(k)) - 0.5;
    cc = floor(cc + 0.5);
    float h = h31(cc);
    if (h > density) {
      vec3 sp = cc + vec3(h31(cc + 1.3), h31(cc + 2.7), h31(cc + 4.1));
      vec3 sd = normalize(sp - uSeed);
      float a = 1.0 - dot(sd, d);
      float mag = pow(h31(cc + 9.1), 6.0);
      float core = exp(-a * scale * scale * 90.0);
      float temp = mix(3000.0, 12000.0, pow(h31(cc + 5.5), 2.0));
      col += blackbody(temp) * core * bright * (0.15 + 3.0 * mag);
    }
  }
  return col;
}

void main() {
  vec3 d = normalize(vDir);
  vec3 col = vec3(0.0);

  // Galactic band: a soft disc of unresolved stars, with dust lanes.
  float g = dot(d, uGal);
  float band = exp(-g * g / 0.035);
  float clump = fbm(d * 6.0 + uSeed * 0.1, 6);
  float dust = ridged(d * 9.0 + uSeed * 0.2, 5);
  vec3 bandCol = mix(vec3(0.55, 0.5, 0.45), vec3(0.75, 0.62, 0.48), clump);
  float tauDust = smoothstep(0.55, 0.95, dust) * 2.2 * band;
  col += bandCol * band * (0.03 + 0.07 * clump) * exp(-tauDust);

  // Nebula: H-alpha red billowing outside, OIII teal tighter inside, two
  // independent noise fields, low saturation in the bright cores.
  vec3 q = d * 2.2 + uSeed * 0.37;
  vec3 warp = vec3(fbm(q, 4), fbm(q + 7.7, 4), fbm(q + 3.1, 4));
  float ha = pow(fbm(q * 1.4 + warp * 1.8, 6), 3.2) * 2.4;
  float o3 = pow(fbm(q * 2.3 + warp * 2.6 + 19.0, 6), 4.5) * 3.0;
  vec3 haCol = vec3(1.0, 0.227, 0.18) * mix(1.0, 0.8, uHue);
  vec3 o3Col = vec3(0.184, 0.827, 0.784);
  vec3 neb = haCol * ha * 0.22 + o3Col * o3 * 0.14;
  float coreL = dot(neb, vec3(0.3, 0.59, 0.11));
  neb = mix(neb, vec3(coreL), smoothstep(0.08, 0.3, coreL) * 0.5);
  neb *= exp(-smoothstep(0.5, 0.9, ridged(d * 4.0 + uSeed * 0.5, 5)) * 1.5);
  col += neb;

  // Stars: many faint, a few bright. Denser in the band.
  float dens = mix(0.0, 0.035, band);
  col += starLayer(d, 420.0, 0.965 - dens, 1.2);
  col += starLayer(d, 180.0, 0.985, 2.5);
  col += starLayer(d, 70.0, 0.993, 5.0);

  gl_FragColor = vec4(col, 1.0);
}
`;

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

function bake(gl: THREE.WebGLRenderer, seed: number, gal: THREE.Vector3, hue: number): THREE.WebGLCubeRenderTarget {
  const rt = new THREE.WebGLCubeRenderTarget(Q.cube, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const scene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false,
    uniforms: { uSeed: { value: (seed % 1000) * 0.913 }, uGal: { value: gal }, uHue: { value: hue } },
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 64, 32), mat));
  const cam = new THREE.CubeCamera(0.1, 100, rt);
  const prevTM = gl.toneMapping;
  gl.toneMapping = THREE.NoToneMapping;
  cam.update(gl, scene);
  gl.toneMapping = prevTM;
  mat.dispose();
  return rt;
}

/** Bakes the sky for this seed and sets it as the background. */
export function SkyBaker({ seed }: { seed: number }) {
  const gl = useThree(s => s.gl);
  const scene = useThree(s => s.scene);
  useEffect(() => {
    const s = seed >>> 0;
    const gal = new THREE.Vector3(Math.sin(s * 0.001) * 0.4, 1, Math.cos(s * 0.0013) * 0.4).normalize();
    const a = bake(gl, s, gal, 0);
    const b = bake(gl, (s * 7 + 12345) >>> 0, new THREE.Vector3(1, 0.3, 0.2).normalize(), 1);
    sky.a = a.texture; sky.b = b.texture; sky.version++;
    scene.background = a.texture;
    return () => { a.dispose(); b.dispose(); if (scene.background === a.texture) scene.background = null; };
  }, [gl, scene, seed]);
  return null;
}
