// Two looks from one code path, chosen once at start (after Hacky's
// quality.ts): phone or laptop. ?quality=phone|laptop overrides.

export type Tier = 'laptop' | 'phone';

function gpuName(): string {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch { return ''; }
}

function decide(): Tier {
  const q = new URLSearchParams(location.search).get('quality');
  if (q === 'phone' || q === 'laptop') return q;
  if (navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse)').matches) return 'phone';
  const gpu = gpuName();
  if (/swiftshader|llvmpipe|mali|adreno|powervr|intel\(r\) hd graphics [2-6]/i.test(gpu)) return 'phone';
  if ((navigator.hardwareConcurrency ?? 8) <= 4) return 'phone';
  return 'laptop';
}

export const TIER: Tier = typeof window === 'undefined' ? 'laptop' : decide();
export const LAPTOP = TIER === 'laptop';

export const Q = LAPTOP
  ? { dpr: [1, 1.75] as [number, number], cube: 1024, stars: 20000, bhSteps: 200, bloomLevels: 8, sphereSeg: 96 }
  : { dpr: [0.75, 1] as [number, number], cube: 512, stars: 5000, bhSteps: 56, bloomLevels: 5, sphereSeg: 40 };
