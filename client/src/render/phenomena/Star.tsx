// A star: blackbody photosphere with evolving granulation, quadratic limb
// darkening and sunspots, plus a faint streaky corona billboard. The dying
// central star ('sun') also pulses, faster and harder as `anger` rises.
// Output is linear HDR; bloom in the post pass does the glare.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Body } from '../../universe/bodies';
import { place } from '../origin';
import { NOISE_GLSL, BLACKBODY_GLSL } from '../sky';
import { LAPTOP, Q } from '../quality';

// Disc brightness (HDR). Enough to bloom at the limb, low enough that the
// granulation and limb darkening still read through AgX.
const SUN_I = 2.2;
const STAR_I = 8;

/** 0..1 brightness of the sun's current pulse, written every frame (audio reads it). */
export const sunPulse = { value: 0 };

const OCT = LAPTOP ? 5 : 3;

const STAR_VERT = /* glsl */ `
varying vec3 vObj;
varying vec3 vNView;
varying vec3 vViewPos;
void main() {
  vObj = normalize(position);
  vNView = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

const STAR_FRAG = /* glsl */ `
uniform float uTemp;
uniform float uTime;
uniform float uIntensity;
uniform float uSeed;
uniform float uAnger;
uniform float uPulse;
varying vec3 vObj;
varying vec3 vNView;
varying vec3 vViewPos;
${NOISE_GLSL}
${BLACKBODY_GLSL}
void main() {
  vec3 n = normalize(vNView);
  vec3 v = normalize(-vViewPos);
  float mu = clamp(dot(n, v), 0.0, 1.0);
  float x = 1.0 - mu;
  float limb = max(0.0, 1.0 - 0.47 * x - 0.23 * x * x);

  // Granulation: cells about 1/100 of the radius, slowly boiling.
  vec3 gp = vObj * 100.0 + vec3(uSeed);
  float fw = length(fwidth(gp));
  float gran = fbm(gp + vec3(0.0, uTime * 0.05, uTime * 0.08), ${OCT});
  gran = smoothstep(0.25, 0.75, gran);
  gran = mix(gran, 0.5, smoothstep(0.35, 1.2, fw)); // fade out when sub-pixel (no shimmer)
  float sup = fbm(vObj * 12.0 + vec3(uSeed * 0.7) + vec3(uTime * 0.01), 3);

  // Sunspots: thresholded slow noise, penumbra and darker umbra.
  float s = fbm(vObj * 2.6 + vec3(uSeed * 1.7) + vec3(uTime * 0.004), 4);
  float pen = smoothstep(0.64, 0.69, s);
  float umb = smoothstep(0.70, 0.75, s);

  vec3 base = blackbody(uTemp);
  float g = 0.78 + 0.32 * (gran - 0.5) + 0.18 * (sup - 0.5);
  vec3 col = base * uIntensity * limb * g;
  col *= mix(vec3(1.0), vec3(1.0, 0.68, 0.45), x * x); // redder rim
  col *= 1.0 - 0.5 * pen - 0.4 * umb;

  // Angry star: hot flare patches that swell with each pulse.
  float fl = smoothstep(0.58, 0.82, fbm(vObj * 5.0 + vec3(uSeed) - vec3(uTime * 0.12), 3));
  col += blackbody(uTemp * 1.8) * uIntensity * 0.7 * fl * uAnger * (0.4 + 0.6 * uPulse) * limb;

  gl_FragColor = vec4(col, 1.0);
}
`;

const BILLBOARD_VERT = /* glsl */ `
uniform float uSize;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy * uSize;
  gl_Position = projectionMatrix * mv;
}
`;

const CORONA_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uSeed;
uniform float uStrength;
uniform float uAnger;
uniform float uPulse;
varying vec2 vUv;
${NOISE_GLSL}
void main() {
  vec2 q = (vUv - 0.5) * 6.0; // in star radii: billboard spans 3 radii each way
  float r = length(q);
  vec2 dir = q / max(r, 1e-4);
  float inner = smoothstep(0.97, 1.04, r);
  float outer = 1.0 - smoothstep(2.3, 3.0, r);
  // Radial streaks: noise strong in angle, weak along the radius.
  float streak = fbm(vec3(dir * 5.0, uSeed) + vec3(0.0, 0.0, r * 0.35 - uTime * 0.03), 4);
  float fall = exp(-(r - 1.0) * 3.2);
  float I = fall * (0.25 + 1.5 * streak * streak);
  // Flares: long, sharp streaks when angry.
  float fl = pow(fbm(vec3(dir * 11.0, uSeed + 5.0) + vec3(0.0, 0.0, -uTime * 0.25), 4), 4.0) * 9.0;
  I += fl * exp(-(r - 1.0) * 1.1) * uAnger * (0.35 + 0.65 * uPulse);
  gl_FragColor = vec4(uColor * uStrength * I * inner * outer, 1.0);
}
`;

export function Star({ body, anger }: { body: Body; anger?: number }) {
  const group = useRef<THREE.Group>(null);
  const sphere = useRef<THREE.Mesh>(null);
  const phase = useRef(0);
  const seed = (body.seed % 1000) * 0.173;

  const geo = useMemo(() => new THREE.SphereGeometry(1, Q.sphereSeg, Math.round(Q.sphereSeg / 2)), []);
  const plane = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    uniforms: {
      uTemp: { value: body.temp }, uTime: { value: 0 }, uIntensity: { value: body.kind === 'sun' ? SUN_I : STAR_I },
      uSeed: { value: seed }, uAnger: { value: 0 }, uPulse: { value: 0 },
    },
    toneMapped: false,
  }), [body.temp, seed]);
  const corona = useMemo(() => {
    const c = new THREE.Color();
    // Rough blackbody for the corona tint (matches the GLSL closely enough).
    const t = THREE.MathUtils.clamp(body.temp, 1000, 40000) / 100;
    const r = t <= 66 ? 1 : THREE.MathUtils.clamp(1.292936 * Math.pow(t - 60, -0.1332047592), 0, 1);
    const g = t <= 66 ? THREE.MathUtils.clamp(0.3900815788 * Math.log(t) - 0.6318414438, 0, 1) : THREE.MathUtils.clamp(1.129890861 * Math.pow(t - 60, -0.0755148492), 0, 1);
    const b = t >= 66 ? 1 : t <= 19 ? 0 : THREE.MathUtils.clamp(0.5432067891 * Math.log(t - 10) - 1.19625408914, 0, 1);
    c.setRGB(r, g, b);
    return new THREE.ShaderMaterial({
      vertexShader: BILLBOARD_VERT,
      fragmentShader: CORONA_FRAG,
      uniforms: {
        uSize: { value: body.radius * 6 }, uColor: { value: c }, uTime: { value: 0 }, uSeed: { value: seed },
        uStrength: { value: 0.7 }, uAnger: { value: 0 }, uPulse: { value: 0 },
      },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    });
  }, [body.temp, body.radius, seed]);

  useEffect(() => () => { geo.dispose(); plane.dispose(); }, [geo, plane]);
  useEffect(() => () => mat.dispose(), [mat]);
  useEffect(() => () => corona.dispose(), [corona]);

  useFrame((state, rawDt) => {
    const g = group.current, s = sphere.current;
    if (!g || !s) return;
    place(g, body);
    const dt = Math.min(rawDt, 0.1);
    const t = state.clock.elapsedTime;
    let pulse = 0, a = 0;
    if (body.kind === 'sun') {
      a = THREE.MathUtils.clamp(anger ?? 0, 0, 1);
      const f = 0.15 + 0.85 * a; // Hz
      phase.current = (phase.current + dt * f * Math.PI * 2) % (Math.PI * 2000);
      pulse = Math.pow(0.5 + 0.5 * Math.sin(phase.current), 3);
      sunPulse.value = pulse;
    }
    const amp = body.kind === 'sun' ? 0.08 + 0.7 * a : 0;
    const u = mat.uniforms;
    u.uTime.value = t;
    u.uIntensity.value = (body.kind === 'sun' ? SUN_I : STAR_I) * (1 + amp * pulse);
    u.uAnger.value = a;
    u.uPulse.value = pulse;
    const scale = body.radius * (1 + (body.kind === 'sun' ? 0.008 + 0.035 * a : 0) * pulse);
    s.scale.setScalar(scale);
    const cu = corona.uniforms;
    cu.uTime.value = t;
    cu.uAnger.value = a;
    cu.uPulse.value = pulse;
    cu.uSize.value = scale * 6;
    cu.uStrength.value = 0.7 * (1 + amp * pulse);
  });

  return (
    <group ref={group}>
      <mesh ref={sphere} geometry={geo} material={mat} />
      <mesh geometry={plane} material={corona} frustumCulled={false} renderOrder={1} />
    </group>
  );
}
