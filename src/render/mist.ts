import type { Material } from 'three'

// Mist in the mountains. By day a layer of low cloud lies over the valley
// and round the feet of the mountains: anything further than about 180 m
// fades into it, the more so the lower it stands, so the valley floor and
// the forest go pale with distance while the peaks stand clear above. The
// top of the layer rises and falls in slow banks that drift with time.
//
// It is a few lines added to the scene's own fog in the shaders of the
// valley's materials, so it costs no extra drawing. Low graphics turns it
// off.

// Shared by every misty material, so one write reaches them all.
const uniforms = {
  mistAmount: { value: 1 },
  mistTime: { value: 0 },
}

export function setMist(on: boolean) {
  uniforms.mistAmount.value = on ? 1 : 0
}

export function setMistTime(time: number) {
  uniforms.mistTime.value = time
}

const fragment = /* glsl */ `
#ifdef USE_FOG
if (mistAmount > 0.0) {
  float far = max(0.0, length(vMist - cameraPosition) - 180.0);
  vec2 p = vMist.xz;
  // Banks: where the layer's top stands, 25 to 115 m up.
  float bank = 0.5 + 0.28 * sin(p.x * 0.0037 + mistTime * 0.02) * sin(p.y * 0.0049 - mistTime * 0.016) + 0.22 * sin((p.x - p.y) * 0.0021 + mistTime * 0.012);
  float top = 25.0 + 90.0 * bank;
  float thick = exp(-max(0.0, vMist.y - top) / 40.0);
  float amount = (1.0 - exp(-far * 0.0024)) * thick * mistAmount;
  gl_FragColor.rgb = mix(gl_FragColor.rgb, mix(fogColor, vec3(1.0), 0.35), clamp(amount, 0.0, 0.9));
}
#endif
`

// Adds the mist to a material's shader and returns the material.
export function misty<M extends Material>(material: M): M {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <fog_pars_vertex>', '#include <fog_pars_vertex>\nvarying vec3 vMist;')
      // The world position, from the view-space one the fog already has.
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvMist = transpose(mat3(viewMatrix)) * (mvPosition.xyz - viewMatrix[3].xyz);')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <fog_pars_fragment>', '#include <fog_pars_fragment>\nvarying vec3 vMist;\nuniform float mistAmount;\nuniform float mistTime;')
      .replace('#include <fog_fragment>', `${fragment}\n#include <fog_fragment>`)
  }
  material.customProgramCacheKey = () => 'mist'
  return material
}
