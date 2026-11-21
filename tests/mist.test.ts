import { MeshStandardMaterial, ShaderLib, type WebGLProgramParametersWithUniforms, type WebGLRenderer } from 'three'
import { describe, expect, it } from 'vitest'
import { misty, setMist, setMistTime } from '../src/render/mist'

function compile(material: MeshStandardMaterial) {
  const shader = { uniforms: {}, vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader } as unknown as WebGLProgramParametersWithUniforms
  material.onBeforeCompile(shader, {} as WebGLRenderer)
  return shader as unknown as { uniforms: Record<string, { value: number }>; vertexShader: string; fragmentShader: string }
}

describe('mist in the mountains', () => {
  it('adds itself to a material after the scene fog, sharing one set of values', () => {
    const a = compile(misty(new MeshStandardMaterial()))
    const b = compile(misty(new MeshStandardMaterial()))
    expect(a.vertexShader).toContain('vMist = ')
    expect(a.fragmentShader.indexOf('mistAmount > 0.0')).toBeGreaterThan(0)
    expect(a.fragmentShader.indexOf('mistAmount > 0.0')).toBeLessThan(a.fragmentShader.indexOf('#include <fog_fragment>'))
    expect(a.uniforms.mistAmount).toBe(b.uniforms.mistAmount)
    setMist(false)
    expect(a.uniforms.mistAmount.value).toBe(0)
    setMist(true)
    expect(b.uniforms.mistAmount.value).toBe(1)
    setMistTime(12)
    expect(a.uniforms.mistTime.value).toBe(12)
  })
})
