import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { CrystalAcousticsEngine } from './acoustics';
import { buildArena, type BuiltArena } from './arenas';
import { disposeEnemy, shatterEnemyArmor, spawnEnemy, updateEnemyVisuals } from './enemies';
import { createMaterialLibrary, type MaterialLibrary } from './materials';
import { SpectralBeamPool, type BeamHitEnemy } from './optics';
import {
  ARENA_LAYERS,
  WAVELENGTHS,
  type ArenaLayerId,
  type EnemyEntity,
  type EngineUiBridge,
  type FloorCrystalShard,
  type OpticalMirror,
  type WavelengthBand,
} from './types';
import { createFirstPersonRig, type FirstPersonRig } from './weapons';

// Module-scope scratch math helpers (Zero GC in render loop)
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _moveDir = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _camDir = new THREE.Vector3();
const _muzzlePos = new THREE.Vector3();
const _toTarget = new THREE.Vector3();
const _arrowTarget = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

const VisorChromaticShader = {
  uniforms: {
    tDiffuse: { value: null },
    uAberration: { value: 0.0012 },
    uSlowMo: { value: 0.0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uAberration;
    uniform float uSlowMo;
    varying vec2 vUv;
    void main() {
      vec2 dir = vUv - 0.5;
      float dist = length(dir);
      float amt = uAberration * (0.4 + dist * 2.4) + uSlowMo * 0.0035 * dist;
      float r = texture2D(tDiffuse, vUv - dir * amt).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv + dir * amt).b;
      vec3 col = vec3(r, g, b);
      // Subtle specular slow-motion cool crystalline tint
      col = mix(col, col * vec3(0.88, 0.96, 1.14), uSlowMo * 0.35);
      // Very gentle peripheral optical vignette
      float vig = smoothstep(0.95, 0.38, dist);
      col *= mix(0.76, 1.0, vig);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

interface LightArrow {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  colorHex: number;
  life: number;
}

interface ShadowProjectile {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
}

interface BurstParticle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
}

export class PhotonicEngine {
  private container: HTMLElement;
  private onUiUpdate: (snapshot: EngineUiBridge) => void;

  private isSoftwareGl: boolean;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private visorPass: ShaderPass | null = null;

  private mats: MaterialLibrary;
  private acoustics = new CrystalAcousticsEngine();
  private weapons: FirstPersonRig;
  private beamPool: SpectralBeamPool;
  private currentArena: BuiltArena | null = null;

  private enemies: EnemyEntity[] = [];
  private floorShards: FloorCrystalShard[] = [];
  private lightArrows: LightArrow[] = [];
  private shadowProjectiles: ShadowProjectile[] = [];
  private burstParticles: BurstParticle[] = [];

  // Shared debris geometries
  private shardGeo = new THREE.OctahedronGeometry(0.18, 0);
  private arrowGeo = new THREE.ConeGeometry(0.08, 0.72, 6);
  private shadowOrbGeo = new THREE.IcosahedronGeometry(0.32, 0);

  // Player Kinematics & Optical Gear State
  private playerPos = new THREE.Vector3(0, 1.75, 18);
  private playerVel = new THREE.Vector3();
  private yaw = 0;
  private pitch = -0.05;
  private grounded = true;
  private mouseSensitivity = 0.0022;

  private wavelength: WavelengthBand = 'visible';
  private photonEnergy = 1.0; // 0..1 drives Aperture Gauntlet brass iris blades
  private visorIntegrity = 1.0; // 0..1 drives Visor cracks & Chromatic Aberration
  private combo = 0;
  private comboDecayTimer = 0;

  // Combat & Specular Dash state
  private slashTimer = 0;
  private slashCooldown = 0;
  private slashComboStep = 0;
  private beamActive = false;
  private recoil = 0;

  private dashActive = false;
  private dashTimer = 0;
  private dashOrigin = new THREE.Vector3();
  private dashTarget = new THREE.Vector3();
  private dashReflectedDir = new THREE.Vector3();
  private slowMoTimer = 0;
  private arrowVolleyTimer = 0;

  // Layer & Wave Progression
  private currentLayer: ArenaLayerId = 1;
  private waveIndex = 1;
  private totalWaves = 2;
  private gameState: EngineUiBridge['gameState'] = 'title';
  private waveClearDelay = 0;

  // Input state
  private keys = new Set<string>();
  private pointerLocked = false;
  private isDraggingLook = false;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private beamHitsBuffer: BeamHitEnemy[] = [];

  // Loop & Lifecycle
  private frameId = 0;
  private disposed = false;
  private lastTime = performance.now();
  private elapsed = 0;
  private lastUiSync = 0;
  private keyLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private starField: THREE.Points;

  constructor(container: HTMLElement, onUiUpdate: (snapshot: EngineUiBridge) => void) {
    this.container = container;
    this.onUiUpdate = onUiUpdate;

    // Software WebGL probe per Three.js skill §2.1
    this.isSoftwareGl = (() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      72,
      (container.clientWidth || window.innerWidth) / (container.clientHeight || window.innerHeight),
      0.08,
      260
    );
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    // Mandatory Studio Environment Reflection (RoomEnvironment) on ALL devices
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    // 3-Point Warm/Cool Observatory Lighting Rig
    this.hemiLight = new THREE.HemisphereLight(0x88b4ff, 0x261d14, 0.72);
    this.scene.add(this.hemiLight);

    this.keyLight = new THREE.DirectionalLight(0xfff1d6, 2.1);
    this.keyLight.position.set(22, 38, 18);
    if (!this.isSoftwareGl) {
      this.keyLight.castShadow = true;
      this.keyLight.shadow.mapSize.set(1024, 1024);
      const d = 34;
      this.keyLight.shadow.camera.left = -d;
      this.keyLight.shadow.camera.right = d;
      this.keyLight.shadow.camera.top = d;
      this.keyLight.shadow.camera.bottom = -d;
      this.keyLight.shadow.bias = -0.0005;
      this.keyLight.shadow.normalBias = 0.02;
    }
    this.scene.add(this.keyLight);

    const rimLight = new THREE.DirectionalLight(0x52c8ff, 0.9);
    rimLight.position.set(-24, 18, -26);
    this.scene.add(rimLight);

    // Celestial Observatory Star Dome
    this.starField = this.buildStarField();
    this.scene.add(this.starField);

    // Material Library, Weapons, and Optical Ray Solver
    this.mats = createMaterialLibrary(this.renderer, this.isSoftwareGl);
    this.weapons = createFirstPersonRig(this.mats, this.isSoftwareGl);
    this.camera.add(this.weapons.root);
    this.beamPool = new SpectralBeamPool(this.scene, 80);

    // Post-Processing on GPU (Bloom + Visor Chromatic Aberration)
    if (!this.isSoftwareGl) {
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.48, 0.45, 0.82);
      this.composer.addPass(this.bloomPass);
      this.visorPass = new ShaderPass(VisorChromaticShader);
      this.composer.addPass(this.visorPass);
    }

    // Load Katman 1
    this.loadLayer(1, false);

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.bindEvents();
    this.syncUi(true);
    this.tick();
  }

  private buildStarField(): THREE.Points {
    const count = 900;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 0.85 + 0.1);
      const r = 115 + Math.random() * 45;
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

      const tint = Math.random();
      colors[i * 3] = tint > 0.6 ? 1.0 : 0.72;
      colors[i * 3 + 1] = tint > 0.3 ? 0.92 : 0.82;
      colors[i * 3 + 2] = 1.0;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.65,
      vertexColors: true,
      transparent: true,
      opacity: 0.82,
    });
    return new THREE.Points(geo, mat);
  }

  public startGame(): void {
    this.acoustics.unlock();
    this.gameState = 'playing';
    this.visorIntegrity = 1.0;
    this.photonEnergy = 1.0;
    this.requestPointerLockSafe();
    this.syncUi(true);
  }

  public resumeGame(): void {
    this.acoustics.unlock();
    this.gameState = 'playing';
    this.requestPointerLockSafe();
    this.syncUi(true);
  }

  public pauseGame(): void {
    this.gameState = 'paused';
    this.beamActive = false;
    if (document.pointerLockElement) {
      document.exitPointerLock?.();
    }
    this.syncUi(true);
  }

  public restartCurrentLayer(): void {
    this.acoustics.unlock();
    this.loadLayer(this.currentLayer, true);
    this.gameState = 'playing';
    this.requestPointerLockSafe();
    this.syncUi(true);
  }

  public selectLayer(layerId: ArenaLayerId): void {
    this.acoustics.unlock();
    this.loadLayer(layerId, true);
    this.gameState = 'playing';
    this.requestPointerLockSafe();
    this.syncUi(true);
  }

  public setWavelength(band: WavelengthBand): void {
    if (this.wavelength === band) return;
    this.wavelength = band;
    this.acoustics.playWavelengthShift(WAVELENGTHS[band].pitchRatio);
    this.syncUi(true);
  }

  public toggleMute(): boolean {
    const next = !this.acoustics.isMuted();
    this.acoustics.setMuted(next);
    return next;
  }

  public setSensitivity(val: number): void {
    this.mouseSensitivity = THREE.MathUtils.clamp(val, 0.0008, 0.005);
  }

  private requestPointerLockSafe(): void {
    try {
      this.renderer.domElement.requestPointerLock?.();
    } catch {
      // Fallback drag/keyboard look remains active
    }
  }

  private clearDynamicEntities(): void {
    for (const e of this.enemies) disposeEnemy(e, this.scene);
    this.enemies = [];

    for (const s of this.floorShards) {
      this.scene.remove(s.mesh);
      (s.mesh.material as THREE.Material).dispose();
    }
    this.floorShards = [];

    for (const a of this.lightArrows) {
      this.scene.remove(a.mesh);
      (a.mesh.material as THREE.Material).dispose();
    }
    this.lightArrows = [];

    for (const p of this.shadowProjectiles) {
      this.scene.remove(p.mesh);
      (p.mesh.material as THREE.Material).dispose();
    }
    this.shadowProjectiles = [];

    for (const b of this.burstParticles) {
      this.scene.remove(b.mesh);
      (b.mesh.material as THREE.Material).dispose();
    }
    this.burstParticles = [];
  }

  private loadLayer(layerId: ArenaLayerId, spawnWaveImmediately: boolean): void {
    this.clearDynamicEntities();

    if (this.currentArena) {
      this.scene.remove(this.currentArena.group);
      this.currentArena.dispose();
    }

    this.currentLayer = layerId;
    const info = ARENA_LAYERS.find((l) => l.id === layerId)!;
    this.scene.background = new THREE.Color(info.skyColor);
    this.scene.fog = new THREE.FogExp2(info.fogColor, info.fogDensity);

    // Adjust chiaroscuro lighting for Camera Obscura Bastion (Layer 4) vs Observatory Layers
    this.keyLight.intensity = layerId === 4 ? 0.85 : 2.1;
    this.hemiLight.intensity = layerId === 4 ? 0.34 : 0.72;

    this.currentArena = buildArena(layerId, this.mats);
    this.scene.add(this.currentArena.group);

    // Reset player spawn safely on solid ground
    if (layerId === 3) {
      this.playerPos.set(0, 1.75, 7.5);
    } else if (layerId === 5) {
      this.playerPos.set(0, 1.75, 28);
    } else {
      this.playerPos.set(0, 1.75, 19);
    }
    this.playerVel.set(0, 0, 0);
    this.yaw = 0;
    this.pitch = -0.04;
    this.visorIntegrity = 1.0;
    this.photonEnergy = 1.0;
    this.combo = 0;
    this.dashActive = false;
    this.slowMoTimer = 0;

    this.waveIndex = 1;
    this.totalWaves = layerId === 5 ? 2 : 2;
    if (spawnWaveImmediately || this.gameState === 'title') {
      this.spawnWave(layerId, 1);
    }
  }

  private spawnWave(layerId: ArenaLayerId, wave: number): void {
    const baseCount = wave === 1 ? 3 : 4;
    if (layerId === 5 && wave === 2) {
      // Epic Final Boss: The Umbra Leviathan + 2 Sentinels
      this.enemies.push(
        spawnEnemy('boss_leviathan', 'leviathan', new THREE.Vector3(0, 4.8, -12), this.mats, this.scene)
      );
      this.enemies.push(
        spawnEnemy('boss_guard_1', 'sentinel', new THREE.Vector3(-18, 2.4, -14), this.mats, this.scene),
        spawnEnemy('boss_guard_2', 'sentinel', new THREE.Vector3(18, 2.4, -14), this.mats, this.scene)
      );
      return;
    }

    for (let i = 0; i < baseCount; i++) {
      const a = (i / baseCount) * Math.PI * 2 + wave * 0.5;
      const dist = layerId === 3 ? 21 : 18 + (i % 2) * 5;
      const pos = new THREE.Vector3(Math.cos(a) * dist, 2.2, Math.sin(a) * dist);
      const kind = wave === 2 && i % 2 === 0 ? 'sentinel' : 'stalker';
      this.enemies.push(spawnEnemy(`e_${layerId}_${wave}_${i}`, kind, pos, this.mats, this.scene));
    }
  }

  // =========================================================================
  // COMBAT ACTIONS: PRISM SABRE, APERTURE LASER, SPECULAR DASH, TURRET CRANK
  // =========================================================================
  private triggerSabreSlash(): void {
    if (this.gameState !== 'playing' || this.slashCooldown > 0) return;

    this.slashTimer = 0.28;
    this.slashCooldown = 0.3;
    this.slashComboStep = (this.slashComboStep + 1) % 3;
    const spec = WAVELENGTHS[this.wavelength];
    this.acoustics.playSabreSlash(this.slashComboStep, spec.pitchRatio);

    this.camera.getWorldPosition(_camPos);
    this.camera.getWorldDirection(_camDir);

    // 1. Check Enemy Melee Hits (cleaving dark-matter armor!)
    const meleeRange = 4.6;
    for (const e of this.enemies) {
      if (e.dead) continue;
      _toTarget.subVectors(e.position, _camPos);
      const dist = _toTarget.length();
      if (dist <= meleeRange + e.radius) {
        _toTarget.normalize();
        if (_toTarget.dot(_camDir) > 0.32) {
          this.hitEnemyWithSabre(e);
        }
      }
    }

    // 2. Check Shatterable Quartz Prisms
    if (this.currentArena) {
      for (const prism of this.currentArena.prisms) {
        if (prism.shattered) continue;
        _toTarget.subVectors(prism.position, _camPos);
        _toTarget.y = 0;
        if (_toTarget.length() <= meleeRange + prism.radius) {
          prism.hp -= 25;
          this.acoustics.playArmorCrack(spec.pitchRatio);
          this.spawnBurst(prism.position.clone().add(new THREE.Vector3(0, 2.0, 0)), spec.colorHex, 8);
          if (prism.hp <= 0) {
            this.shatterPrismColumn(prism);
          }
        }
      }

      // 3. Striking a rotatable mirror in Camera Obscura also cranks it!
      for (const m of this.currentArena.mirrors) {
        if (!m.rotatable || !m.yokeGroup) continue;
        if (_camPos.distanceTo(m.position) <= 5.0) {
          m.yokeGroup.rotation.y += Math.PI / 6;
          this.acoustics.playBrassGearTick();
        }
      }
    }
  }

  private hitEnemyWithSabre(e: EnemyEntity): void {
    const spec = WAVELENGTHS[this.wavelength];
    e.heatColor.setHex(spec.colorHex);
    e.heat = Math.min(1.0, e.heat + 0.55 * spec.thermalRate);
    e.stunTimer = 0.25;

    // Knockback away from player
    _toTarget.subVectors(e.position, this.playerPos).setY(0).normalize();
    e.velocity.addScaledVector(_toTarget, 7.5);

    if (!e.crystalExposed) {
      e.armorHp -= 28 * spec.thermalRate;
      this.acoustics.playArmorCrack(spec.pitchRatio);
      this.spawnBurst(e.position, spec.colorHex, 10);
      if (e.armorHp <= 0) {
        shatterEnemyArmor(e);
        this.spawnFloorShards(e.position, 7, 0x2a3142);
        this.photonEnergy = Math.min(1.0, this.photonEnergy + 0.28);
        this.registerCombo();
      }
    } else {
      // Exposed crystal core takes direct sabre damage too
      e.coreHp -= 18;
      this.spawnBurst(e.position, 0xffe699, 8);
      if (e.coreHp <= 0) {
        this.detonateEnemy(e);
      }
    }
  }

  private shatterPrismColumn(prism: {
    mesh: THREE.Group;
    position: THREE.Vector3;
    shattered: boolean;
  }): void {
    prism.shattered = true;
    prism.mesh.visible = false;
    this.acoustics.playCrystalShatter();
    this.spawnFloorShards(prism.position.clone().add(new THREE.Vector3(0, 1.8, 0)), 16, 0xa8efff);
    this.photonEnergy = Math.min(1.0, this.photonEnergy + 0.35);
    this.registerCombo();
  }

  private spawnFloorShards(origin: THREE.Vector3, count: number, colorHex: number): void {
    for (let i = 0; i < count; i++) {
      if (this.floorShards.length >= 48) {
        const old = this.floorShards.shift()!;
        this.scene.remove(old.mesh);
        (old.mesh.material as THREE.Material).dispose();
      }
      const mat = new THREE.MeshPhysicalMaterial({
        color: colorHex,
        emissive: new THREE.Color(colorHex),
        emissiveIntensity: 0.35,
        roughness: 0.08,
        metalness: 0.1,
        clearcoat: 1.0,
      });
      const mesh = new THREE.Mesh(this.shardGeo, mat);
      mesh.position.copy(origin);
      mesh.scale.setScalar(0.75 + Math.random() * 0.9);
      this.scene.add(mesh);

      const angle = Math.random() * Math.PI * 2;
      const spd = 2.5 + Math.random() * 5.5;
      this.floorShards.push({
        mesh,
        position: mesh.position,
        velocity: new THREE.Vector3(Math.cos(angle) * spd, 3.5 + Math.random() * 4.5, Math.sin(angle) * spd),
        rotVel: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        life: 14,
        wavelengthHex: colorHex,
        settled: false,
      });
    }
  }

  private spawnBurst(origin: THREE.Vector3, colorHex: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(this.shardGeo, mat);
      mesh.position.copy(origin);
      mesh.scale.setScalar(0.45 + Math.random() * 0.55);
      this.scene.add(mesh);
      this.burstParticles.push({
        mesh,
        vel: new THREE.Vector3(
          (Math.random() - 0.5) * 14,
          (Math.random() - 0.2) * 12,
          (Math.random() - 0.5) * 14
        ),
        life: 0.45 + Math.random() * 0.35,
      });
    }
  }

  private detonateEnemy(e: EnemyEntity): void {
    if (e.dead) return;
    e.dead = true;
    e.group.visible = false;
    this.registerCombo();
    this.photonEnergy = Math.min(1.0, this.photonEnergy + 0.4);
    this.acoustics.playOpticalDetonation(this.combo);
    this.spawnBurst(e.position, WAVELENGTHS[this.wavelength].colorHex, 18);
    this.spawnFloorShards(e.position, 8, 0xffe49e);
  }

  private registerCombo(): void {
    this.combo = Math.min(16, this.combo + 1);
    this.comboDecayTimer = 4.5;
  }

  private findTargetedMirror(): OpticalMirror | null {
    if (!this.currentArena) return null;
    this.camera.getWorldPosition(_camPos);
    this.camera.getWorldDirection(_camDir);

    let best: OpticalMirror | null = null;
    let bestScore = 0.72;
    for (const m of this.currentArena.mirrors) {
      _toTarget.subVectors(m.position, _camPos);
      const dist = _toTarget.length();
      if (dist < 3.5 || dist > 45) continue;
      _toTarget.divideScalar(dist);
      const dot = _toTarget.dot(_camDir);
      if (dot > bestScore) {
        bestScore = dot;
        best = m;
      }
    }
    return best;
  }

  private triggerSpecularDash(): void {
    if (this.gameState !== 'playing' || this.dashActive || this.photonEnergy < 0.18) return;

    const mirror = this.findTargetedMirror();
    this.camera.getWorldDirection(_camDir);

    this.acoustics.playSpecularDash();
    this.photonEnergy = Math.max(0.05, this.photonEnergy - 0.22);

    if (mirror) {
      // Law of Reflection Dash toward Mirror, then ricochet along exact reflected angle!
      this.dashActive = true;
      this.dashTimer = 0.26;
      this.dashOrigin.copy(this.playerPos);
      this.dashTarget.copy(mirror.position).addScaledVector(mirror.normal, 2.2);
      this.dashTarget.y = Math.max(2.6, this.dashTarget.y);

      const dotDN = _camDir.dot(mirror.normal);
      this.dashReflectedDir.copy(_camDir).addScaledVector(mirror.normal, -2 * dotDN).normalize();
      mirror.highlightFactor = 1.0;

      // Trigger Millisecond Slow-Motion & Aerial Spectral Arrow Rain!
      this.slowMoTimer = 1.05;
      this.arrowVolleyTimer = 0.05;
    } else {
      // Short lateral photonic blink along movement or aim vector
      _moveDir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).negate();
      this.playerVel.addScaledVector(_moveDir, 22);
      this.playerVel.y = Math.max(this.playerVel.y, 6.2);
      this.slowMoTimer = 0.55;
      this.arrowVolleyTimer = 0.05;
    }
  }

  private fireSpectralArrow(): void {
    const alive = this.enemies.filter((e) => !e.dead);
    if (alive.length === 0) return;
    const target = alive[Math.floor(Math.random() * alive.length)];

    const spec = WAVELENGTHS[this.wavelength];
    const mat = new THREE.MeshBasicMaterial({
      color: spec.colorHex,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(this.arrowGeo, mat);
    mesh.position.copy(this.playerPos).add(new THREE.Vector3((Math.random() - 0.5) * 1.4, 0.2, (Math.random() - 0.5) * 1.4));

    _arrowTarget.subVectors(target.position, mesh.position).normalize();
    mesh.quaternion.setFromUnitVectors(_up, _arrowTarget);
    this.scene.add(mesh);

    this.lightArrows.push({
      mesh,
      pos: mesh.position,
      vel: _arrowTarget.clone().multiplyScalar(38),
      colorHex: spec.colorHex,
      life: 1.4,
    });
    this.acoustics.playCrystalHarmonic(1318 * spec.pitchRatio, 0.25, 0.05);
  }

  private interactNearbyMirror(): void {
    if (!this.currentArena) return;
    for (const m of this.currentArena.mirrors) {
      if (!m.rotatable || !m.yokeGroup) continue;
      if (this.playerPos.distanceTo(m.position) < 6.2) {
        m.yokeGroup.rotation.y += Math.PI / 6;
        m.highlightFactor = 1.0;
        this.acoustics.playBrassGearTick();
        break;
      }
    }
  }

  // =========================================================================
  // MAIN SIMULATION LOOP (Time-scaled for Specular Slow-Motion & Software WebGL safe)
  // =========================================================================
  private tick = (): void => {
    if (this.disposed) return;

    const now = performance.now();
    const rawDt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;

    // Millisecond slow-motion dilation during Specular Dash
    const timeScale = this.slowMoTimer > 0 ? 0.26 : 1.0;
    const worldDt = rawDt * timeScale;
    this.elapsed += worldDt;

    if (this.gameState === 'playing') {
      this.stepGameplay(rawDt, worldDt);
    } else {
      // Gentle cinematic idle rotation on Title / Pause
      if (this.currentArena) {
        this.currentArena.update(rawDt * 0.4, this.elapsed, this.playerPos);
      }
      this.camera.position.copy(this.playerPos);
      this.camera.rotation.set(this.pitch, this.yaw + Math.sin(now * 0.00025) * 0.08, 0);
      this.weapons.update({
        dt: rawDt,
        elapsed: now * 0.001,
        moveSpeedRatio: 0,
        wavelength: this.wavelength,
        photonEnergy: this.photonEnergy,
        beamActive: false,
        slashTimer: 0,
        slashComboStep: 0,
        comboCount: this.combo,
        visorDamage: 1 - this.visorIntegrity,
        recoil: 0,
      });
    }

    // Render via GPU EffectComposer or direct Software-WebGL Renderer
    if (this.composer && !this.isSoftwareGl) {
      if (this.visorPass) {
        this.visorPass.uniforms.uAberration.value = 0.0008 + (1 - this.visorIntegrity) * 0.011;
        this.visorPass.uniforms.uSlowMo.value = this.slowMoTimer > 0 ? 1.0 : 0.0;
      }
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }

    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) return;
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private stepGameplay(rawDt: number, worldDt: number): void {
    // 1. Timers & Decay
    this.slashTimer = Math.max(0, this.slashTimer - rawDt);
    this.slashCooldown = Math.max(0, this.slashCooldown - rawDt);
    this.recoil = Math.max(0, this.recoil - rawDt * 4);
    this.slowMoTimer = Math.max(0, this.slowMoTimer - rawDt);

    if (this.combo > 0) {
      this.comboDecayTimer -= rawDt;
      if (this.comboDecayTimer <= 0) this.combo = 0;
    }

    // Visor self-mends very gently if out of danger
    this.visorIntegrity = Math.min(1.0, this.visorIntegrity + rawDt * 0.025);

    // 2. Keyboard Turning Fallback (Q/E or Left/Right Arrows)
    if (this.keys.has('KeyQ') || this.keys.has('ArrowLeft')) this.yaw += 2.1 * rawDt;
    if (this.keys.has('KeyE') || this.keys.has('ArrowRight')) this.yaw -= 2.1 * rawDt;
    if (this.keys.has('ArrowUp')) this.pitch = Math.min(1.2, this.pitch + 1.5 * rawDt);
    if (this.keys.has('ArrowDown')) this.pitch = Math.max(-1.2, this.pitch - 1.5 * rawDt);

    // 3. Player Kinematics (Specular Dash OR Ground/Aerial Locomotion)
    if (this.dashActive) {
      this.dashTimer -= rawDt;
      const t = 1 - Math.max(0, this.dashTimer / 0.26);
      this.playerPos.lerpVectors(this.dashOrigin, this.dashTarget, t);
      if (this.dashTimer <= 0) {
        this.dashActive = false;
        this.playerVel.copy(this.dashReflectedDir).multiplyScalar(19);
        this.playerVel.y = Math.max(this.playerVel.y, 7.5);
        this.grounded = false;
      }
    } else {
      // Standard WASD movement relative to camera yaw
      const fwd = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
      const str = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);

      _forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      _right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      _moveDir.set(0, 0, 0).addScaledVector(_forward, fwd).addScaledVector(_right, str);
      if (_moveDir.lengthSq() > 0) _moveDir.normalize();

      const maxSpeed = this.currentLayer === 3 ? 15.5 : 13.5;
      const accel = this.grounded ? 14 : 6;
      this.playerVel.x = THREE.MathUtils.damp(this.playerVel.x, _moveDir.x * maxSpeed, accel, rawDt);
      this.playerVel.z = THREE.MathUtils.damp(this.playerVel.z, _moveDir.z * maxSpeed, accel, rawDt);

      // Gravity & Layer 2 Violet Gravity-Inversion Updrafts
      let gravity = -24.0;
      if (this.currentArena) {
        for (const u of this.currentArena.updrafts) {
          const dx = this.playerPos.x - u.position.x;
          const dz = this.playerPos.z - u.position.z;
          if (dx * dx + dz * dz <= u.radius * u.radius && this.playerPos.y < u.height) {
            gravity = 19.5; // Anti-gravity updraft!
            this.grounded = false;
          }
        }
      }

      this.playerVel.y += gravity * rawDt;
      this.playerPos.addScaledVector(this.playerVel, rawDt);

      // Arena Floor & Platform Grounding
      const floorY = this.currentArena
        ? this.currentArena.getFloorHeightAt(this.playerPos.x, this.playerPos.z, this.playerPos.y - 1.75)
        : 0;

      if (floorY !== null && this.playerPos.y - 1.75 <= floorY && this.playerVel.y <= 0) {
        this.playerPos.y = floorY + 1.75;
        this.playerVel.y = 0;
        this.grounded = true;
      } else if (floorY === null && this.playerPos.y < -12) {
        // Void pit / Singularity diaphragm recovery warp back to safe rim
        this.damagePlayer(0.25);
        this.playerPos.set(0, 3.0, this.currentLayer === 5 ? 27 : 21);
        this.playerVel.set(0, 0, 0);
      }

      // Clamp to outer arena parapet
      const maxR = (this.currentArena?.arenaRadius ?? 38) - 1.2;
      const horizSq = this.playerPos.x * this.playerPos.x + this.playerPos.z * this.playerPos.z;
      if (horizSq > maxR * maxR) {
        const inv = maxR / Math.sqrt(horizSq);
        this.playerPos.x *= inv;
        this.playerPos.z *= inv;
      }
    }

    // Slow-Motion Aerial Spectral Light Arrow Rain
    if (this.slowMoTimer > 0) {
      this.arrowVolleyTimer -= rawDt;
      if (this.arrowVolleyTimer <= 0) {
        this.arrowVolleyTimer = 0.16;
        this.fireSpectralArrow();
      }
    }

    // Update Camera Transform + Subtle Dynamic FOV on Specular Dash
    this.camera.position.copy(this.playerPos);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    const targetFov = this.dashActive || this.slowMoTimer > 0 ? 84 : 72;
    if (Math.abs(this.camera.fov - targetFov) > 0.1) {
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 10, rawDt);
      this.camera.updateProjectionMatrix();
    }

    // 4. Update Arena & Optical Beams
    if (this.currentArena) {
      this.currentArena.update(worldDt, this.elapsed, this.playerPos);

      // Parabolic Hotspot Hazard Check (Layer 1)
      for (const hs of this.currentArena.hotspots) {
        if (this.playerPos.distanceTo(hs.position) < hs.radius + 0.6) {
          this.damagePlayer(rawDt * 0.45);
        }
        for (const e of this.enemies) {
          if (!e.dead && e.position.distanceTo(hs.position) < hs.radius + e.radius) {
            e.heat = 1.0;
            shatterEnemyArmor(e);
            e.coreHp -= 45 * worldDt;
            if (e.coreHp <= 0) this.detonateEnemy(e);
          }
        }
      }
    }

    this.beamPool.beginFrame();

    // Trace Environmental Observatory Light Rays (Mirrors & Prisms)
    if (this.currentArena) {
      this.beamHitsBuffer.length = 0;
      for (const ray of this.currentArena.envLightRays) {
        this.beamPool.traceSpectralRay({
          start: ray.origin,
          direction: ray.dir,
          colorHex: ray.colorHex,
          radius: ray.radius,
          maxBounces: ray.maxBounces,
          maxDistance: 55,
          mirrors: this.currentArena.mirrors,
          prisms: this.currentArena.prisms,
          enemies: this.currentLayer === 4 ? this.enemies : undefined,
          floorShards: this.floorShards,
          hitsOut: this.currentLayer === 4 ? this.beamHitsBuffer : undefined,
        });
      }

      // Camera Obscura reflected sunlight beams incinerate Shadow Stalkers!
      for (const hit of this.beamHitsBuffer) {
        if (hit.bounced) {
          hit.enemy.heat = Math.min(1.0, hit.enemy.heat + worldDt * 2.0);
          shatterEnemyArmor(hit.enemy);
          hit.enemy.coreHp -= 55 * worldDt;
          if (hit.enemy.coreHp <= 0) this.detonateEnemy(hit.enemy);
        }
      }
    }

    // Trace Player Aperture Gauntlet Focused Beam
    const canFireBeam = this.beamActive && this.photonEnergy > 0.04;
    if (canFireBeam && this.currentArena) {
      this.photonEnergy = Math.max(0, this.photonEnergy - rawDt * 0.28);
      this.recoil = 0.5;
      this.weapons.getApertureMuzzleWorldPos(_muzzlePos);
      this.camera.getWorldDirection(_camDir);

      this.beamHitsBuffer.length = 0;
      const spec = WAVELENGTHS[this.wavelength];
      this.beamPool.traceSpectralRay({
        start: _muzzlePos,
        direction: _camDir,
        colorHex: spec.colorHex,
        radius: 0.085,
        maxBounces: 3,
        maxDistance: 65,
        mirrors: this.currentArena.mirrors,
        prisms: this.currentArena.prisms,
        enemies: this.enemies,
        floorShards: this.floorShards,
        hitsOut: this.beamHitsBuffer,
      });

      for (const hit of this.beamHitsBuffer) {
        const e = hit.enemy;
        const bounceMult = hit.bounced ? 2.1 : 1.0;
        e.heatColor.setHex(spec.colorHex);
        e.heat = Math.min(1.0, e.heat + rawDt * 1.1 * spec.thermalRate);

        if (e.crystalExposed) {
          // Resonant Optical Detonation Focus!
          e.coreHp -= 68 * bounceMult * rawDt;
          if (e.coreHp <= 0) {
            this.detonateEnemy(e);
          }
        } else {
          // Thermal stress gradually melts dark armor
          e.armorHp -= 24 * spec.thermalRate * bounceMult * rawDt;
          if (e.armorHp <= 0) {
            shatterEnemyArmor(e);
            this.acoustics.playArmorCrack(spec.pitchRatio);
          }
        }
      }
    } else {
      this.photonEnergy = Math.min(1.0, this.photonEnergy + rawDt * 0.22);
    }

    this.beamPool.endFrame();

    // 5. Update Enemies & Projectiles
    this.stepEnemies(worldDt);
    this.stepProjectilesAndDebris(rawDt, worldDt);

    // 6. Update Weapons Rig & Crystal Acoustics
    const horizSpeed = Math.hypot(this.playerVel.x, this.playerVel.z);
    this.weapons.update({
      dt: rawDt,
      elapsed: this.elapsed,
      moveSpeedRatio: this.grounded ? Math.min(1, horizSpeed / 12) : 0,
      wavelength: this.wavelength,
      photonEnergy: this.photonEnergy,
      beamActive: canFireBeam,
      slashTimer: this.slashTimer,
      slashComboStep: this.slashComboStep,
      comboCount: this.combo,
      visorDamage: 1 - this.visorIntegrity,
      recoil: this.recoil,
    });

    this.acoustics.updateContinuous(
      this.combo,
      canFireBeam,
      WAVELENGTHS[this.wavelength].pitchRatio
    );

    // 7. Wave / Layer Progression Check
    const aliveCount = this.enemies.reduce((acc, e) => acc + (e.dead ? 0 : 1), 0);
    if (aliveCount === 0) {
      this.waveClearDelay += rawDt;
      if (this.waveClearDelay > 1.35) {
        this.waveClearDelay = 0;
        if (this.waveIndex < this.totalWaves) {
          this.waveIndex++;
          this.spawnWave(this.currentLayer, this.waveIndex);
          this.acoustics.playCrystalHarmonic(880, 1.1, 0.16);
        } else if (this.currentLayer < 5) {
          this.loadLayer((this.currentLayer + 1) as ArenaLayerId, true);
          this.acoustics.playOpticalDetonation(8);
        } else {
          this.gameState = 'victory';
          if (document.pointerLockElement) document.exitPointerLock?.();
          this.syncUi(true);
        }
      }
    }

    // Periodic lightweight UI bridge sync (for crosshair mirror lock & layer badge)
    if (this.elapsed - this.lastUiSync > 0.1) {
      this.lastUiSync = this.elapsed;
      this.syncUi(false);
    }
  }

  private stepEnemies(dt: number): void {
    for (const e of this.enemies) {
      if (e.dead) continue;

      updateEnemyVisuals(e, dt, this.elapsed);

      if (e.stunTimer > 0) {
        e.stunTimer -= dt;
      } else {
        // Hover & circle/approach player
        _toTarget.subVectors(this.playerPos, e.position);
        const dist = _toTarget.length();
        const desiredDist = e.kind === 'leviathan' ? 14 : e.kind === 'sentinel' ? 10 : 4.2;

        if (dist > 0.01) {
          _toTarget.y = 0;
          _toTarget.normalize();
          const approach = dist > desiredDist ? 1 : -0.4;
          const strafeSign = e.kind === 'leviathan' ? 1 : (e.phase > 3 ? 1 : -1);
          const speed = e.kind === 'leviathan' ? 4.5 : e.kind === 'sentinel' ? 4.8 : 6.4;

          e.velocity.x = THREE.MathUtils.damp(
            e.velocity.x,
            (_toTarget.x * approach - _toTarget.z * 0.55 * strafeSign) * speed,
            4,
            dt
          );
          e.velocity.z = THREE.MathUtils.damp(
            e.velocity.z,
            (_toTarget.z * approach + _toTarget.x * 0.55 * strafeSign) * speed,
            4,
            dt
          );
        }

        // Attack logic
        e.attackTimer -= dt;
        if (e.attackTimer <= 0) {
          e.attackTimer = e.kind === 'leviathan' ? 1.55 : 2.6 + Math.random() * 1.1;
          if (dist < 34) {
            this.fireShadowOrb(e);
          }
        }
      }

      e.position.addScaledVector(e.velocity, dt);
      const targetHoverY = (e.kind === 'leviathan' ? 4.5 : 2.15) + Math.sin(this.elapsed * 2.4 + e.phase) * 0.45;
      e.position.y = THREE.MathUtils.damp(e.position.y, targetHoverY, 4, dt);

      // Keep within arena bounds
      const maxR = (this.currentArena?.arenaRadius ?? 36) - 2.5;
      const rSq = e.position.x * e.position.x + e.position.z * e.position.z;
      if (rSq > maxR * maxR) {
        const inv = maxR / Math.sqrt(rSq);
        e.position.x *= inv;
        e.position.z *= inv;
      }

      // Close melee contact damage
      if (e.position.distanceTo(this.playerPos) < e.radius + 1.05 && !this.dashActive) {
        this.damagePlayer(0.22 * dt);
      }
    }
  }

  private fireShadowOrb(e: EnemyEntity): void {
    const mat = new THREE.MeshBasicMaterial({ color: 0xa64dff });
    const mesh = new THREE.Mesh(this.shadowOrbGeo, mat);
    mesh.position.copy(e.position);
    this.scene.add(mesh);

    const speed = e.kind === 'leviathan' ? 18 : 13.5;
    const vel = new THREE.Vector3().subVectors(this.playerPos, e.position).normalize().multiplyScalar(speed);
    this.shadowProjectiles.push({ mesh, pos: mesh.position, vel, life: 3.5 });
  }

  private stepProjectilesAndDebris(rawDt: number, worldDt: number): void {
    // Spectral Light Arrows
    for (let i = this.lightArrows.length - 1; i >= 0; i--) {
      const a = this.lightArrows[i];
      a.life -= rawDt;
      a.pos.addScaledVector(a.vel, rawDt);

      let remove = a.life <= 0;
      for (const e of this.enemies) {
        if (e.dead) continue;
        if (a.pos.distanceTo(e.position) <= e.radius + 0.65) {
          e.armorHp -= 22;
          if (e.armorHp <= 0) shatterEnemyArmor(e);
          if (e.crystalExposed) {
            e.coreHp -= 26;
            if (e.coreHp <= 0) this.detonateEnemy(e);
          }
          this.spawnBurst(a.pos, a.colorHex, 6);
          remove = true;
          break;
        }
      }

      if (remove) {
        this.scene.remove(a.mesh);
        (a.mesh.material as THREE.Material).dispose();
        this.lightArrows.splice(i, 1);
      }
    }

    // Shadow Malware Projectiles
    for (let i = this.shadowProjectiles.length - 1; i >= 0; i--) {
      const p = this.shadowProjectiles[i];
      p.life -= worldDt;
      p.pos.addScaledVector(p.vel, worldDt);

      let remove = p.life <= 0;
      if (!this.dashActive && p.pos.distanceTo(this.playerPos) < 1.15) {
        this.damagePlayer(0.18);
        remove = true;
      }

      if (remove) {
        this.scene.remove(p.mesh);
        (p.mesh.material as THREE.Material).dispose();
        this.shadowProjectiles.splice(i, 1);
      }
    }

    // Floor Crystal Shards
    for (let i = this.floorShards.length - 1; i >= 0; i--) {
      const s = this.floorShards[i];
      s.life -= rawDt;
      if (!s.settled) {
        s.velocity.y -= 18 * rawDt;
        s.position.addScaledVector(s.velocity, rawDt);
        s.mesh.rotation.x += s.rotVel.x * rawDt;
        s.mesh.rotation.y += s.rotVel.y * rawDt;
        if (s.position.y <= 0.16) {
          s.position.y = 0.16;
          s.velocity.set(0, 0, 0);
          s.settled = true;
        }
      }
      if (s.life <= 0) {
        this.scene.remove(s.mesh);
        (s.mesh.material as THREE.Material).dispose();
        this.floorShards.splice(i, 1);
      }
    }

    // Burst Particles
    for (let i = this.burstParticles.length - 1; i >= 0; i--) {
      const b = this.burstParticles[i];
      b.life -= rawDt;
      b.mesh.position.addScaledVector(b.vel, rawDt);
      b.vel.multiplyScalar(0.94);
      b.mesh.scale.multiplyScalar(0.95);
      if (b.life <= 0) {
        this.scene.remove(b.mesh);
        (b.mesh.material as THREE.Material).dispose();
        this.burstParticles.splice(i, 1);
      }
    }
  }

  private damagePlayer(amount: number): void {
    this.visorIntegrity = Math.max(0, this.visorIntegrity - amount);
    if (amount > 0.05) {
      this.acoustics.playVisorHit();
    }
    if (this.visorIntegrity <= 0.01 && this.gameState === 'playing') {
      this.gameState = 'defeated';
      this.beamActive = false;
      if (document.pointerLockElement) document.exitPointerLock?.();
      this.syncUi(true);
    }
  }

  private syncUi(force: boolean): void {
    const mirror = this.findTargetedMirror();
    let nearInteractable: string | null = null;
    if (this.currentArena) {
      for (const m of this.currentArena.mirrors) {
        if (m.rotatable && this.playerPos.distanceTo(m.position) < 6.2) {
          nearInteractable = '[T] Pirinç Aynayı Çevir';
          break;
        }
      }
    }

    let exposedTargetLocked = false;
    this.camera.getWorldDirection(_camDir);
    for (const e of this.enemies) {
      if (e.dead || !e.crystalExposed) continue;
      _toTarget.subVectors(e.position, this.camera.position).normalize();
      if (_toTarget.dot(_camDir) > 0.94) {
        exposedTargetLocked = true;
        break;
      }
    }

    if (force || this.gameState === 'playing') {
      this.onUiUpdate({
        layer: this.currentLayer,
        gameState: this.gameState,
        pointerLocked: this.pointerLocked,
        combo: this.combo,
        waveIndex: this.waveIndex,
        totalWaves: this.totalWaves,
        nearInteractable,
        dashReadyMirror: mirror !== null,
        exposedTargetLocked,
        wavelength: this.wavelength,
      });
    }
  }

  // =========================================================================
  // INPUT & WINDOW EVENTS
  // =========================================================================
  private onResize = (): void => {
    if (this.disposed) return;
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    if (this.composer) {
      this.composer.setSize(w, h);
    }
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    this.keys.add(e.code);
    if (e.code === 'Space' && this.grounded && this.gameState === 'playing') {
      this.playerVel.y = 10.5;
      this.grounded = false;
    }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      this.triggerSpecularDash();
    }
    if (e.code === 'Digit1') this.setWavelength('infrared');
    if (e.code === 'Digit2') this.setWavelength('visible');
    if (e.code === 'Digit3') this.setWavelength('ultraviolet');
    if (e.code === 'KeyF') this.triggerSabreSlash();
    if (e.code === 'KeyG') this.beamActive = true;
    if (e.code === 'KeyT') this.interactNearbyMirror();
    if (e.code === 'KeyP') {
      if (this.gameState === 'playing') this.pauseGame();
      else if (this.gameState === 'paused') this.resumeGame();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
    if (e.code === 'KeyG') this.beamActive = false;
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (this.gameState !== 'playing') return;
    this.acoustics.unlock();

    if (!this.pointerLocked && e.target === this.renderer.domElement) {
      this.requestPointerLockSafe();
      this.isDraggingLook = true;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
    }

    if (e.button === 0) {
      this.triggerSabreSlash();
    } else if (e.button === 2) {
      this.beamActive = true;
    }
  };

  private onMouseUp = (e: MouseEvent): void => {
    this.isDraggingLook = false;
    if (e.button === 2) {
      this.beamActive = false;
    }
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (this.gameState !== 'playing') return;
    if (this.pointerLocked) {
      this.yaw -= e.movementX * this.mouseSensitivity;
      this.pitch = THREE.MathUtils.clamp(
        this.pitch - e.movementY * this.mouseSensitivity,
        -1.35,
        1.35
      );
    } else if (this.isDraggingLook) {
      const dx = e.clientX - this.lastPointerX;
      const dy = e.clientY - this.lastPointerY;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
      this.yaw -= dx * this.mouseSensitivity * 1.4;
      this.pitch = THREE.MathUtils.clamp(
        this.pitch - dy * this.mouseSensitivity * 1.4,
        -1.35,
        1.35
      );
    }
  };

  private onWheel = (e: WheelEvent): void => {
    if (this.gameState !== 'playing') return;
    const order: WavelengthBand[] = ['infrared', 'visible', 'ultraviolet'];
    const idx = order.indexOf(this.wavelength);
    const next = order[(idx + (e.deltaY > 0 ? 1 : 2)) % order.length];
    this.setWavelength(next);
  };

  private onPointerLockChange = (): void => {
    this.pointerLocked = document.pointerLockElement === this.renderer.domElement;
    this.syncUi(true);
  };

  private onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
  };

  private bindEvents(): void {
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.renderer.domElement.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    this.renderer.domElement.addEventListener('wheel', this.onWheel, { passive: true });
    this.renderer.domElement.addEventListener('contextmenu', this.onContextMenu);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);

    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.renderer.domElement.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    this.renderer.domElement.removeEventListener('wheel', this.onWheel);
    this.renderer.domElement.removeEventListener('contextmenu', this.onContextMenu);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);

    this.clearDynamicEntities();
    if (this.currentArena) {
      this.currentArena.dispose();
    }
    this.weapons.dispose();
    this.beamPool.dispose();
    this.mats.dispose();
    this.acoustics.dispose();
    this.shardGeo.dispose();
    this.arrowGeo.dispose();
    this.shadowOrbGeo.dispose();
    this.starField.geometry.dispose();
    (this.starField.material as THREE.Material).dispose();
    this.composer?.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
