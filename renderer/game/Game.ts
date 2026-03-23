import {
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
} from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
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

/* 
BASE_SPEED is the base speed of the world
UI_UPDATE_INTERVAL is the interval at which the UI is updated
BANK_MAX_RAD is the maximum bank angle of the player when strafing
PITCH_MAX_RAD is the maximum pitch angle of the player when strafing
ROTATION_LERP is the lerp factor for the player's rotation when strafing
ENERGY_MAX is the maximum energy of the player
ENERGY_CONSUME_RATE is the rate at which the player's energy decreases
ENERGY_SPEED_MULTIPLIER is the multiplier for the player's speed when holding Shift
ENERGY_PICKUP_AMOUNT is the amount of energy gained when picking up a powerup
*/

const GAME_CONFIG = {
  // Game constants
  BASE_SPEED: 20,
  UI_UPDATE_INTERVAL: 0.1, // 10 Hz
  BANK_MAX_RAD: 1.0, // 0.6 = ~34deg, 0.8 = ~45deg, 1.0 = ~51deg
  PITCH_MAX_RAD: 0.6, // 0.4 = ~23deg, 0.6 = ~34deg, 0.8 = ~45deg
  ROTATION_LERP: 10, // higher = snappier

  // TODO: Ship Health
  SHIP_HEALTH: 100,

  // TODO: Ship Shield
  SHIP_SHIELD: 100,
  SHIP_SHIELD_REGEN_RATE: 10, // shield regen per second
  SHIP_SHIELD_REGEN_DELAY: 1.0, // delay before shield regen starts
  SHIP_SHIELD_REGEN_INTERVAL: 1.0, // interval between shield regen
  SHIP_SHIELD_REGEN_AMOUNT: 10, // amount of shield regen per interval

  // Energy Boost (Shift)
  ENERGY_MAX: 100,
  ENERGY_CONSUME_RATE: 15, // energy per second while holding Shift
  ENERGY_SPEED_MULTIPLIER: 1.8,
  ENERGY_PICKUP_AMOUNT: 45,

  // Bloom tuning: avoid over-blobbing bright pixels (skybox + powerups + particles)
  BLOOM_STRENGTH: 1.0, // 0.0 = no bloom, 1.0 = full bloom
  BLOOM_RADIUS: 0.55, // 0.0 = no radius, 1.0 = full radius
  BLOOM_THRESHOLD: 0.38, // higher = fewer pixels contribute to bloom
};

export class Game {
  private renderer: WebGLRenderer | null = null;
  private scene: Scene | null = null;
  private camera: PerspectiveCamera | null = null;
  private animationFrameId: number | null = null;
  private running = false;
  private resizeObserver: ResizeObserver | null = null;
  private playerObject: Object3D | null = null;
  private clock = new Clock();
  private speedController = new SpeedController(GAME_CONFIG.BASE_SPEED);
  private powerupSystem = new PowerupSystem(this.speedController);
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
  private composer: EffectComposer | null = null;
  private particleSystem!: ParticleSystem;
  private nebulaClouds: NebulaClouds | null = null;
  private nebulaQuality: NebulaQuality = "med";
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
  };

  private energyRemaining = GAME_CONFIG.ENERGY_MAX;

  private applyRandomSkybox(scene: Scene): void {
    if (this.skyboxNames.length === 0) return;
    const choice = this.skyboxNames[this.skyboxIndex % this.skyboxNames.length];
    this.skyboxIndex++;
    const base = `/skyboxes/${choice}/`;

    // Randomize skybox rotation for this run.
    this.skyboxRotXDir = Math.random() < 0.5 ? -1 : 1;
    // Small variations around the existing feel.
    this.skyboxRotXBaseSpeed = 0.08 + Math.random() * 0.05; // ~0.08..0.13

    this.skyboxRotZDir = Math.random() < 0.5 ? -1 : 1;
    this.skyboxRotZBaseSpeed = 0.03 + Math.random() * 0.05; // ~0.03..0.08
    this.skyboxRotZActive = Math.random() < 0.6; // sometimes off
    this.skyboxRotZToggleInterval = 3.5 + Math.random() * 4.5; // ~3.5..8.0s
    this.skyboxRotZToggleAcc = 0;

    if (this.skyboxMesh) {
      // Reset rotation when swapping skybox geometry/material.
      this.skyboxMesh.rotation.set(0, 0, 0);
    }

    if (this.skyboxMesh && this.skyboxMesh.parent) {
      this.skyboxMesh.parent.remove(this.skyboxMesh);
    }

    const loader = new TextureLoader();
    const geometry = new BoxGeometry(500, 500, 500);
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
        }),
    );

    const skybox = new Mesh(geometry, materials);
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
    this.particleSystem = new ParticleSystem(scene);
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
      GAME_CONFIG.BLOOM_STRENGTH,
      GAME_CONFIG.BLOOM_RADIUS,
      GAME_CONFIG.BLOOM_THRESHOLD,
    );
    composer.addPass(bloomPass);
    this.composer = composer;

    const hemi = new HemisphereLight(0xffffff, 0x222233, 1.0);
    scene.add(hemi);
    const dir = new DirectionalLight(0xffffff, 1.0);
    dir.position.set(5, 10, 5);
    scene.add(dir);

    // Temporary placeholder until FBX loads
    const placeholder = new Mesh(
      new BoxGeometry(1, 1, 1),
      new MeshStandardMaterial({ color: 0x00ffcc }),
    );
    scene.add(placeholder);
    this.basePlayerRotation.copy(placeholder.rotation);

    this.worldScrollSystem = new WorldScrollSystem([], 15);

    this.collisionSystem = new CollisionSystem(this.player, () =>
      this.powerupSystem.isShieldActive(),
    );

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

        if (this.playerObject && this.playerObject !== placeholder) {
          if (this.playerObject.parent) {
            this.playerObject.parent.remove(this.playerObject);
          }
        }

        scene.add(ship);
        this.playerObject = ship;
        // Preserve ship's Y orientation; X/Z tilt will be applied on top.
        this.basePlayerRotation.set(0, ship.rotation.y, 0);
        this.particleSystem.setShipObject(ship);

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
        this.powerupSystem.applyShield(10);
        this.particleSystem.onShieldPickup(10);
      } else if (payload.type === "energy") {
        this.energyRemaining = Math.min(
          GAME_CONFIG.ENERGY_MAX,
          this.energyRemaining + GAME_CONFIG.ENERGY_PICKUP_AMOUNT,
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
    this.particleSystem.update(delta);
    const baseSpeed = this.speedController.getCurrentSpeed();
    let effectiveSpeed = baseSpeed;

    // Shift energy boost: consumes energy while held and non-empty.
    if (this.input.shift && this.energyRemaining > 0) {
      this.energyRemaining = Math.max(
        0,
        this.energyRemaining - GAME_CONFIG.ENERGY_CONSUME_RATE * delta,
      );
      effectiveSpeed = baseSpeed * GAME_CONFIG.ENERGY_SPEED_MULTIPLIER;
    }
    this.movementSystem.inputX = this.input.left
      ? -1
      : this.input.right
        ? 1
        : 0;
    this.movementSystem.inputY = this.input.up
      ? 1
      : this.input.down
        ? -1
        : 0;
    this.movementSystem.update(delta);

    if (this.playerObject) {
      this.playerObject.position.x = this.player.state.x;
      this.playerObject.position.y = this.player.state.y;

      // Visual tilt based on current strafe velocity.
      const vxNorm = Math.max(-1, Math.min(1, this.player.state.vx / 25));
      const vyNorm = Math.max(-1, Math.min(1, this.player.state.vy / 25));

      // Bank so moving left visually tilts left, regardless of model's base rotation.
      const targetBankZ = vxNorm * GAME_CONFIG.BANK_MAX_RAD;
      const targetPitchX = vyNorm * GAME_CONFIG.PITCH_MAX_RAD;

      const t = 1 - Math.exp(-GAME_CONFIG.ROTATION_LERP * delta);
      this.playerObject.rotation.z +=
        (this.basePlayerRotation.z + targetBankZ - this.playerObject.rotation.z) *
        t;
      this.playerObject.rotation.x +=
        (this.basePlayerRotation.x + targetPitchX - this.playerObject.rotation.x) *
        t;
    }

    if (this.skyboxMesh) {
      // Keep skybox centered on camera to avoid parallax (no visible cube corner).
      if (this.camera) {
        this.skyboxMesh.position.copy(this.camera.position);
      }

      const factor = effectiveSpeed / GAME_CONFIG.BASE_SPEED;

      // X rotation: always active, but randomized direction/speed per run.
      const rotX = this.skyboxRotXBaseSpeed * this.skyboxRotXDir * factor * delta;
      this.skyboxMesh.rotation.x += rotX;

      // Z rotation: sometimes active, and direction can flip over time.
      this.skyboxRotZToggleAcc += delta;
      if (this.skyboxRotZToggleAcc >= this.skyboxRotZToggleInterval) {
        this.skyboxRotZToggleAcc = 0;
        this.skyboxRotZActive = Math.random() < 0.6; // sometimes off
        this.skyboxRotZDir = Math.random() < 0.5 ? -1 : 1;
        this.skyboxRotZToggleInterval = 3.5 + Math.random() * 4.5;
      }

      if (this.skyboxRotZActive) {
        const rotZ =
          this.skyboxRotZBaseSpeed * this.skyboxRotZDir * factor * delta;
        this.skyboxMesh.rotation.z += rotZ;
      }
    }

    this.time += delta;
    this.distance += effectiveSpeed * delta;
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

    if (this.uiAccumulator >= GAME_CONFIG.UI_UPDATE_INTERVAL) {
      eventBus.emit("update", {
        score: this.distance + this.time * 1.0,
        time: this.time,
        speed: effectiveSpeed,
        energy: this.energyRemaining,
        energyMax: GAME_CONFIG.ENERGY_MAX,
      });
      this.uiAccumulator = 0;
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
    this.distance = 0;
    this.time = 0;
    this.uiAccumulator = 0;
    this.energyRemaining = GAME_CONFIG.ENERGY_MAX;
    this.input.shift = false;
    this.player.state.x = 0;
    this.player.state.y = 0;
    this.player.state.vx = 0;
    this.player.state.vy = 0;
    if (this.playerObject) {
      this.playerObject.position.set(0, 0, 0);
    }

    if (this.scene) {
      this.applyRandomSkybox(this.scene);
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

    if (this.composer) {
      this.composer.dispose();
      this.composer = null;
    }
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }
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

