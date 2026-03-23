import type { Camera, Scene } from "three";
import {
  BoxGeometry,
  DoubleSide,
  NormalBlending,
  Mesh,
  ShaderMaterial,
  Vector3,
} from "three";

export type NebulaQuality = "low" | "med" | "high";

export class NebulaClouds {
  private scene: Scene;
  private mesh: Mesh;

  private readonly halfSize: number;

  constructor(scene: Scene, volumeHalfSize = 120) {
    this.scene = scene;
    this.halfSize = volumeHalfSize;

    const geometry = new BoxGeometry(
      volumeHalfSize * 2,
      volumeHalfSize * 2,
      volumeHalfSize * 2,
    );

    const uniforms = {
      u_time: { value: 0 },
      u_distance: { value: 0 },
      u_cameraPos: { value: new Vector3() },
      u_volumeCenter: { value: new Vector3() },
      u_halfSize: { value: volumeHalfSize },
      // Lower noise scale => larger/lower-frequency structures (fewer clouds).
      u_noiseScale: { value: 0.012 },
      u_scrollScale: { value: 0.1 },
      u_brightness: { value: 0.75 },

      u_steps: { value: 28 },
      // Keep ray distance conservative so we don't sample too much volume.
      u_maxRayDistance: { value: volumeHalfSize * 1.35 },

      // Wisps (subtle)
      u_wispExtinction: { value: 0.55 },
      u_wispEmission: { value: 0.85 },
      u_wispColorA: { value: new Vector3(0.35, 0.75, 1.0) }, // cyan-blue
      u_wispColorB: { value: new Vector3(0.75, 0.35, 1.0) }, // purple

      // Thick (occluding)
      u_thickExtinction: { value: 0.65 },
      u_thickEmission: { value: 0.35 },
      u_thickColorA: { value: new Vector3(0.95, 0.35, 0.75) }, // pink-magenta
      u_thickColorB: { value: new Vector3(0.25, 0.85, 0.95) }, // teal

      // Noise tuning
      u_thickThreshold: { value: 0.72 },
      u_thickSharpness: { value: 2.2 },
    };

    const vertexShader = `
      varying vec3 vWorldPos;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `;

    // Raymarching shader: approximates volumetric nebula with separate wisps + thick clouds.
    const fragmentShader = `
      precision highp float;

      varying vec3 vWorldPos;

      uniform float u_time;
      uniform float u_distance;
      uniform vec3 u_cameraPos;
      uniform vec3 u_volumeCenter;
      uniform float u_halfSize;

      uniform float u_noiseScale;
      uniform float u_scrollScale;
      uniform float u_brightness;

      uniform int u_steps;
      uniform float u_maxRayDistance;

      uniform float u_wispExtinction;
      uniform float u_wispEmission;
      uniform vec3 u_wispColorA;
      uniform vec3 u_wispColorB;

      uniform float u_thickExtinction;
      uniform float u_thickEmission;
      uniform vec3 u_thickColorA;
      uniform vec3 u_thickColorB;

      uniform float u_thickThreshold;
      uniform float u_thickSharpness;

      // Hash + value noise (fast-ish, good enough for nebula look).
      float hash13(vec3 p) {
        p = fract(p * 0.1031);
        p += dot(p, p.yzx + 33.33);
        return fract((p.x + p.y) * p.z);
      }

      float valueNoise(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        vec3 u = f * f * (3.0 - 2.0 * f);

        float n000 = hash13(i + vec3(0.0, 0.0, 0.0));
        float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
        float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
        float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
        float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
        float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
        float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
        float n111 = hash13(i + vec3(1.0, 1.0, 1.0));

        float nx00 = mix(n000, n100, u.x);
        float nx10 = mix(n010, n110, u.x);
        float nx01 = mix(n001, n101, u.x);
        float nx11 = mix(n011, n111, u.x);

        float nxy0 = mix(nx00, nx10, u.y);
        float nxy1 = mix(nx01, nx11, u.y);

        return mix(nxy0, nxy1, u.z);
      }

      float fbm(vec3 p) {
        float sum = 0.0;
        float a = 0.5;
        // Keep this loop fixed so it compiles reliably.
        // Lower octave count for performance (still looks “nebula-ish”).
        for (int i = 0; i < 3; i++) {
          sum += a * valueNoise(p);
          p *= 2.0;
          a *= 0.5;
        }
        return sum;
      }

      void main() {
        // Ray setup in world space.
        vec3 ro = u_cameraPos;
        vec3 rd = normalize(vWorldPos - u_cameraPos);

        // Intersect ray with the cube volume.
        vec3 bmin = u_volumeCenter - vec3(u_halfSize);
        vec3 bmax = u_volumeCenter + vec3(u_halfSize);

        vec3 invR = 1.0 / rd;
        vec3 t0 = (bmin - ro) * invR;
        vec3 t1 = (bmax - ro) * invR;
        vec3 tsm = min(t0, t1);
        vec3 tbg = max(t0, t1);
        float tNear = max(max(tsm.x, tsm.y), tsm.z);
        float tFar = min(min(tbg.x, tbg.y), tbg.z);

        if (tFar < 0.0) discard;
        tNear = max(tNear, 0.0);
        tFar = min(tFar, u_maxRayDistance);
        if (tNear >= tFar) discard;

        float stepsF = float(u_steps);
        float tLen = (tFar - tNear);
        float stepSize = tLen / max(stepsF, 1.0);
        float invTLen = 1.0 / max(tLen, 1e-4);

        float T = 1.0; // transmittance
        vec3 accum = vec3(0.0);

        for (int i = 0; i < 96; i++) {
          if (float(i) >= stepsF) break;

          float t = tNear + (float(i) + 0.5) * stepSize;
          vec3 p = ro + rd * t;

          // Flow animation: shift the sampling coordinate by simulation distance.
          vec3 q = p * u_noiseScale;
          q.z += u_distance * u_scrollScale;
          q += vec3(0.0, 0.0, u_time * 0.015);

          // Depth gating: less density near the camera so clouds appear at distance.
          float depth01 = clamp((t - tNear) * invTLen, 0.0, 1.0);
          float nearFade = smoothstep(0.08, 0.28, depth01);

          // Coarse presence mask: keep it cheap (single-octave value noise).
          float coarse = valueNoise(q * 0.35 + vec3(11.1, 2.2, 5.5));
          float presence = smoothstep(0.55, 0.8, coarse);

          // Wisps: low threshold, smoother.
          float w0 = fbm(q * 1.0);
          float w = pow(max(w0 - 0.48, 0.0), 1.6);

          // Thick: higher threshold + sharper shaping for occluding clumps.
          float t0n = fbm(q * 1.75 + vec3(13.1, 7.4, 3.3));
          float thick = pow(max(t0n - u_thickThreshold, 0.0), u_thickSharpness);

          // Apply sparsity + depth fade to both layers.
          w *= (0.2 + 0.8 * presence) * nearFade;
          thick *= presence * nearFade;

          // Color palettes: reuse existing noise to avoid extra fbm calls.
          vec3 colW = mix(u_wispColorA, u_wispColorB, clamp(w0, 0.0, 1.0));
          vec3 colT = mix(u_thickColorA, u_thickColorB, clamp(t0n, 0.0, 1.0));

          float sigmaW = w * u_wispExtinction;
          float sigmaT = thick * u_thickExtinction;
          float sigma = sigmaW + sigmaT;

          // Beer-Lambert extinction across this step.
          float extinction = sigma * stepSize;
          float stepTrans = exp(-extinction);

          // Emission adds color but gets reduced by remaining transmittance.
          vec3 emission = (colW * w * u_wispEmission) + (colT * thick * u_thickEmission);
          accum += T * emission * stepSize * u_brightness;

          T *= stepTrans;

          // Early exit when almost fully opaque along the ray.
          if (T < 0.02) break;
        }

        float alpha = clamp(1.0 - T, 0.0, 1.0);
        // Keep alpha low so the ship/world stays visible while still occluding.
        alpha = clamp(alpha * 0.18, 0.0, 1.0);

        gl_FragColor = vec4(accum, alpha);
      }
    `;

    this.mesh = new Mesh(
      geometry,
      new ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: DoubleSide,
        blending: NormalBlending,
      }),
    );

    // Render after the skybox (skybox is opaque).
    this.mesh.renderOrder = 1;
    this.scene.add(this.mesh);
  }

  setQuality(quality: NebulaQuality): void {
    // Fixed presets for performance experiments.
    const mat = this.mesh.material as ShaderMaterial;
    const uniforms = mat.uniforms as Record<string, { value: any }>;
    if (quality === "low") {
      uniforms.u_steps.value = 12;
      uniforms.u_maxRayDistance.value = this.halfSize * 0.8;
      uniforms.u_brightness.value = 0.75;
    } else if (quality === "high") {
      uniforms.u_steps.value = 24;
      uniforms.u_maxRayDistance.value = this.halfSize * 1.15;
      uniforms.u_brightness.value = 1.05;
    } else {
      uniforms.u_steps.value = 18;
      uniforms.u_maxRayDistance.value = this.halfSize * 0.95;
      uniforms.u_brightness.value = 0.95;
    }
  }

  update(delta: number, camera: Camera, distance: number): void {
    const mat = this.mesh.material as ShaderMaterial;
    const uniforms = mat.uniforms as Record<string, { value: any }>;
    uniforms.u_time.value += delta;
    uniforms.u_distance.value = distance;

    const camPos = camera.position;
    uniforms.u_cameraPos.value.set(camPos.x, camPos.y, camPos.z);
    uniforms.u_volumeCenter.value.set(camPos.x, camPos.y, camPos.z);

    // Center the volume on camera for stable raymarch bounds.
    this.mesh.position.copy(camPos);
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as ShaderMaterial).dispose();
  }
}

