import {
  AdditiveBlending,
  AmbientLight,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
  Color,
  BoxGeometry,
  BackSide,
  Mesh,
  Clock,
  HemisphereLight,
  DirectionalLight,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Euler,
  TextureLoader,
  Vector2,
  Vector3,
  SphereGeometry,
  ConeGeometry,
  FogExp2,
  PointLight,
} from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ImpactPostShader } from "./core/ImpactPostShader";
import { eventBus } from "./core/EventBus";
import { SpeedController } from "./core/SpeedController";
import { PowerupSystem } from "./core/PowerupSystem";
import { AsteroidManager } from "./core/AsteroidManager";
import { Player } from "./entities/Player";
import { MovementSystem } from "./systems/MovementSystem";
import { WorldScrollSystem } from "./systems/WorldScrollSystem";
import { SpawnSystem } from "./systems/SpawnSystem";
import { CollisionSystem } from "./systems/CollisionSystem";
import { ParticleSystem } from "./core/ParticleSystem";
import { NebulaClouds, type NebulaQuality } from "./core/NebulaClouds";
import { LayeredClouds } from "./core/LayeredClouds";
import { gameConfig } from "./config/gameConfig";
import { getThrusterNozzleLocals } from "./config/thrusterTuning";

export class Game {
  private renderer: WebGLRenderer | null = null;
  private scene: Scene | null = null;
  private camera: PerspectiveCamera | null = null;
  private animationFrameId: number | null = null;
  private running = false;
  private resizeObserver: ResizeObserver | null = null;
  private playerObject: Object3D | null = null;
  private clock = new Clock();
  private speedController = new SpeedController(gameConfig.BASE_SPEED);
  private powerupSystem = new PowerupSystem(
    this.speedController,
    gameConfig.SHIP_SHIELD_MAX,
  );
  private asteroidManager = new AsteroidManager();
  private distance = 0;
  private time = 0;
  private uiAccumulator = 0;
  private player = new Player();
  private movementSystem = new MovementSystem(this.player);
  private worldScrollSystem: WorldScrollSystem | null = null;
  private spawnSystem: SpawnSystem | null = null;
  private collisionSystem!: CollisionSystem;
  private basePlayerRotation = new Euler(0, 0, 0);
  private skyboxNames: string[] = ["skybox1", "skybox2", "skybox3", "skybox4", "skybox5", "skybox6", "skybox7", "skybox8", "skybox9"];
  private skyboxIndex = 0;
  private skyboxMesh: Mesh | null = null;
  /** Continues during deep space (no cubemap) so the next skybox does not pop rotation. */
  private skyboxEuler = new Euler(0, 0, 0);
  private skyboxPhase: "full" | "fadeOut" | "deepSpace" | "fadeIn" = "full";
  private skyboxCycleSegmentTime = 0;
  private skyboxCycleSegmentDistanceStart = 0;
  private composer: EffectComposer | null = null;
  private particleSystem!: ParticleSystem;
  private nebulaClouds: NebulaClouds | null = null;
  private nebulaQuality: NebulaQuality = "high";
  // Default to performant layered clouds; raymarch stays available behind a toggle.
  // We can later replace this with a real settings toggle.
  private cloudsRaymarchEnabled = false;
  private layeredClouds: LayeredClouds | null = null;

  // Skybox rotation parameters are randomized per run to add variation.
  private skyboxRotXDir = 1;
  private skyboxRotXBaseSpeed = 0.1;
  private skyboxRotZDir = 1;
  private skyboxRotZBaseSpeed = 0.04;
  private skyboxRotZActive = true;
  private skyboxRotZToggleInterval = 5; // seconds
  private skyboxRotZToggleAcc = 0;
  private input = {
    left: false,
    right: false,
    up: false,
    down: false,
    shift: false,
    fire: false,
  };

  /** When `active`, strafe comes from virtual joystick; otherwise keyboard. */
  private touchInput = {
    active: false,
    strafeX: 0,
    strafeY: 0,
    boost: false,
    fire: false,
  };

  private energyRemaining: number = gameConfig.ENERGY_MAX;
  private hullRemaining: number = gameConfig.SHIP_HULL_MAX;
  private laserCooldownRemaining = 0;
  private laserGeometry = new SphereGeometry(gameConfig.LASER_RADIUS, 8, 8);
  private laserMaterial = new MeshBasicMaterial({ color: 0x66e6ff });
  private lasers: Mesh[] = [];
  private laserSoundTemplate: HTMLAudioElement | null = null;
  private explosionAsteroidSound: HTMLAudioElement | null = null;
  private explosionShipSound: HTMLAudioElement | null = null;
  private impactPostPass: ShaderPass | null = null;
  private readonly cameraRestPosition = new Vector3(0, 3, 8);
  private screenShake = 0;
  private postImpact = 0;
  private engineLight: PointLight | null = null;
  private rimLight: PointLight | null = null;
  private cameraFillLight: PointLight | null = null;
  private readonly cameraFillOffsetLocal = new Vector3(0, -0.35, -2.4);
  private readonly cameraFillScratch = new Vector3();
  private shipEmissiveFlow = 0;
  private shipEmissiveMaterials: {
    material: MeshStandardMaterial;
    baseIntensity: number;
    phase: number;
    boostScale: number;
  }[] = [];
  /** Inner additive cone mesh (narrow, bright) parented to ship; flickers in `applyCameraAndPostFx`. */
  private thrusterFlameCore: Mesh | null = null;
  /** Outer additive cone (wider, dimmer) for soft glow around the core. */
  private thrusterFlameOuter: Mesh | null = null;
  /**
   * Ship FBX uses ~0.01 scale; cone geometry is authored in "normal" units, so we multiply scale by `1/sx`
   * when the ship is tiny so flames stay a visible world size (matches ParticleSystem nozzle math).
   */
  private thrusterFlameScaleComp = 1;
  private gameOverPending = false;
  private gameOverTimeoutId: number | null = null;

  /**
   * Builds two `ConeGeometry` meshes, parents them to `target` (ship root), and stores refs for per-frame flicker.
   * This is the **mesh** thruster readout; `ParticleSystem` adds separate **point-sprite** streaks at a matching nozzle.
   */
  private attachThrusterFlames(target: Object3D): void {
    // Drop any previous cones (e.g. swapping placeholder for loaded FBX) and free GPU resources.
    this.detachThrusterFlames(true);

    // Uniform X scale tells us the ship's world size (FBX import uses uniform scale).
    const sx = Math.max(1e-6, target.scale.x);
    const tinyShip = sx < 0.15;
    // Blow up child scale so cone dimensions stay visible in world space (pairs with ParticleSystem `lz`).
    this.thrusterFlameScaleComp = tinyShip ? 1 / sx : 1;
    const c = this.thrusterFlameScaleComp;
    const { ny, zCore, zOuter } = getThrusterNozzleLocals(sx);

    // Default cone: axis +Y, base at y=0 (wide), tip at y=h (narrow). Translate up by h/2 so the wide base sits at origin.
    const hCore = 2.25;
    const hOuter = 3.35;
    const geoCore = new ConeGeometry(0.048, hCore, 18, 1, true);
    geoCore.translate(0, hCore / 2, 0);
    const geoOuter = new ConeGeometry(0.095, hOuter, 20, 1, true);
    geoOuter.translate(0, hOuter / 2, 0);

    // Core: small radius, shorter — hot center of the plume.
    const core = new Mesh(
      geoCore,
      new MeshBasicMaterial({
        color: 0xffd4a8,
        transparent: true,
        opacity: 0.58,
        blending: AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    // -90° X: cone axis (+Y) aligns with **local -Z** so the flame extends backward from the hull.
    core.rotation.x = -Math.PI * 0.5;
    // Match particle nozzle (world offsets in `gameConfig`); zCore sits the cone base near the stern.
    core.position.set(0, ny, zCore);
    core.renderOrder = 5;
    core.scale.setScalar(c);

    // Outer: wider, longer, more transparent — additive halo around the core.
    const outer = new Mesh(
      geoOuter,
      new MeshBasicMaterial({
        color: 0xff7a38,
        transparent: true,
        opacity: 0.22,
        blending: AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    outer.rotation.x = -Math.PI * 0.5;
    outer.position.set(0, ny, zOuter);
    outer.renderOrder = 5;
    outer.scale.setScalar(c * 1.06);

    // Draw outer first, then core so the bright center stacks on top (same `renderOrder`).
    target.add(outer);
    target.add(core);
    this.thrusterFlameCore = core;
    this.thrusterFlameOuter = outer;
  }

  /**
   * Dev: move thruster cone meshes when `thrusterTuning` sliders change (particles read tuning each frame).
   */
  repositionThrusterFlames(): void {
    if (
      !this.thrusterFlameCore ||
      !this.thrusterFlameOuter ||
      !this.playerObject
    ) {
      return;
    }
    const { ny, zCore, zOuter } = getThrusterNozzleLocals(
      this.playerObject.scale.x,
    );
    this.thrusterFlameCore.position.set(0, ny, zCore);
    this.thrusterFlameOuter.position.set(0, ny, zOuter);
  }

  /**
   * Touch / virtual joystick: when `active`, strafe uses `strafeX` / `strafeY` (-1..1);
   * otherwise keyboard movement applies. Merged with keyboard for boost and fire.
   */
  setTouchInput(state: {
    active: boolean;
    strafeX: number;
    strafeY: number;
    boost: boolean;
    fire: boolean;
  }): void {
    this.touchInput = { ...state };
  }

  /** Remove thruster meshes from their parent; optionally dispose geometry/materials. */
  private detachThrusterFlames(dispose: boolean): void {
    const drop = (m: Mesh | null) => {
      if (!m) return;
      if (m.parent) m.parent.remove(m);
      if (!dispose) return;
      m.geometry.dispose();
      (m.material as MeshBasicMaterial).dispose();
    };
    drop(this.thrusterFlameCore);
    drop(this.thrusterFlameOuter);
    this.thrusterFlameCore = null;
    this.thrusterFlameOuter = null;
    this.thrusterFlameScaleComp = 1;
  }

  private disposeSkyboxMesh(): void {
    if (!this.skyboxMesh) return;
    if (this.skyboxMesh.parent) {
      this.skyboxMesh.parent.remove(this.skyboxMesh);
    }
    this.skyboxMesh.geometry.dispose();
    const mats = this.skyboxMesh.material as MeshBasicMaterial[];
    for (const m of mats) {
      m.map?.dispose();
      m.dispose();
    }
    this.skyboxMesh = null;
  }

  private applySkyboxOpacity(opacity: number): void {
    if (!this.skyboxMesh) return;
    const mats = this.skyboxMesh.material as MeshBasicMaterial[];
    const o = Math.max(0, Math.min(1, opacity));
    for (const m of mats) {
      // Must stay transparent so opacity is blended every frame (opaque materials ignore opacity).
      m.transparent = true;
      m.opacity = o;
    }
  }

  private skyboxComboProgress(
    timeElapsed: number,
    distElapsed: number,
    timeCap: number,
    distCap: number,
  ): number {
    const wT = gameConfig.SKYBOX_COMBO_WEIGHT_TIME;
    const wD = 1 - wT;
    const tn = Math.min(1, timeCap > 1e-6 ? timeElapsed / timeCap : 1);
    const dn = Math.min(1, distCap > 1e-6 ? distElapsed / distCap : 1);
    return Math.min(1, wT * tn + wD * dn);
  }

  private updateSkyboxEulerRotation(delta: number, effectiveSpeed: number): void {
    const factor = effectiveSpeed / gameConfig.BASE_SPEED;
    const rotX = this.skyboxRotXBaseSpeed * this.skyboxRotXDir * factor * delta;
    this.skyboxEuler.x += rotX;

    this.skyboxRotZToggleAcc += delta;
    if (this.skyboxRotZToggleAcc >= this.skyboxRotZToggleInterval) {
      this.skyboxRotZToggleAcc = 0;
      this.skyboxRotZActive = Math.random() < 0.6;
      this.skyboxRotZDir = Math.random() < 0.5 ? -1 : 1;
      this.skyboxRotZToggleInterval = 3.5 + Math.random() * 4.5;
    }
    if (this.skyboxRotZActive) {
      const rotZ =
        this.skyboxRotZBaseSpeed * this.skyboxRotZDir * factor * delta;
      this.skyboxEuler.z += rotZ;
    }
  }

  private updateSkyboxCycle(delta: number): void {
    const scene = this.scene;
    if (!scene || this.skyboxNames.length === 0) return;

    // Avoid finishing a fade in one frame after a long tab blur / hitch.
    const d = Math.min(delta, 0.1);

    const cfg = gameConfig;
    const segDist = this.distance - this.skyboxCycleSegmentDistanceStart;

    switch (this.skyboxPhase) {
      case "full": {
        this.skyboxCycleSegmentTime += d;
        if (
          this.skyboxCycleSegmentTime >= cfg.SKYBOX_VISIBLE_MIN_TIME_SEC &&
          segDist >= cfg.SKYBOX_VISIBLE_MIN_DISTANCE
        ) {
          this.skyboxPhase = "fadeOut";
          this.skyboxCycleSegmentTime = 0;
          this.skyboxCycleSegmentDistanceStart = this.distance;
        }
        break;
      }
      case "fadeOut": {
        this.skyboxCycleSegmentTime += d;
        const p = this.skyboxComboProgress(
          this.skyboxCycleSegmentTime,
          segDist,
          cfg.SKYBOX_FADE_OUT_TIME_SEC,
          cfg.SKYBOX_FADE_OUT_DISTANCE,
        );
        this.applySkyboxOpacity(1 - p);
        if (p >= 1 - 1e-5) {
          this.disposeSkyboxMesh();
          this.skyboxPhase = "deepSpace";
          this.skyboxCycleSegmentTime = 0;
          this.skyboxCycleSegmentDistanceStart = this.distance;
        }
        break;
      }
      case "deepSpace": {
        this.skyboxCycleSegmentTime += d;
        if (
          this.skyboxCycleSegmentTime >= cfg.SKYBOX_DEEP_SPACE_MIN_SEC &&
          segDist >= cfg.SKYBOX_DEEP_SPACE_MIN_DISTANCE
        ) {
          this.applyRandomSkybox(scene, { opacity: 0 });
          this.skyboxPhase = "fadeIn";
          this.skyboxCycleSegmentTime = 0;
          this.skyboxCycleSegmentDistanceStart = this.distance;
        }
        break;
      }
      case "fadeIn": {
        this.skyboxCycleSegmentTime += d;
        const p = this.skyboxComboProgress(
          this.skyboxCycleSegmentTime,
          segDist,
          cfg.SKYBOX_FADE_IN_TIME_SEC,
          cfg.SKYBOX_FADE_IN_DISTANCE,
        );
        this.applySkyboxOpacity(p);
        if (p >= 1 - 1e-5) {
          this.applySkyboxOpacity(1);
          this.skyboxPhase = "full";
          this.skyboxCycleSegmentTime = 0;
          this.skyboxCycleSegmentDistanceStart = this.distance;
        }
        break;
      }
    }
  }

  private resetSkyboxCycle(): void {
    this.skyboxPhase = "full";
    this.skyboxCycleSegmentTime = 0;
    this.skyboxCycleSegmentDistanceStart = this.distance;
  }

  private applyRandomSkybox(
    scene: Scene,
    options?: { opacity?: number },
  ): void {
    if (this.skyboxNames.length === 0) return;
    const opacity = options?.opacity ?? 1;
    const choice = this.skyboxNames[this.skyboxIndex % this.skyboxNames.length];
    this.skyboxIndex++;
    const base = `/skyboxes/${choice}/`;

    this.skyboxRotXDir = Math.random() < 0.5 ? -1 : 1;
    this.skyboxRotXBaseSpeed = 0.08 + Math.random() * 0.05;
    this.skyboxRotZDir = Math.random() < 0.5 ? -1 : 1;
    this.skyboxRotZBaseSpeed = 0.03 + Math.random() * 0.05;
    this.skyboxRotZActive = Math.random() < 0.6;
    this.skyboxRotZToggleInterval = 3.5 + Math.random() * 4.5;
    this.skyboxRotZToggleAcc = 0;

    this.disposeSkyboxMesh();

    const loader = new TextureLoader();
    const geometry = new BoxGeometry(500, 500, 500);
    const o = Math.max(0, Math.min(1, opacity));
    const materials = [
      "right",
      "left",
      "top",
      "bottom",
      "front",
      "back",
    ].map(
      (name) =>
        new MeshBasicMaterial({
          map: loader.load(`${base}${name}.png`),
          side: BackSide,
          fog: false,
          depthWrite: false,
          transparent: true,
          opacity: o,
        }),
    );

    const skybox = new Mesh(geometry, materials);
    skybox.renderOrder = -1000;
    skybox.rotation.copy(this.skyboxEuler);
    scene.add(skybox);
    this.skyboxMesh = skybox;
  }

  init(canvas: HTMLCanvasElement): void {
    const renderer = new WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    renderer.setClearColor(new Color(0x000000));

    const scene = new Scene();
    this.applyRandomSkybox(scene);
    this.resetSkyboxCycle();
    this.particleSystem = new ParticleSystem(scene);
    this.laserSoundTemplate = new Audio("/music/laser.wav");
    this.laserSoundTemplate.volume = 0.42;
    this.laserSoundTemplate.preload = "auto";
    this.explosionAsteroidSound = new Audio("/music/explosion-asteroid.wav");
    this.explosionAsteroidSound.volume = 0.55;
    this.explosionAsteroidSound.preload = "auto";
    this.explosionShipSound = new Audio("/music/explosion-ship.wav");
    this.explosionShipSound.volume = 0.62;
    this.explosionShipSound.preload = "auto";
    this.nebulaClouds = null;
    this.layeredClouds = null;

    // Clouds rendering path:
    // - Raymarch nebula (very expensive) behind a toggle for later experimentation.
    // - Layered planes/billboards (performant) by default.
    if (this.cloudsRaymarchEnabled) {
      this.nebulaClouds = new NebulaClouds(scene, 95);
      this.nebulaClouds.setQuality(this.nebulaQuality);
    } else {
      this.layeredClouds = new LayeredClouds(scene);
      this.layeredClouds.setQuality(this.nebulaQuality);
    }

    const camera = new PerspectiveCamera(
      60,
      canvas.clientWidth / canvas.clientHeight || 1,
      0.1,
      1000,
    );
    camera.position.set(0, 3, 8);
    camera.lookAt(0, 0, 0);

    // Initialize layered cloud planes now that camera reference exists.
    this.layeredClouds?.reset(camera);

    // Postprocessing pipeline (bloom)
    const composer = new EffectComposer(renderer);
    const width = canvas.clientWidth || 1;
    const height = canvas.clientHeight || 1;
    composer.setSize(width, height);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(
      new Vector2(width, height),
      gameConfig.BLOOM_STRENGTH,
      gameConfig.BLOOM_RADIUS,
      gameConfig.BLOOM_THRESHOLD,
    );
    composer.addPass(bloomPass);
    this.impactPostPass = new ShaderPass(ImpactPostShader);
    composer.addPass(this.impactPostPass);
    this.composer = composer;

    scene.fog = new FogExp2(new Color(gameConfig.FOG_COLOR), gameConfig.FOG_DENSITY);

    const ambient = new AmbientLight(0x9ab7ff, gameConfig.AMBIENT_INTENSITY);
    scene.add(ambient);
    const hemi = new HemisphereLight(0xb8d4ff, 0x4a5468, 0.72);
    scene.add(hemi);
    const dir = new DirectionalLight(0xffffff, gameConfig.KEY_LIGHT_INTENSITY);
    dir.position.set(5, 10, 5);
    scene.add(dir);
    const fillDir = new DirectionalLight(0x7aa6ff, gameConfig.FILL_LIGHT_INTENSITY);
    fillDir.position.set(-6, 2, -4);
    scene.add(fillDir);

    // Cyan point light near the stern; each frame it is snapped to the ship + animated (see `applyCameraAndPostFx`).
    this.engineLight = new PointLight(0x66dfff, 0.9, 9, 2);
    this.engineLight.position.set(0, 0, 0.65);
    scene.add(this.engineLight);

    this.rimLight = new PointLight(0xa8c4ff, 0.95, 28, 2);
    this.rimLight.position.set(0, 1.2, -3.8);
    scene.add(this.rimLight);

    this.cameraFillLight = new PointLight(0xd8e8ff, 0.88, 52, 1.85);
    scene.add(this.cameraFillLight);

    // Temporary placeholder until FBX loads
    const placeholder = new Mesh(
      new BoxGeometry(1, 1, 1),
      new MeshStandardMaterial({ color: 0x00ffcc }),
    );
    scene.add(placeholder);
    this.basePlayerRotation.copy(placeholder.rotation);
    // VFX follow the same object the player sees until FBX finishes loading.
    this.particleSystem.setShipObject(placeholder);
    this.attachThrusterFlames(placeholder);

    this.worldScrollSystem = new WorldScrollSystem(
      [],
      gameConfig.WORLD_SCROLL_SPACING_Z,
    );

    this.collisionSystem = new CollisionSystem(this.player, (obstacle) => {
      if (this.gameOverPending) return;

      this.applyCollisionImpulse(obstacle);

      // Same burst as laser kill: asteroid breaks apart instead of vanishing.
      this.particleSystem.spawnAsteroidExplosion(obstacle.position);
      this.playExplosionAsteroidSound();
      this.worldScrollSystem?.removeDynamicObject(obstacle);

      const shieldBefore = this.powerupSystem.getShield();
      const halfShield = gameConfig.SHIP_SHIELD_MAX * 0.5;

      const shieldOverflow = this.powerupSystem.absorbDamage(
        gameConfig.COLLISION_SHIELD_DAMAGE,
      );

      // Hull damage tiers (based on shield before this hit):
      // - Above half shield: hull not damaged (shield absorbs the collision).
      // - Half or below, but shield > 0: light hull chip (1/10 base) plus any overflow.
      // - No shield: full hull damage plus overflow.
      let hullDamage = 0;
      if (shieldBefore > halfShield) {
        hullDamage = 0;
      } else if (shieldBefore > 0) {
        hullDamage =
          gameConfig.COLLISION_HULL_DAMAGE * 0.1 + shieldOverflow;
      } else {
        hullDamage = gameConfig.COLLISION_HULL_DAMAGE + shieldOverflow;
      }

      this.hullRemaining = Math.max(0, this.hullRemaining - hullDamage);

      if (this.hullRemaining <= 0) {
        this.addScreenShake(1.05);
        this.addPostImpact(0.92);
        this.playExplosionShipSound();
        this.gameOverPending = true;
        if (this.playerObject) {
          this.particleSystem.spawnShipExplosion(this.playerObject.position);
          this.playerObject.visible = false;
        }
        this.gameOverTimeoutId = window.setTimeout(() => {
          eventBus.emit("gameOver", {
            score: this.distance + this.time * 1.0,
            time: this.time,
            reason: "hull",
          });
          this.gameOverTimeoutId = null;
        }, gameConfig.SHIP_EXPLOSION_DELAY_MS);
      } else {
        this.addScreenShake(0.14);
        this.addPostImpact(0.26);
      }
    });

    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.playerObject = placeholder;
    this.clock.start();
    this.distance = 0;
    this.time = 0;
    this.uiAccumulator = 0;

    this.spawnSystem = new SpawnSystem(
      scene,
      this.worldScrollSystem,
      {
        maxX: this.player.maxX,
        maxY: this.player.maxY,
        halfWidth: this.player.halfWidth,
      },
      this.collisionSystem,
      this.asteroidManager,
      this.particleSystem,
    );

    // Preload asteroid templates (so spawns don't stutter).
    this.asteroidManager.preloadAll().catch((err) => {
      console.error("Failed to preload asteroids", err);
    });

    // Load original low-poly spaceship model (FBX, served from renderer/public/models/)
    const loader = new FBXLoader();
    loader.load(
      "/models/spaceship.fbx",
      (ship) => {
        ship.scale.setScalar(0.01);
        ship.rotation.set(0, Math.PI, 0);
        ship.position.set(0, 0, 0);
        this.shipEmissiveMaterials = [];
        this.shipEmissiveFlow = 0;
        ship.traverse((node) => {
          const m = (node as any).material;
          if (!m) return;
          const mats = Array.isArray(m) ? m : [m];
          for (const mm of mats) {
            if (!mm) continue;
            mm.transparent = false;
            mm.opacity = 1;
            if ("depthWrite" in mm) mm.depthWrite = true;
            // Optional hull glow (see SHIP_HULL_EMISSIVE_BASE). When 0, FBX emissive is left as authored.
            if ("emissive" in mm && gameConfig.SHIP_HULL_EMISSIVE_BASE > 0) {
              mm.emissive.setRGB(0.13, 0.14, 0.17);
              const baseIntensity =
                gameConfig.SHIP_HULL_EMISSIVE_BASE * (0.92 + Math.random() * 0.12);
              mm.emissiveIntensity = baseIntensity;
              this.shipEmissiveMaterials.push({
                material: mm as MeshStandardMaterial,
                baseIntensity,
                phase: Math.random() * Math.PI * 2,
                boostScale: 0.14 + Math.random() * 0.12,
              });
            }
            if (mm.color) {
              mm.color.multiplyScalar(1.1);
            }
            if (
              typeof mm.metalness === "number" &&
              typeof mm.roughness === "number"
            ) {
              mm.metalness = Math.min(0.5, Math.max(0.26, mm.metalness * 0.92));
              mm.roughness = Math.min(0.78, Math.max(0.44, mm.roughness * 1.05));
            }
          }
        });

        if (this.playerObject && this.playerObject !== placeholder) {
          if (this.playerObject.parent) {
            this.playerObject.parent.remove(this.playerObject);
          }
        }

        scene.add(ship);
        this.playerObject = ship;
        // Preserve ship's Y orientation; X/Z tilt will be applied on top.
        this.basePlayerRotation.set(0, ship.rotation.y, 0);
        // Point-sprite thrusters + shield/speed VFX now follow the real mesh (scale/orientation differ from placeholder).
        this.particleSystem.setShipObject(ship);
        this.attachThrusterFlames(ship);

        // Remove the init-time placeholder cube once ship is visible.
        if (placeholder.parent) {
          placeholder.parent.remove(placeholder);
        }
      },
      undefined,
      (err) => {
        console.error("Failed to load spaceship FBX", err);
      },
    );

    const handlePowerupCollected = (payload: { type: string }) => {
      if (payload.type === "speed") {
        this.powerupSystem.applySpeedBoost(5, 2);
        this.particleSystem.onSpeedBoostPickup(5);
      } else if (payload.type === "shield") {
        this.powerupSystem.applyShield(gameConfig.SHIELD_PICKUP_AMOUNT);
        this.particleSystem.onShieldPickup(1.5);
      } else if (payload.type === "energy") {
        this.energyRemaining = Math.min(
          gameConfig.ENERGY_MAX,
          this.energyRemaining + gameConfig.ENERGY_PICKUP_AMOUNT,
        );
      }
    };

    eventBus.on("powerupCollected", handlePowerupCollected);
    (this as any)._handlePowerupCollected = handlePowerupCollected;

    const handleResize = () => {
      if (!this.renderer || !this.camera) return;
      const { clientWidth, clientHeight } = canvas;
      if (clientWidth === 0 || clientHeight === 0) return;
      this.renderer.setSize(clientWidth, clientHeight, false);
      this.camera.aspect = clientWidth / clientHeight;
      this.camera.updateProjectionMatrix();
      this.composer?.setSize(clientWidth, clientHeight);
    };

    window.addEventListener("resize", handleResize);
    // React layout can change canvas size without a window resize
    // (e.g. letterboxing). Keep WebGLRenderer/Cam in sync.
    this.resizeObserver?.disconnect();
    this.resizeObserver = new ResizeObserver(() => handleResize());
    this.resizeObserver.observe(canvas);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "1") {
        this.nebulaQuality = "low";
        this.nebulaClouds?.setQuality("low");
        this.layeredClouds?.setQuality("low");
      } else if (e.key === "2") {
        this.nebulaQuality = "med";
        this.nebulaClouds?.setQuality("med");
        this.layeredClouds?.setQuality("med");
      } else if (e.key === "3") {
        this.nebulaQuality = "high";
        this.nebulaClouds?.setQuality("high");
        this.layeredClouds?.setQuality("high");
      }
      if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
        this.input.left = true;
      }
      if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
        this.input.right = true;
      }
      if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") {
        this.input.up = true;
      }
      if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") {
        this.input.down = true;
      }
      if (e.key === "Shift") {
        this.input.shift = true;
      }
      if (e.key === " " || e.code === "Space") {
        this.input.fire = true;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
        this.input.left = false;
      }
      if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
        this.input.right = false;
      }
      if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") {
        this.input.up = false;
      }
      if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") {
        this.input.down = false;
      }
      if (e.key === "Shift") {
        this.input.shift = false;
      }
      if (e.key === " " || e.code === "Space") {
        this.input.fire = false;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    // Store handlers for cleanup
    (this as any)._handleResize = handleResize;
    (this as any)._handleKeyDown = handleKeyDown;
    (this as any)._handleKeyUp = handleKeyUp;
  }

  private update(delta: number): void {
    this.powerupSystem.update(delta);
    if (this.laserCooldownRemaining > 0) {
      this.laserCooldownRemaining = Math.max(
        0,
        this.laserCooldownRemaining - delta,
      );
    }

    // Flight fuel drains continuously; Shift burns extra while held.
    let e = this.energyRemaining;
    e -= gameConfig.ENERGY_DRAIN_PER_SECOND * delta;
    if ((this.input.shift || this.touchInput.boost) && e > 0) {
      e -= gameConfig.ENERGY_CONSUME_RATE * delta;
    }
    this.energyRemaining = Math.max(0, e);
    if (this.energyRemaining <= 0 && !this.gameOverPending) {
      this.triggerStrandedGameOver();
      return;
    }

    const baseSpeed = this.speedController.getCurrentSpeed();
    let effectiveSpeed = baseSpeed;

    const boostHeld =
      (this.input.shift || this.touchInput.boost) && this.energyRemaining > 0;

    // Shift speed boost only while energy remains (already drained above).
    if (boostHeld) {
      effectiveSpeed = baseSpeed * gameConfig.ENERGY_SPEED_MULTIPLIER;
    }
    this.particleSystem.update(delta, {
      boostActive: boostHeld,
      boostFactor: effectiveSpeed / gameConfig.BASE_SPEED,
    });

    let inputX: number;
    let inputY: number;
    if (this.touchInput.active) {
      inputX = Math.max(-1, Math.min(1, this.touchInput.strafeX));
      inputY = Math.max(-1, Math.min(1, this.touchInput.strafeY));
    } else {
      inputX = this.input.left ? -1 : this.input.right ? 1 : 0;
      inputY = this.input.up ? 1 : this.input.down ? -1 : 0;
    }
    this.movementSystem.inputX = inputX;
    this.movementSystem.inputY = inputY;
    this.movementSystem.update(delta);

    const fireHeld = this.input.fire || this.touchInput.fire;
    if (!this.gameOverPending && fireHeld && this.laserCooldownRemaining <= 0) {
      this.fireLaser();
      this.laserCooldownRemaining = gameConfig.LASER_COOLDOWN;
    }
    this.updateLasers(delta);

    if (this.playerObject) {
      this.playerObject.position.x = this.player.state.x;
      this.playerObject.position.y = this.player.state.y;

      // Visual tilt based on current strafe velocity.
      const vxNorm = Math.max(
        -1,
        Math.min(1, this.player.state.vx / gameConfig.BANK_STRAFE_REF_SPEED),
      );
      const vyNorm = Math.max(
        -1,
        Math.min(1, this.player.state.vy / gameConfig.BANK_STRAFE_REF_SPEED),
      );

      // Bank so moving left visually tilts left, regardless of model's base rotation.
      const targetBankZ = vxNorm * gameConfig.BANK_MAX_RAD;
      const targetPitchX = vyNorm * gameConfig.PITCH_MAX_RAD;

      const t = 1 - Math.exp(-gameConfig.ROTATION_LERP * delta);
      this.playerObject.rotation.z +=
        (this.basePlayerRotation.z + targetBankZ - this.playerObject.rotation.z) *
        t;
      this.playerObject.rotation.x +=
        (this.basePlayerRotation.x + targetPitchX - this.playerObject.rotation.x) *
        t;
    }

    this.time += delta;
    this.distance += effectiveSpeed * delta;

    this.updateSkyboxEulerRotation(delta, effectiveSpeed);
    this.updateSkyboxCycle(delta);
    if (this.skyboxMesh) {
      this.skyboxMesh.rotation.copy(this.skyboxEuler);
    }
    if (this.nebulaClouds && this.camera) {
      this.nebulaClouds.update(delta, this.camera, this.distance);
    }
    if (this.layeredClouds && this.camera) {
      this.layeredClouds.update(
        delta,
        this.camera,
        effectiveSpeed,
        this.distance,
      );
    }
    if (this.worldScrollSystem) {
      this.worldScrollSystem.update(delta, effectiveSpeed);
    }

    if (this.spawnSystem) {
      this.spawnSystem.update(this.distance);
    }

    if (this.collisionSystem) {
      this.collisionSystem.update();
    }

    this.uiAccumulator += delta;

    if (this.uiAccumulator >= gameConfig.UI_UPDATE_INTERVAL) {
      eventBus.emit("update", {
        score: this.distance + this.time * 1.0,
        time: this.time,
        speed: effectiveSpeed,
        energy: this.energyRemaining,
        energyMax: gameConfig.ENERGY_MAX,
        shield: this.powerupSystem.getShield(),
        shieldMax: this.powerupSystem.getShieldMax(),
        hull: this.hullRemaining,
        hullMax: gameConfig.SHIP_HULL_MAX,
      });
      this.uiAccumulator = 0;
    }

    this.applyCameraAndPostFx(delta);
  }

  /** Camera shake, skybox follow, engine glow, thruster mesh flicker, rim/fill lights, post shader uniforms. */
  private applyCameraAndPostFx(delta: number): void {
    if (!this.camera) return;
    const isBoosting =
      (this.input.shift || this.touchInput.boost) &&
      this.energyRemaining > 0;
    // Shared multiplier for engine point light + cone opacity/length (matches "energy boost" feel).
    const boostMul = isBoosting ? 2.2 : 1.0;

    this.screenShake *= Math.pow(0.84, delta * 60);
    if (this.screenShake < 0.002) this.screenShake = 0;

    this.postImpact *= Math.pow(0.82, delta * 60);
    if (this.postImpact < 0.002) this.postImpact = 0;

    const s = this.screenShake;
    const ox = (Math.random() - 0.5) * 0.55 * s;
    const oy = (Math.random() - 0.5) * 0.42 * s;
    const oz = (Math.random() - 0.5) * 0.14 * s;
    this.camera.position.set(
      this.cameraRestPosition.x + ox,
      this.cameraRestPosition.y + oy,
      this.cameraRestPosition.z + oz,
    );

    if (this.skyboxMesh) {
      this.skyboxMesh.position.copy(this.camera.position);
    }

    // Engine glow: follows ship; +Z offset places the light slightly ahead of the mesh origin (glow near stern).
    if (this.engineLight && this.playerObject) {
      const t = this.time;
      // Layered sines → non-repeating "live engine" pulse; always > 0 before jitter.
      const pulse =
        0.74 +
        Math.sin(t * 18.2) * 0.15 +
        Math.sin(t * 37.1) * 0.07 +
        Math.sin(t * 61.3) * Math.sin(t * 12.9) * 0.045;
      // Fast high-frequency shimmer on top of pulse.
      const jitter = (Math.sin(t * 93.7) * 0.5 + 0.5) * 0.065;
      this.engineLight.position.set(
        this.playerObject.position.x,
        this.playerObject.position.y,
        this.playerObject.position.z + 0.64,
      );
      // Brighter and slightly farther reach while Shift-boosting (`boostMul` > 1).
      this.engineLight.intensity = (pulse + jitter) * boostMul;
      this.engineLight.distance = 8 + boostMul * 2.35;
    }
    if (this.rimLight && this.playerObject) {
      this.rimLight.position.set(
        this.playerObject.position.x,
        this.playerObject.position.y + 0.9,
        this.playerObject.position.z - 3.8,
      );
    }

    if (this.cameraFillLight && this.camera) {
      this.cameraFillScratch
        .copy(this.cameraFillOffsetLocal)
        .applyQuaternion(this.camera.quaternion);
      this.cameraFillLight.position
        .copy(this.camera.position)
        .add(this.cameraFillScratch);
    }
    // Mesh thrusters: animate scale (mostly along local Z after cone rotation) and opacity so the plume "breathes".
    if (this.thrusterFlameCore && this.thrusterFlameOuter) {
      const t = this.time;
      // Independent flicker curves for core vs outer so the halo does not stay locked to the core.
      const flickerA = 0.9 + 0.1 * Math.sin(t * 26.1) + 0.06 * Math.sin(t * 58.3);
      const flickerB = 0.84 + 0.14 * Math.sin(t * 19.7 + 0.7);
      // When `boostMul` is 2.2, this pushes length/opacity upward without changing the idle baseline much.
      const boostScale = 1 + (boostMul - 1) * 0.62;
      const c = this.thrusterFlameScaleComp;
      const outerMul = 1.06;
      // Cones were scaled uniformly at attach; here we stretch **Z** (cone axis after X rotation) for flame length.
      this.thrusterFlameCore.scale.set(
        c,
        c,
        c * flickerA * boostScale,
      );
      this.thrusterFlameOuter.scale.set(
        c * outerMul,
        c * outerMul,
        c * outerMul * flickerB * (1 + (boostMul - 1) * 0.8),
      );
      (this.thrusterFlameCore.material as MeshBasicMaterial).opacity =
        0.56 + 0.18 * flickerA * boostScale;
      (this.thrusterFlameOuter.material as MeshBasicMaterial).opacity =
        0.2 + 0.14 * flickerB * boostScale;
    }
    this.updateShipEmissiveFlow(delta, boostMul);

    const u = this.impactPostPass?.uniforms as
      | {
          rgbAmount: { value: number };
          vignetteAmount: { value: number };
        }
      | undefined;
    if (u) {
      u.rgbAmount.value = 0.0014 + this.postImpact * 0.032;
      u.vignetteAmount.value = 0.14 + this.postImpact * 0.62;
    }
  }

  private addScreenShake(amount: number): void {
    this.screenShake = Math.min(1, this.screenShake + amount);
  }

  private addPostImpact(amount: number): void {
    this.postImpact = Math.min(1, this.postImpact + amount);
  }

  private playLaserSound(): void {
    if (!this.laserSoundTemplate) return;
    const shot = this.laserSoundTemplate.cloneNode(true) as HTMLAudioElement;
    shot.volume = this.laserSoundTemplate.volume;
    void shot.play().catch(() => {});
  }

  private playExplosionAsteroidSound(): void {
    if (!this.explosionAsteroidSound) return;
    const s = this.explosionAsteroidSound.cloneNode(true) as HTMLAudioElement;
    s.volume = this.explosionAsteroidSound.volume;
    void s.play().catch(() => {});
  }

  private playExplosionShipSound(): void {
    if (!this.explosionShipSound) return;
    const s = this.explosionShipSound.cloneNode(true) as HTMLAudioElement;
    s.volume = this.explosionShipSound.volume;
    void s.play().catch(() => {});
  }

  private updateShipEmissiveFlow(delta: number, boostMul: number): void {
    if (this.shipEmissiveMaterials.length === 0) return;
    this.shipEmissiveFlow += delta;
    const t = this.shipEmissiveFlow;
    const boostAmount = Math.max(0, boostMul - 1);
    for (const entry of this.shipEmissiveMaterials) {
      const wave = 0.5 + 0.5 * Math.sin(t * 2.8 + entry.phase);
      const flow = wave * wave * 0.065;
      entry.material.emissiveIntensity =
        entry.baseIntensity + flow + boostAmount * entry.boostScale;
    }
  }

  /**
   * Push the ship away from the rock (2D), stacked on top of strafe in MovementSystem.
   * Vector is capped so repeated hits stay bounded.
   */
  private applyCollisionImpulse(obstacle: Object3D): void {
    const { x, y } = this.player.state;
    const ax = obstacle.position.x;
    const ay = obstacle.position.y;
    let dx = x - ax;
    let dy = y - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-6) {
      dx = 1;
      dy = 0;
    } else {
      const inv = 1 / Math.sqrt(lenSq);
      dx *= inv;
      dy *= inv;
    }
    const s = gameConfig.COLLISION_IMPULSE_STRENGTH;
    let ix = this.player.state.impulseX + dx * s;
    let iy = this.player.state.impulseY + dy * s;
    const max = gameConfig.COLLISION_IMPULSE_MAX_SPEED;
    const m = Math.hypot(ix, iy);
    if (m > max) {
      const k = max / m;
      ix *= k;
      iy *= k;
    }
    this.player.state.impulseX = ix;
    this.player.state.impulseY = iy;
  }

  private fireLaser(): void {
    if (!this.scene) return;
    this.playLaserSound();
    const laser = new Mesh(this.laserGeometry, this.laserMaterial);
    laser.position.set(this.player.state.x, this.player.state.y, 0);
    this.scene.add(laser);
    this.lasers.push(laser);
  }

  /** Green sphere pickup; energy only spawns from destroyed asteroids (not random spawns). */
  private spawnEnergyPickupAt(x: number, y: number, z: number): void {
    if (!this.scene || !this.collisionSystem || !this.worldScrollSystem) return;
    const mesh = new Mesh(
      new SphereGeometry(0.6, 16, 16),
      new MeshBasicMaterial({ color: 0x44ff88 }),
    );
    mesh.position.set(x, y, z);
    (mesh as any).userData = {
      powerupType: "energy",
      spawnType: "powerup-energy",
    };
    this.scene.add(mesh);
    this.worldScrollSystem.addDynamicObject(mesh);
    this.collisionSystem.registerPowerup(mesh);
  }

  private damageAsteroid(target: Object3D): void {
    const userData = (target as any).userData || {};
    const hp = typeof userData.hp === "number" ? userData.hp : 1;
    userData.hp = hp - gameConfig.LASER_DAMAGE;
    (target as any).userData = userData;

    if (userData.hp <= 0) {
      const { x, y, z } = target.position;
      this.playExplosionAsteroidSound();
      this.particleSystem.spawnAsteroidExplosion(target.position);
      eventBus.emit("asteroidDestroyed");
      this.addPostImpact(0.44);
      this.addScreenShake(0.06);
      this.collisionSystem.removeObject(target);
      this.worldScrollSystem?.removeDynamicObject(target);
      if (target.parent) {
        target.parent.remove(target);
      }
      eventBus.emit("collectibleCollected", { value: 50 });
      if (Math.random() < gameConfig.ASTEROID_ENERGY_DROP_CHANCE) {
        this.spawnEnergyPickupAt(x, y, z);
      }
    }
  }

  /** Out of fuel: no explosion; UI shows game over (stranded). */
  private triggerStrandedGameOver(): void {
    if (this.gameOverPending) return;
    this.gameOverPending = true;
    this.energyRemaining = 0;
    eventBus.emit("gameOver", {
      score: this.distance + this.time * 1.0,
      time: this.time,
      reason: "stranded",
    });
  }

  private updateLasers(delta: number): void {
    const asteroidTargets =
      this.worldScrollSystem
        ?.getDynamicObjects()
        .filter((obj) => ((obj as any).userData?.spawnType as string) === "obstacle") ?? [];

    for (let i = this.lasers.length - 1; i >= 0; i--) {
      const laser = this.lasers[i];
      laser.position.z -= gameConfig.LASER_SPEED * delta;

      let hit = false;
      for (const asteroid of asteroidTargets) {
        if (!asteroid.parent) continue;
        const dx = asteroid.position.x - laser.position.x;
        const dy = asteroid.position.y - laser.position.y;
        const hitRadius =
          (((asteroid as any).userData?.colliderHalfSize?.x as number) ??
            gameConfig.ASTEROID_HIT_RADIUS) + gameConfig.LASER_RADIUS;
        if (dx * dx + dy * dy > hitRadius * hitRadius) continue;
        if (Math.abs(asteroid.position.z - laser.position.z) > 1.25) continue;

        this.damageAsteroid(asteroid);
        hit = true;
        break;
      }

      if (hit || laser.position.z < gameConfig.LASER_MAX_TRAVEL_Z) {
        if (laser.parent) laser.parent.remove(laser);
        this.lasers.splice(i, 1);
      }
    }
  }

  private loop = () => {
    if (!this.running || !this.renderer || !this.scene || !this.camera) {
      return;
    }

    const delta = this.clock.getDelta();
    this.update(delta);

    if (this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
    this.animationFrameId = window.requestAnimationFrame(this.loop);
  };

  start(): void {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    this.animationFrameId = window.requestAnimationFrame(this.loop);
  }

  stop(): void {
    this.running = false;
    if (this.animationFrameId !== null) {
      window.cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  reset(): void {
    if (this.gameOverTimeoutId !== null) {
      window.clearTimeout(this.gameOverTimeoutId);
      this.gameOverTimeoutId = null;
    }
    this.gameOverPending = false;
    this.screenShake = 0;
    this.postImpact = 0;
    if (this.camera) {
      this.camera.position.copy(this.cameraRestPosition);
    }
    const u = this.impactPostPass?.uniforms as
      | {
          rgbAmount: { value: number };
          vignetteAmount: { value: number };
        }
      | undefined;
    if (u) {
      u.rgbAmount.value = 0.0014;
      u.vignetteAmount.value = 0.14;
    }
    this.distance = 0;
    this.time = 0;
    this.uiAccumulator = 0;
    this.energyRemaining = gameConfig.ENERGY_MAX;
    this.hullRemaining = gameConfig.SHIP_HULL_MAX;
    this.input.left = false;
    this.input.right = false;
    this.input.up = false;
    this.input.down = false;
    this.input.shift = false;
    this.input.fire = false;
    this.touchInput = {
      active: false,
      strafeX: 0,
      strafeY: 0,
      boost: false,
      fire: false,
    };
    this.laserCooldownRemaining = 0;
    this.lasers.forEach((laser) => {
      if (laser.parent) laser.parent.remove(laser);
    });
    this.lasers = [];
    this.player.state.x = 0;
    this.player.state.y = 0;
    this.player.state.vx = 0;
    this.player.state.vy = 0;
    this.player.state.impulseX = 0;
    this.player.state.impulseY = 0;
    if (this.playerObject) {
      this.playerObject.position.set(0, 0, 0);
      this.playerObject.visible = true;
    }

    if (this.scene) {
      this.skyboxEuler.set(0, 0, 0);
      this.applyRandomSkybox(this.scene);
      this.resetSkyboxCycle();
    }

    if (this.worldScrollSystem) {
      this.worldScrollSystem.reset();
    }
    if (this.spawnSystem) {
      this.spawnSystem.reset();
    }
    if (this.collisionSystem) {
      this.collisionSystem.reset();
    }
    this.powerupSystem.reset();
    this.particleSystem.reset();

    // Reposition clouds so the next run feels fresh.
    if (this.camera) {
      this.layeredClouds?.reset(this.camera);
    }
  }

  dispose(): void {
    this.stop();
    if (this.gameOverTimeoutId !== null) {
      window.clearTimeout(this.gameOverTimeoutId);
      this.gameOverTimeoutId = null;
    }
    this.lasers.forEach((laser) => {
      if (laser.parent) laser.parent.remove(laser);
    });
    this.lasers = [];

    const resizeHandler = (this as any)._handleResize as
      | (() => void)
      | undefined;
    const keyDownHandler = (this as any)._handleKeyDown as
      | ((e: KeyboardEvent) => void)
      | undefined;
    const keyUpHandler = (this as any)._handleKeyUp as
      | ((e: KeyboardEvent) => void)
      | undefined;
    const powerupHandler = (this as any)._handlePowerupCollected as
      | ((payload: { type: string }) => void)
      | undefined;
    if (resizeHandler) {
      window.removeEventListener("resize", resizeHandler);
    }
    if (keyDownHandler) {
      window.removeEventListener("keydown", keyDownHandler);
    }
    if (keyUpHandler) {
      window.removeEventListener("keyup", keyUpHandler);
    }

    if (powerupHandler) {
      eventBus.off("powerupCollected", powerupHandler);
    }

    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    this.disposeSkyboxMesh();

    if (this.composer) {
      this.composer.dispose();
      this.composer = null;
    }
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }
    this.laserGeometry.dispose();
    this.laserMaterial.dispose();
    if (this.laserSoundTemplate) {
      this.laserSoundTemplate.pause();
      this.laserSoundTemplate.src = "";
      this.laserSoundTemplate = null;
    }
    if (this.explosionAsteroidSound) {
      this.explosionAsteroidSound.pause();
      this.explosionAsteroidSound.src = "";
      this.explosionAsteroidSound = null;
    }
    if (this.explosionShipSound) {
      this.explosionShipSound.pause();
      this.explosionShipSound.src = "";
      this.explosionShipSound = null;
    }
    if (this.impactPostPass) {
      this.impactPostPass.dispose();
      this.impactPostPass = null;
    }
    this.engineLight = null;
    this.rimLight = null;
    this.cameraFillLight = null;
    this.detachThrusterFlames(true);
    this.shipEmissiveMaterials = [];
    this.scene = null;
    this.camera = null;
    this.playerObject = null;

    this.powerupSystem.reset();
    this.nebulaClouds?.dispose();
    this.nebulaClouds = null;
    this.layeredClouds?.dispose();
    this.layeredClouds = null;
    this.particleSystem.dispose();
  }
}

