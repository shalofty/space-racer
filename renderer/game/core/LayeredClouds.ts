import type { Camera, Mesh, Scene } from "three";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  Mesh as ThreeMesh,
  Points,
  PointsMaterial,
  PlaneGeometry,
  ShaderMaterial,
  SRGBColorSpace,
  Vector3 as ThreeVector3,
} from "three";
import type { NebulaQuality } from "./NebulaClouds";

type CloudKind = "wisp" | "thick";

function createStarSpriteTexture(): CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D context required for star sprite");
  }
  const cx = size / 2;
  const r = size / 2;
  const grad = ctx.createRadialGradient(cx, cx, 0, cx, cx, r);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.12, "rgba(255,255,255,0.95)");
  grad.addColorStop(0.42, "rgba(255,255,255,0.18)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

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
  private starLayers: {
    points: Points;
    positions: Float32Array;
    zSpeedFactor: number;
    nearMul: number;
    farMul: number;
  }[] = [];

  // Cloud volume placement.
  private readonly nearDepth: number;
  private readonly farDepth: number;
  private readonly recycleExtra: number;
  private readonly starSpriteTexture: CanvasTexture;

  constructor(scene: Scene, opts?: { nearDepth?: number; farDepth?: number }) {
    this.scene = scene;
    this.nearDepth = opts?.nearDepth ?? 20;
    this.farDepth = opts?.farDepth ?? 140;
    this.recycleExtra = 6;
    this.starSpriteTexture = createStarSpriteTexture();

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
        u_opacity: { value: 0.12 },
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
        u_opacity: { value: 0.24 },
        u_density: { value: 1.15 },
        u_threshold: { value: 0.68 },
        u_sharpness: { value: 2.4 },
        u_uvScale: { value: 2.0 },
        u_scrollScale: { value: 0.085 },
        u_warp: { value: 1.4 },
      },
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
      depthTest: true,
    });

    this.createStarLayers();
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
    this.createStarLayers();
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
    for (const s of this.starLayers) {
      const nearStarZ = camZ - this.nearDepth * s.nearMul;
      const farStarZ = camZ - this.farDepth * s.farMul - 180;
      const span = Math.max(1e-3, nearStarZ - farStarZ);
      const pos = s.positions;
      for (let i = 0; i < pos.length; i += 3) {
        pos[i + 0] = (Math.random() * 2 - 1) * 80;
        pos[i + 1] = (Math.random() * 2 - 1) * 45;
        pos[i + 2] = farStarZ + Math.random() * span;
      }
      const positionAttr = s.points.geometry.getAttribute("position");
      positionAttr.needsUpdate = true;
    }
  }

  private createStarLayers(): void {
    for (const s of this.starLayers) {
      this.scene.remove(s.points);
      s.points.geometry.dispose();
      const oldMat = s.points.material as PointsMaterial;
      oldMat.map = null;
      oldMat.dispose();
    }
    this.starLayers = [];

    const defs =
      this.quality === "low"
        ? [
            { count: 380, size: 0.8, speed: 0.22, nearMul: 0.12, farMul: 0.25 },
            { count: 250, size: 1.1, speed: 0.36, nearMul: 0.22, farMul: 0.45 },
          ]
        : this.quality === "high"
          ? [
              { count: 760, size: 0.75, speed: 0.2, nearMul: 0.12, farMul: 0.28 },
              { count: 620, size: 1.0, speed: 0.34, nearMul: 0.2, farMul: 0.48 },
              { count: 380, size: 1.35, speed: 0.5, nearMul: 0.3, farMul: 0.62 },
            ]
          : [
              { count: 560, size: 0.75, speed: 0.2, nearMul: 0.12, farMul: 0.28 },
              { count: 420, size: 1.0, speed: 0.34, nearMul: 0.22, farMul: 0.5 },
              { count: 280, size: 1.35, speed: 0.5, nearMul: 0.3, farMul: 0.62 },
            ];

    for (const def of defs) {
      const pos = new Float32Array(def.count * 3);
      for (let i = 0; i < def.count; i++) {
        const ii = i * 3;
        pos[ii + 0] = (Math.random() * 2 - 1) * 80;
        pos[ii + 1] = (Math.random() * 2 - 1) * 45;
        pos[ii + 2] = -Math.random() * 220;
      }
      const geo = new BufferGeometry();
      geo.setAttribute("position", new BufferAttribute(pos, 3));
      const mat = new PointsMaterial({
        map: this.starSpriteTexture,
        color: 0xbcd8ff,
        transparent: true,
        opacity: 0.8,
        alphaTest: 0.02,
        depthWrite: false,
        depthTest: true,
        fog: false,
        blending: AdditiveBlending,
        size: def.size,
        sizeAttenuation: true,
      });
      const points = new Points(geo, mat);
      points.renderOrder = 1;
      this.scene.add(points);
      this.starLayers.push({
        points,
        positions: pos,
        zSpeedFactor: def.speed,
        nearMul: def.nearMul,
        farMul: def.farMul,
      });
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

    for (const s of this.starLayers) {
      const points = s.points;
      const recycleStarZ = camZ + this.recycleExtra;
      const nearStarZ = camZ - this.nearDepth * s.nearMul;
      const farStarZ = camZ - this.farDepth * s.farMul - 180;
      const span = Math.max(1e-3, nearStarZ - farStarZ);
      const pos = s.positions;
      const layerDz = dz * s.zSpeedFactor;
      for (let i = 0; i < pos.length; i += 3) {
        pos[i + 2] += layerDz;
        if (pos[i + 2] > recycleStarZ) {
          pos[i + 0] = (Math.random() * 2 - 1) * 80;
          pos[i + 1] = (Math.random() * 2 - 1) * 45;
          pos[i + 2] = farStarZ + Math.random() * span;
        }
      }
      const positionAttr = points.geometry.getAttribute("position");
      positionAttr.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const p of this.planes) {
      this.scene.remove(p.mesh);
      p.mesh.geometry.dispose();
    }
    this.planes = [];
    for (const s of this.starLayers) {
      this.scene.remove(s.points);
      s.points.geometry.dispose();
      const mat = s.points.material as PointsMaterial;
      mat.map = null;
      mat.dispose();
    }
    this.starLayers = [];
    this.starSpriteTexture.dispose();
    this.wispsMaterial.dispose();
    this.thickMaterial.dispose();
  }
}

