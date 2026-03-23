import type { Camera, Mesh, Scene } from "three";
import {
  AdditiveBlending,
  DoubleSide,
  Mesh as ThreeMesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector3 as ThreeVector3,
  NormalBlending,
} from "three";
import type { NebulaQuality } from "./NebulaClouds";

type CloudKind = "wisp" | "thick";

type CloudPlane = {
  mesh: Mesh;
  kind: CloudKind;
  // Base properties used for recycling.
  zSpeedFactor: number;
};

export class LayeredClouds {
  private scene: Scene;
  private cameraPos = new ThreeVector3();
  private planes: CloudPlane[] = [];
  private wispsMaterial: ShaderMaterial;
  private thickMaterial: ShaderMaterial;

  private quality: NebulaQuality = "med";

  // Cloud volume placement.
  private readonly nearDepth: number;
  private readonly farDepth: number;
  private readonly recycleExtra: number;

  constructor(scene: Scene, opts?: { nearDepth?: number; farDepth?: number }) {
    this.scene = scene;
    this.nearDepth = opts?.nearDepth ?? 20;
    this.farDepth = opts?.farDepth ?? 140;
    this.recycleExtra = 6;

    const vertexShader = `
      varying vec2 vUv;
      varying vec3 vWorldPos;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `;

    const fragmentShader = `
      precision highp float;

      varying vec2 vUv;
      varying vec3 vWorldPos;

      uniform float u_time;
      uniform float u_distance;
      uniform vec3 u_colorA;
      uniform vec3 u_colorB;
      uniform float u_opacity;
      uniform float u_density;
      uniform float u_threshold;
      uniform float u_sharpness;
      uniform float u_uvScale;
      uniform float u_scrollScale;
      uniform float u_warp;

      float clamp01(float x) {
        return clamp(x, 0.0, 1.0);
      }

      // 2D hash + value noise (cheap).
      float hash21(vec2 p) {
        p = fract(p * vec2(234.34, 435.345));
        p += dot(p, p + 34.23);
        return fract(p.x * p.y);
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        float a = hash21(i);
        float b = hash21(i + vec2(1.0, 0.0));
        float c = hash21(i + vec2(0.0, 1.0));
        float d = hash21(i + vec2(1.0, 1.0));
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }

      float fbm(vec2 p) {
        float sum = 0.0;
        float a = 0.5;
        for (int i = 0; i < 4; i++) {
          sum += a * noise(p);
          p *= 2.0;
          a *= 0.5;
        }
        return sum;
      }

      void main() {
        vec2 uv = vUv;

        // Warp UVs with world position so each plane differs slightly.
        float seed = fbm(vec2(vWorldPos.x * 0.005, vWorldPos.y * 0.005));
        float warp = (seed - 0.5) * u_warp;

        vec2 flow = vec2(0.0, u_distance * u_scrollScale) + vec2(u_time * 0.03, u_time * 0.015);
        vec2 p = uv * u_uvScale + flow + vec2(warp, -warp);

        float n = fbm(p * 0.9 + vec2(1.7, 9.2));

        // Convert noise -> density field.
        float d = pow(max(n - u_threshold, 0.0), u_sharpness) * u_density;

        // Slightly fade at plane edges.
        vec2 centered = uv - 0.5;
        float edge = smoothstep(0.62, 0.15, length(centered));
        float alpha = clamp(d * edge * u_opacity, 0.0, 1.0);

        vec3 col = mix(u_colorA, u_colorB, clamp01(n));
        vec3 rgb = col * alpha;

        gl_FragColor = vec4(rgb, alpha);
      }
    `;

    const baseUniforms = {
      u_time: { value: 0 },
      u_distance: { value: 0 },
      u_colorA: { value: new ThreeVector3(0.35, 0.75, 1.0) },
      u_colorB: { value: new ThreeVector3(0.75, 0.35, 1.0) },
      u_opacity: { value: 0.08 },
      u_density: { value: 1.0 },
      u_threshold: { value: 0.6 },
      u_sharpness: { value: 2.0 },
      u_uvScale: { value: 2.5 },
      u_scrollScale: { value: 0.08 },
      u_warp: { value: 1.2 },
    };

    this.wispsMaterial = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        ...baseUniforms,
        u_colorA: { value: new ThreeVector3(0.35, 0.75, 1.0) },
        u_colorB: { value: new ThreeVector3(0.55, 0.25, 1.0) },
        u_opacity: { value: 0.07 },
        u_density: { value: 0.9 },
        u_threshold: { value: 0.62 },
        u_sharpness: { value: 2.0 },
        u_uvScale: { value: 2.2 },
        u_scrollScale: { value: 0.07 },
        u_warp: { value: 1.0 },
      },
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
      depthTest: true,
    });

    this.thickMaterial = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        ...baseUniforms,
        u_colorA: { value: new ThreeVector3(0.95, 0.35, 0.75) },
        u_colorB: { value: new ThreeVector3(0.25, 0.85, 0.95) },
        u_opacity: { value: 0.16 },
        u_density: { value: 1.15 },
        u_threshold: { value: 0.68 },
        u_sharpness: { value: 2.4 },
        u_uvScale: { value: 2.0 },
        u_scrollScale: { value: 0.085 },
        u_warp: { value: 1.4 },
      },
      transparent: true,
      blending: NormalBlending,
      depthWrite: false,
      side: DoubleSide,
      depthTest: true,
    });
  }

  setQuality(quality: NebulaQuality): void {
    if (this.quality === quality) return;
    this.quality = quality;
    this.rebuild();
  }

  private rebuild(): void {
    for (const p of this.planes) {
      this.scene.remove(p.mesh);
      p.mesh.geometry.dispose();
    }
    this.planes = [];
    this.createPlanes();
  }

  reset(camera: Camera): void {
    this.cameraPos.copy(camera.position);
    this.rebuild();
    // Set initial positions now that we have camera reference.
    const camZ = this.cameraPos.z;
    const nearZ = camZ - this.nearDepth;
    const farZ = camZ - this.farDepth;

    for (const p of this.planes) {
      this.resetPlane(p, nearZ, farZ);
      this.orientPlaneToCamera(p.mesh, camera);
    }
  }

  private createPlanes(): void {
    const wispsCount = this.quality === "low" ? 8 : this.quality === "high" ? 18 : 12;
    const thickCount = this.quality === "low" ? 3 : this.quality === "high" ? 7 : 5;
    const total = wispsCount + thickCount;

    for (let i = 0; i < total; i++) {
      const kind: CloudKind = i < wispsCount ? "wisp" : "thick";
      const mat = kind === "wisp" ? this.wispsMaterial : this.thickMaterial;
      const mesh = new ThreeMesh(new PlaneGeometry(1, 1, 1, 1), mat);
      mesh.frustumCulled = true;
      // Render after the skybox.
      mesh.renderOrder = 2;
      this.scene.add(mesh);

      // Different clouds move at slightly different rates.
      const zSpeedFactor = kind === "wisp" ? 0.9 + Math.random() * 0.25 : 0.75 + Math.random() * 0.35;
      this.planes.push({ mesh, kind, zSpeedFactor });
    }
  }

  private resetPlane(plane: CloudPlane, nearZ: number, farZ: number): void {
    // Keep clouds mostly around the center line.
    const x = (Math.random() * 2 - 1) * 10;
    const y = (Math.random() * 2 - 1) * 5;
    const z = farZ + Math.random() * (nearZ - farZ);

    // Scale more for nearer planes.
    const depth01 = (z - farZ) / Math.max(1e-4, nearZ - farZ); // 0..1 (far->near)
    const scaleBase = plane.kind === "wisp" ? 10 : 16;
    const scale = scaleBase * (0.55 + 0.9 * depth01) * (0.85 + Math.random() * 0.3);

    plane.mesh.position.set(x, y, z);
    plane.mesh.scale.set(scale, scale * 0.55, 1);
  }

  private orientPlaneToCamera(mesh: Mesh, camera: Camera): void {
    // Face the camera: makes it a billboard.
    mesh.lookAt(camera.position);
  }

  update(delta: number, camera: Camera, effectiveSpeed: number, distance: number): void {
    const dz = effectiveSpeed * delta;
    const camZ = camera.position.z;
    const nearZ = camZ - this.nearDepth;
    const farZ = camZ - this.farDepth;

    this.cameraPos.copy(camera.position);

    // Update shader time/distance once per frame.
    this.wispsMaterial.uniforms.u_time.value += delta;
    this.wispsMaterial.uniforms.u_distance.value = distance;
    this.thickMaterial.uniforms.u_time.value += delta;
    this.thickMaterial.uniforms.u_distance.value = distance;

    for (const p of this.planes) {
      p.mesh.position.z += dz * p.zSpeedFactor;

      // If it has passed the camera area, recycle it far behind.
      if (p.mesh.position.z > camZ + this.recycleExtra) {
        this.resetPlane(p, nearZ, farZ);
        this.orientPlaneToCamera(p.mesh, camera);
      }
    }
  }

  dispose(): void {
    for (const p of this.planes) {
      this.scene.remove(p.mesh);
      p.mesh.geometry.dispose();
    }
    this.planes = [];
    this.wispsMaterial.dispose();
    this.thickMaterial.dispose();
  }
}

