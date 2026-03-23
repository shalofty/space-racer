/**
 * Full-screen pass: subtle RGB split (chromatic-ish) + vignette.
 * Uniforms are driven from Game for impact pulses.
 */
export const ImpactPostShader = {
  name: "ImpactPostShader",

  uniforms: {
    tDiffuse: { value: null },
    rgbAmount: { value: 0.002 },
    vignetteAmount: { value: 0.18 },
  },

  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float rgbAmount;
    uniform float vignetteAmount;
    varying vec2 vUv;

    void main() {
      vec2 offset = rgbAmount * vec2(0.85, 0.45);
      vec4 cr = texture2D(tDiffuse, vUv + offset);
      vec4 cga = texture2D(tDiffuse, vUv);
      vec4 cb = texture2D(tDiffuse, vUv - offset);
      vec3 color = vec3(cr.r, cga.g, cb.b);
      float d = distance(vUv, vec2(0.5));
      float vig = 1.0 - smoothstep(0.28, 0.98, d) * vignetteAmount;
      color *= vig;
      gl_FragColor = vec4(color, cga.a);
    }
  `,
};
