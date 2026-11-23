import * as THREE from 'three';
import type { MaterialLibrary } from './materials';
import type {
  ArenaLayerId,
  DiaphragmFloorBlade,
  FocalHotspot,
  GravityUpdraft,
  HardLightBridge,
  LiquidTubePath,
  OpticalMirror,
  OpticalPrism,
  RotatingPlatform,
} from './types';

export interface BuiltArena {
  layerId: ArenaLayerId;
  group: THREE.Group;
  mirrors: OpticalMirror[];
  prisms: OpticalPrism[];
  bridges: HardLightBridge[];
  updrafts: GravityUpdraft[];
  hotspots: FocalHotspot[];
  liquidTubes: LiquidTubePath[];
  rotatingPlatforms: RotatingPlatform[];
  diaphragmBlades: DiaphragmFloorBlade[];
  /** Environmental sky/shutter light emitters to trace each frame */
  envLightRays: Array<{
    origin: THREE.Vector3;
    dir: THREE.Vector3;
    colorHex: number;
    radius: number;
    maxBounces: number;
  }>;
  arenaRadius: number;
  hasVoidPit: boolean;
  diaphragmOpening: number; // 0..1 for Katman 5
  update: (dt: number, elapsed: number, playerPos: THREE.Vector3) => void;
  getFloorHeightAt: (x: number, z: number, playerY: number) => number | null;
  dispose: () => void;
}

/**
 * Helper: Creates a handcrafted 6-part Brass Bounce Mirror on an articulated observatory pedestal.
 */
function createBounceMirror(
  id: string,
  pos: THREE.Vector3,
  yaw: number,
  pitch: number,
  radius: number,
  mats: MaterialLibrary,
  rotatable: boolean,
  disposables: Array<{ dispose: () => void }>
): OpticalMirror {
  const baseGroup = new THREE.Group();
  baseGroup.position.copy(pos);

  // 1. Grounded Octagonal Pedestal Base
  const pedGeo = new THREE.CylinderGeometry(0.95, 1.25, 0.7, 8);
  const ped = new THREE.Mesh(pedGeo, mats.obsidianStone);
  ped.position.y = 0.35;
  ped.castShadow = true;
  ped.receiveShadow = true;
  baseGroup.add(ped);
  disposables.push(pedGeo);

  // 2. Brass Calibration Turntable Ring
  const turnGeo = new THREE.CylinderGeometry(0.88, 0.94, 0.22, 16);
  const turn = new THREE.Mesh(turnGeo, mats.brass);
  turn.position.y = 0.81;
  baseGroup.add(turn);
  disposables.push(turnGeo);

  // 3. Articulated U-Yoke (Rotatable around Y)
  const yokeGroup = new THREE.Group();
  yokeGroup.position.y = 1.0;
  yokeGroup.rotation.y = yaw;
  baseGroup.add(yokeGroup);

  const armGeo = new THREE.BoxGeometry(0.22, radius * 1.15 + 0.5, 0.28);
  const leftArm = new THREE.Mesh(armGeo, mats.darkBrass);
  leftArm.position.set(-(radius + 0.22), (radius * 1.15 + 0.5) * 0.5, 0);
  const rightArm = new THREE.Mesh(armGeo, mats.darkBrass);
  rightArm.position.set(radius + 0.22, (radius * 1.15 + 0.5) * 0.5, 0);
  yokeGroup.add(leftArm, rightArm);
  disposables.push(armGeo);

  // 4. Mirror Backing Housing & Beveled Brass Frame
  const tiltGroup = new THREE.Group();
  tiltGroup.position.y = radius + 0.45;
  tiltGroup.rotation.x = pitch;
  yokeGroup.add(tiltGroup);

  const rimGeo = new THREE.TorusGeometry(radius, 0.14, 12, 32);
  const rim = new THREE.Mesh(rimGeo, mats.brass);
  tiltGroup.add(rim);
  disposables.push(rimGeo);

  const backGeo = new THREE.CylinderGeometry(radius, radius * 0.86, 0.24, 24);
  const back = new THREE.Mesh(backGeo, mats.titanium);
  back.rotation.x = Math.PI / 2;
  back.position.z = -0.14;
  tiltGroup.add(back);
  disposables.push(backGeo);

  // 5. Silvered Optical Mirror Surface
  const surfGeo = new THREE.CircleGeometry(radius - 0.04, 32);
  const surfMat = mats.silverMirror.clone();
  const surfaceMesh = new THREE.Mesh(surfGeo, surfMat);
  surfaceMesh.position.z = 0.02;
  tiltGroup.add(surfaceMesh);
  disposables.push(surfGeo, surfMat);

  // 6. Specular Alignment Halo Ring (subtle glow when targeted)
  const haloGeo = new THREE.TorusGeometry(radius + 0.24, 0.035, 8, 32);
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0xf6d488,
    transparent: true,
    opacity: 0.22,
  });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  tiltGroup.add(halo);
  disposables.push(haloGeo, haloMat);

  const worldPos = new THREE.Vector3();
  const worldNorm = new THREE.Vector3();
  baseGroup.updateMatrixWorld(true);
  surfaceMesh.getWorldPosition(worldPos);
  surfaceMesh.getWorldDirection(worldNorm);

  return {
    id,
    mesh: baseGroup,
    surfaceMesh,
    position: worldPos,
    normal: worldNorm,
    radius,
    rotatable,
    yawAngle: yaw,
    baseGroup,
    yokeGroup,
    highlightFactor: 0,
  };
}

/**
 * Helper: Creates a sculpted Hexagonal Quartz Crystal Column with Brass Base & Crown Caps.
 */
function createQuartzPrismColumn(
  id: string,
  pos: THREE.Vector3,
  radius: number,
  height: number,
  mats: MaterialLibrary,
  emitsSpectral: boolean,
  disposables: Array<{ dispose: () => void }>
): OpticalPrism {
  const group = new THREE.Group();
  group.position.copy(pos);

  // Base pedestal
  const baseGeo = new THREE.CylinderGeometry(radius * 1.25, radius * 1.45, 0.55, 6);
  const base = new THREE.Mesh(baseGeo, mats.brass);
  base.position.y = 0.275;
  group.add(base);
  disposables.push(baseGeo);

  // Main hexagonal quartz shaft
  const shaftGeo = new THREE.CylinderGeometry(radius * 0.92, radius, height, 6);
  const shaft = new THREE.Mesh(shaftGeo, mats.quartzCrystal);
  shaft.position.y = 0.55 + height * 0.5;
  shaft.castShadow = true;
  group.add(shaft);
  disposables.push(shaftGeo);

  // Faceted crystal spire tip
  const tipGeo = new THREE.ConeGeometry(radius * 0.92, radius * 1.45, 6);
  const tip = new THREE.Mesh(tipGeo, mats.quartzCrystal);
  tip.position.y = 0.55 + height + radius * 0.72;
  group.add(tip);
  disposables.push(tipGeo);

  // Brass mid-ring collar
  const collarGeo = new THREE.TorusGeometry(radius * 1.02, 0.08, 8, 6);
  const collar = new THREE.Mesh(collarGeo, mats.darkBrass);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.55 + height * 0.45;
  group.add(collar);
  disposables.push(collarGeo);

  return {
    id,
    mesh: group,
    position: pos.clone(),
    radius,
    height: height + 0.8,
    shattered: false,
    maxHp: 45,
    hp: 45,
    emitsSpectral,
  };
}

/**
 * Helper: Builds monumental observatory skyline pillars outside the playable ring so nothing sits in an empty void.
 */
function addObservatoryHorizonRing(
  group: THREE.Group,
  radius: number,
  count: number,
  mats: MaterialLibrary,
  disposables: Array<{ dispose: () => void }>
): void {
  const pillarGeo = new THREE.BoxGeometry(2.6, 28, 3.2);
  const archGeo = new THREE.TorusGeometry(radius + 8, 0.55, 8, 64);
  disposables.push(pillarGeo, archGeo);

  const inst = new THREE.InstancedMesh(pillarGeo, mats.obsidianStone, count);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const dist = radius + 14 + (i % 2) * 5;
    dummy.position.set(Math.cos(a) * dist, 7 + (i % 3) * 3, Math.sin(a) * dist);
    dummy.rotation.set(0, -a, (i % 2 === 0 ? 1 : -1) * 0.05);
    dummy.scale.set(1, 0.8 + (i % 3) * 0.3, 1);
    dummy.updateMatrix();
    inst.setMatrixAt(i, dummy.matrix);
  }
  inst.computeBoundingSphere();
  group.add(inst);

  // Tilted celestial brass astrolabe rings framing the sky
  const astroA = new THREE.Mesh(archGeo, mats.darkBrass);
  astroA.rotation.set(Math.PI * 0.34, 0.4, 0);
  astroA.position.y = 14;
  group.add(astroA);

  const astroB = new THREE.Mesh(archGeo, mats.brass);
  astroB.rotation.set(-Math.PI * 0.28, -0.6, 0.2);
  astroB.position.y = 18;
  astroB.scale.setScalar(0.86);
  group.add(astroB);
}

export function buildArena(layerId: ArenaLayerId, mats: MaterialLibrary): BuiltArena {
  const group = new THREE.Group();
  const mirrors: OpticalMirror[] = [];
  const prisms: OpticalPrism[] = [];
  const bridges: HardLightBridge[] = [];
  const updrafts: GravityUpdraft[] = [];
  const hotspots: FocalHotspot[] = [];
  const liquidTubes: LiquidTubePath[] = [];
  const rotatingPlatforms: RotatingPlatform[] = [];
  const diaphragmBlades: DiaphragmFloorBlade[] = [];
  const envLightRays: BuiltArena['envLightRays'] = [];
  const disposables: Array<{ dispose: () => void }> = [];

  const arenaRadius = 38;
  let hasVoidPit = false;
  let diaphragmOpening = 0.35;

  // Base observatory floor (except Layer 3 chasm & Layer 5 mechanical diaphragm floor)
  if (layerId !== 3 && layerId !== 5) {
    const floorGeo = new THREE.CylinderGeometry(arenaRadius, arenaRadius + 2, 1.4, 48);
    const floor = new THREE.Mesh(floorGeo, mats.obsidianFloor);
    floor.position.y = -0.7;
    floor.receiveShadow = true;
    group.add(floor);
    disposables.push(floorGeo);

    // Concentric inlaid brass calibration rings
    const ringRadii = [10, 22, arenaRadius - 0.8];
    for (const rr of ringRadii) {
      const rGeo = new THREE.RingGeometry(rr - 0.22, rr + 0.22, 64);
      const rMat = mats.brass.clone();
      rMat.polygonOffset = true;
      rMat.polygonOffsetFactor = -1;
      rMat.polygonOffsetUnits = -1;
      const rMesh = new THREE.Mesh(rGeo, rMat);
      rMesh.rotation.x = -Math.PI / 2;
      rMesh.position.y = 0.02;
      group.add(rMesh);
      disposables.push(rGeo, rMat);
    }
  }

  // Outer stone parapet rim for spatial grounding
  const parapetGeo = new THREE.TorusGeometry(arenaRadius + 0.6, 0.9, 8, 48);
  const parapet = new THREE.Mesh(parapetGeo, mats.obsidianStone);
  parapet.rotation.x = Math.PI / 2;
  parapet.position.y = 0.65;
  group.add(parapet);
  disposables.push(parapetGeo);

  addObservatoryHorizonRing(group, arenaRadius, 24, mats, disposables);

  // Common perimeter Specular Dash Bounce Mirrors (placed on cardinal/diagonal vectors)
  const mirrorCount = layerId === 4 ? 4 : 6;
  for (let i = 0; i < mirrorCount; i++) {
    const a = (i / mirrorCount) * Math.PI * 2 + 0.25;
    const dist = layerId === 3 ? 21 : 27;
    const pos = new THREE.Vector3(Math.cos(a) * dist, 0, Math.sin(a) * dist);
    const yawToCenter = Math.atan2(-pos.x, -pos.z);
    const m = createBounceMirror(
      `mirror_${i}`,
      pos,
      yawToCenter + (i % 2 === 0 ? 0.12 : -0.12),
      -0.06,
      2.35,
      mats,
      layerId === 4,
      disposables
    );
    mirrors.push(m);
    group.add(m.mesh);
  }

  // =========================================================================
  // LAYER-SPECIFIC HANDCRAFTED OPTICAL ARCHITECTURE
  // =========================================================================
  if (layerId === 1) {
    // KATMAN 1: DEV AYNALAR VADİSİ (The Parabolic Mirrors)
    // 3 Colossal Concave Parabolic Dish Mirrors collecting starlight into burning focal zones
    const dishPoints: THREE.Vector2[] = [];
    for (let i = 0; i <= 12; i++) {
      const r = (i / 12) * 5.2;
      const y = (r * r) * 0.065;
      dishPoints.push(new THREE.Vector2(r, y));
    }
    const dishGeo = new THREE.LatheGeometry(dishPoints, 28);
    const dishRingGeo = new THREE.TorusGeometry(5.2, 0.24, 10, 32);
    const yokePedGeo = new THREE.CylinderGeometry(1.1, 1.6, 3.2, 8);
    const focalGlowGeo = new THREE.SphereGeometry(0.95, 16, 16);
    disposables.push(dishGeo, dishRingGeo, yokePedGeo, focalGlowGeo);

    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const dishGroup = new THREE.Group();
      dishGroup.position.set(Math.cos(a) * 18, 0, Math.sin(a) * 18);
      dishGroup.lookAt(0, 2.2, 0);

      const ped = new THREE.Mesh(yokePedGeo, mats.darkBrass);
      ped.position.y = 1.6;
      dishGroup.add(ped);

      const dishHolder = new THREE.Group();
      dishHolder.position.y = 4.5;
      dishHolder.rotation.x = Math.PI * 0.34;
      dishGroup.add(dishHolder);

      const dish = new THREE.Mesh(dishGeo, mats.silverMirror);
      const rim = new THREE.Mesh(dishRingGeo, mats.brass);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 1.75;
      dishHolder.add(dish, rim);
      group.add(dishGroup);

      // Focused caustic hotspot at focal center
      const focalPos = new THREE.Vector3(Math.cos(a) * 10.5, 1.35, Math.sin(a) * 10.5);
      const hotMat = new THREE.MeshBasicMaterial({
        color: 0xffe9a6,
        transparent: true,
        opacity: 0.78,
        blending: THREE.AdditiveBlending,
      });
      const hotMesh = new THREE.Mesh(focalGlowGeo, hotMat);
      hotMesh.position.copy(focalPos);
      group.add(hotMesh);
      disposables.push(hotMat);

      hotspots.push({ position: focalPos, radius: 2.1, intensity: 1.0, mesh: hotMesh });

      // Starlight beam into parabolic dish -> focal hotspot
      envLightRays.push({
        origin: new THREE.Vector3(Math.cos(a) * 24, 24, Math.sin(a) * 24),
        dir: new THREE.Vector3(-Math.cos(a) * 0.25, -1, -Math.sin(a) * 0.25).normalize(),
        colorHex: 0xfff0c2,
        radius: 0.22,
        maxBounces: 1,
      });
    }

    // 3 Rotating Silver & Brass Reflective Platforms
    const platGeo = new THREE.BoxGeometry(4.4, 0.45, 9.5);
    const platTrimGeo = new THREE.BoxGeometry(4.65, 0.22, 9.75);
    disposables.push(platGeo, platTrimGeo);
    for (let i = 0; i < 3; i++) {
      const pGroup = new THREE.Group();
      const angle = (i / 3) * Math.PI * 2;
      pGroup.position.set(Math.cos(angle) * 13, 1.85, Math.sin(angle) * 13);
      pGroup.rotation.y = -angle;

      const deck = new THREE.Mesh(platGeo, mats.silverMirror);
      const trim = new THREE.Mesh(platTrimGeo, mats.brass);
      trim.position.y = -0.14;
      pGroup.add(deck, trim);
      group.add(pGroup);

      rotatingPlatforms.push({
        group: pGroup,
        center: new THREE.Vector3(0, 0, 0),
        radius: 13,
        angularSpeed: 0.28,
        yTop: 2.08,
        halfWidth: 2.3,
        halfLength: 4.8,
        angle,
      });
    }

    // 4 Shatterable Quartz Columns
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.78;
      const p = createQuartzPrismColumn(
        `prism_${i}`,
        new THREE.Vector3(Math.cos(a) * 15, 0, Math.sin(a) * 15),
        1.1,
        5.8,
        mats,
        true,
        disposables
      );
      prisms.push(p);
      group.add(p.mesh);
    }
  } else if (layerId === 2) {
    // KATMAN 2: KUVARS PRİZMA LABİRENTİ (The Spectral Labyrinth)
    // Raised octagonal dais platforms connected by Blue Hard-Light Bridges + Violet Gravity Updrafts
    const daisGeo = new THREE.CylinderGeometry(5.5, 6.2, 3.6, 8);
    disposables.push(daisGeo);
    const daisAngles = [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3];
    const daisPositions: THREE.Vector3[] = [];
    for (let i = 0; i < 3; i++) {
      const a = daisAngles[i];
      const pos = new THREE.Vector3(Math.cos(a) * 17, 1.8, Math.sin(a) * 17);
      daisPositions.push(pos);
      const dais = new THREE.Mesh(daisGeo, mats.obsidianStone);
      dais.position.copy(pos);
      group.add(dais);
    }

    // Central Monumental Master Prism splitting zenith white light into Red, Blue, Violet beams
    const masterPrism = createQuartzPrismColumn(
      'master_prism',
      new THREE.Vector3(0, 0, 0),
      2.1,
      9.2,
      mats,
      true,
      disposables
    );
    prisms.push(masterPrism);
    group.add(masterPrism.mesh);

    // Hard-Light Blue Bridges between elevated daises
    const bridgeGeo = new THREE.BoxGeometry(3.2, 0.35, 16.5);
    disposables.push(bridgeGeo);
    for (let i = 0; i < 3; i++) {
      const a = daisPositions[i];
      const b = daisPositions[(i + 1) % 3];
      const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
      mid.y = 3.45;
      const bMesh = new THREE.Mesh(bridgeGeo, mats.hardLightBridge);
      bMesh.position.copy(mid);
      bMesh.lookAt(b.x, 3.45, b.z);
      group.add(bMesh);

      const box = new THREE.Box3().setFromObject(bMesh);
      bridges.push({ mesh: bMesh, box, active: true });
    }

    // Violet Gravity-Inversion Updraft Columns
    const updraftGeo = new THREE.CylinderGeometry(2.6, 2.6, 14, 16, 1, true);
    const updraftMat = new THREE.MeshBasicMaterial({
      color: 0x9b5cff,
      transparent: true,
      opacity: 0.24,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    disposables.push(updraftGeo, updraftMat);
    for (let i = 0; i < 3; i++) {
      const a = daisAngles[i] + Math.PI / 3;
      const uPos = new THREE.Vector3(Math.cos(a) * 12.5, 7, Math.sin(a) * 12.5);
      const uMesh = new THREE.Mesh(updraftGeo, updraftMat);
      uMesh.position.copy(uPos);
      group.add(uMesh);
      updrafts.push({
        position: new THREE.Vector3(uPos.x, 0, uPos.z),
        radius: 3.1,
        height: 15,
        mesh: uMesh,
      });
    }

    // Additional shatterable spectral prisms
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.4;
      const p = createQuartzPrismColumn(
        `labyrinth_prism_${i}`,
        new THREE.Vector3(Math.cos(a) * 22, 0, Math.sin(a) * 22),
        1.15,
        6.5,
        mats,
        true,
        disposables
      );
      prisms.push(p);
      group.add(p.mesh);
    }

    // Spectral rays sweeping from the Master Prism
    envLightRays.push(
      {
        origin: new THREE.Vector3(0, 14, 0),
        dir: new THREE.Vector3(0, -1, 0),
        colorHex: 0xffffff,
        radius: 0.32,
        maxBounces: 1,
      },
      {
        origin: new THREE.Vector3(0, 3.2, 0),
        dir: new THREE.Vector3(1, -0.05, 0.2).normalize(),
        colorHex: 0xff4b2b,
        radius: 0.22,
        maxBounces: 2,
      },
      {
        origin: new THREE.Vector3(0, 3.2, 0),
        dir: new THREE.Vector3(-0.7, -0.04, 0.8).normalize(),
        colorHex: 0x38f2c8,
        radius: 0.22,
        maxBounces: 2,
      },
      {
        origin: new THREE.Vector3(0, 3.2, 0),
        dir: new THREE.Vector3(-0.4, -0.04, -0.9).normalize(),
        colorHex: 0x9b5cff,
        radius: 0.22,
        maxBounces: 2,
      }
    );
  } else if (layerId === 3) {
    // KATMAN 3: FİBER OPTİK UÇURUMU (The Total-Reflection Chasm)
    hasVoidPit = true;

    // Central Observatory Hub + Outer Brass Ring Walkways over luminous abyss
    const hubGeo = new THREE.CylinderGeometry(11, 9, 2.2, 16);
    const hub = new THREE.Mesh(hubGeo, mats.obsidianFloor);
    hub.position.y = -1.1;
    hub.receiveShadow = true;
    group.add(hub);
    disposables.push(hubGeo);

    const ringGeo = new THREE.RingGeometry(19, 24.5, 48);
    const ringMesh = new THREE.Mesh(ringGeo, mats.obsidianFloor);
    ringMesh.rotation.x = -Math.PI / 2;
    ringMesh.position.y = 0.0;
    ringMesh.receiveShadow = true;
    group.add(ringMesh);
    disposables.push(ringGeo);

    // 4 Sweeping Borosilicate Glass Fiber-Optic Conduits filled with flowing Liquid Light
    const tubeSpecs = [
      [new THREE.Vector3(-22, 0.5, 0), new THREE.Vector3(-11, 5.2, -7), new THREE.Vector3(0, 1.5, 0), new THREE.Vector3(11, 5.2, 7), new THREE.Vector3(22, 0.5, 0)],
      [new THREE.Vector3(0, 0.5, -22), new THREE.Vector3(8, 5.6, -11), new THREE.Vector3(0, 1.5, 0), new THREE.Vector3(-8, 5.6, 11), new THREE.Vector3(0, 0.5, 22)],
      [new THREE.Vector3(-16, 0.4, -16), new THREE.Vector3(-18, 4.5, 0), new THREE.Vector3(-16, 0.4, 16)],
      [new THREE.Vector3(16, 0.4, -16), new THREE.Vector3(18, 4.5, 0), new THREE.Vector3(16, 0.4, 16)],
    ];

    for (let i = 0; i < tubeSpecs.length; i++) {
      const curve = new THREE.CatmullRomCurve3(tubeSpecs[i]);
      // Inner liquid-light core
      const coreTubeGeo = new THREE.TubeGeometry(curve, 52, 0.92, 12, false);
      const coreMesh = new THREE.Mesh(coreTubeGeo, mats.liquidLightShader);
      group.add(coreMesh);
      disposables.push(coreTubeGeo);

      // Outer crystal glass sheath (walkable spine!)
      const glassTubeGeo = new THREE.TubeGeometry(curve, 52, 1.32, 14, false);
      const glassMesh = new THREE.Mesh(glassTubeGeo, mats.quartzCrystal);
      group.add(glassMesh);
      disposables.push(glassTubeGeo);

      liquidTubes.push({
        curve,
        tubeRadius: 1.45,
        mesh: glassMesh,
        flowColor: i % 2 === 0 ? 0x18d8ff : 0xb875ff,
      });
    }

    // Glowing chasm void depth discs below
    const chasmGeo = new THREE.CircleGeometry(42, 32);
    const chasmMat = new THREE.MeshBasicMaterial({
      color: 0x092438,
      transparent: true,
      opacity: 0.72,
    });
    const chasm = new THREE.Mesh(chasmGeo, chasmMat);
    chasm.rotation.x = -Math.PI / 2;
    chasm.position.y = -18;
    group.add(chasm);
    disposables.push(chasmGeo, chasmMat);
  } else if (layerId === 4) {
    // KATMAN 4: KARANLIK ODA KALESİ (The Camera Obscura Bastion)
    // Towering dark-obsidian domed bastion with 3 overhead Mechanical Iris Shutters
    const wallGeo = new THREE.CylinderGeometry(arenaRadius + 0.5, arenaRadius + 0.5, 22, 32, 1, true);
    const wallMat = mats.obsidianStone.clone();
    wallMat.side = THREE.BackSide;
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.position.y = 11;
    group.add(wall);
    disposables.push(wallGeo, wallMat);

    // Overhead Brass Aperture Ceiling Ring
    const ceilGeo = new THREE.RingGeometry(11, arenaRadius + 1, 32);
    const ceilMat = mats.obsidianStone.clone();
    ceilMat.side = THREE.DoubleSide;
    const ceil = new THREE.Mesh(ceilGeo, ceilMat);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = 21.5;
    group.add(ceil);
    disposables.push(ceilGeo, ceilMat);

    // 3 Overhead Shutter Rings letting sharp shafts of starlight pierce onto rotatable floor mirrors
    const shutterGeo = new THREE.TorusGeometry(4.2, 0.45, 8, 24);
    disposables.push(shutterGeo);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const sx = Math.cos(a) * 14;
      const sz = Math.sin(a) * 14;
      const shutter = new THREE.Mesh(shutterGeo, mats.brass);
      shutter.rotation.x = Math.PI / 2;
      shutter.position.set(sx, 20.8, sz);
      group.add(shutter);

      // Overhead beam shining directly onto a rotatable mirror turret
      envLightRays.push({
        origin: new THREE.Vector3(sx, 24, sz),
        dir: new THREE.Vector3(Math.cos(a) * 0.48, -0.88, Math.sin(a) * 0.48).normalize(),
        colorHex: 0xffe6a3,
        radius: 0.34,
        maxBounces: 2,
      });
    }

    // 2 Central Shatterable Quartz Relays
    for (let i = 0; i < 2; i++) {
      const p = createQuartzPrismColumn(
        `obscura_prism_${i}`,
        new THREE.Vector3(i === 0 ? -7 : 7, 0, 0),
        1.1,
        5.5,
        mats,
        true,
        disposables
      );
      prisms.push(p);
      group.add(p.mesh);
    }
  } else if (layerId === 5) {
    // KATMAN 5: MUTLAK TEKİLLİK MERCEĞİ (The Singularity Lens)
    hasVoidPit = true;

    // Outer Observatory Rim Ring (Safe solid ground radius 22..38)
    const outerFloorGeo = new THREE.RingGeometry(21.5, arenaRadius, 48);
    const outerFloor = new THREE.Mesh(outerFloorGeo, mats.obsidianFloor);
    outerFloor.rotation.x = -Math.PI / 2;
    outerFloor.position.y = 0;
    outerFloor.receiveShadow = true;
    group.add(outerFloor);
    disposables.push(outerFloorGeo);

    // Central Singularity Lens Core below the diaphragm
    const lensRingGeo = new THREE.TorusGeometry(6.5, 0.4, 12, 48);
    const lensRing = new THREE.Mesh(lensRingGeo, mats.brass);
    lensRing.rotation.x = Math.PI / 2;
    lensRing.position.y = -4.2;
    group.add(lensRing);
    disposables.push(lensRingGeo);

    const singularityLensGeo = new THREE.SphereGeometry(5.6, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.32);
    const singularityLens = new THREE.Mesh(singularityLensGeo, mats.sapphireLens);
    singularityLens.position.y = -6.5;
    group.add(singularityLens);
    disposables.push(singularityLensGeo);

    // 12-Blade Colossal Mechanical Camera Diaphragm Floor (radius 0..22)
    const bladeShape = new THREE.Shape();
    bladeShape.moveTo(0, 0);
    bladeShape.lineTo(23.0, -3.5);
    bladeShape.lineTo(22.5, 9.5);
    bladeShape.lineTo(4.0, 12.0);
    bladeShape.closePath();

    const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, {
      depth: 0.45,
      bevelEnabled: true,
      bevelThickness: 0.08,
      bevelSize: 0.08,
      bevelSegments: 1,
    });
    bladeGeo.rotateX(-Math.PI / 2);
    disposables.push(bladeGeo);

    const bladeCount = 12;
    for (let i = 0; i < bladeCount; i++) {
      const baseAngle = (i / bladeCount) * Math.PI * 2;
      const pivot = new THREE.Group();
      pivot.position.set(Math.cos(baseAngle) * 22.0, -0.45 + i * 0.015, Math.sin(baseAngle) * 22.0);
      pivot.rotation.y = -baseAngle + Math.PI;

      const mesh = new THREE.Mesh(bladeGeo, i % 2 === 0 ? mats.titanium : mats.darkBrass);
      mesh.receiveShadow = true;
      pivot.add(mesh);
      group.add(pivot);
      diaphragmBlades.push({ pivot, baseAngle, mesh });
    }

    // 4 Pure Zenith Photon Pillars descending from the heavens
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      envLightRays.push({
        origin: new THREE.Vector3(Math.cos(a) * 16, 28, Math.sin(a) * 16),
        dir: new THREE.Vector3(0, -1, 0),
        colorHex: [0xfff4d4, 0x38f2c8, 0x9b5cff, 0xff4b2b][i],
        radius: 0.36,
        maxBounces: 0,
      });
    }

    // 4 Shatterable Crystal Pillars on outer ring
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const p = createQuartzPrismColumn(
        `singularity_prism_${i}`,
        new THREE.Vector3(Math.cos(a) * 26, 0, Math.sin(a) * 26),
        1.15,
        6.2,
        mats,
        true,
        disposables
      );
      prisms.push(p);
      group.add(p.mesh);
    }
  }

  return {
    layerId,
    group,
    mirrors,
    prisms,
    bridges,
    updrafts,
    hotspots,
    liquidTubes,
    rotatingPlatforms,
    diaphragmBlades,
    envLightRays,
    arenaRadius,
    hasVoidPit,
    diaphragmOpening,
    update: (dt, elapsed, _playerPos) => {
      // Update Liquid-Light Flow shader
      mats.liquidLightShader.uniforms.uTime.value = elapsed;

      // Update Rotating Platforms (Layer 1)
      for (const rp of rotatingPlatforms) {
        rp.angle += rp.angularSpeed * dt;
        rp.group.position.set(
          Math.cos(rp.angle) * rp.radius,
          1.85,
          Math.sin(rp.angle) * rp.radius
        );
        rp.group.rotation.y = -rp.angle;
      }

      // Update Parabolic Focal Hotspots pulse (Layer 1)
      for (const hs of hotspots) {
        const s = 1.0 + Math.sin(elapsed * 6.5) * 0.14;
        hs.mesh.scale.setScalar(s);
      }

      // Update Layer 5 Giant Mechanical Diaphragm Floor (opens & closes smoothly!)
      if (layerId === 5 && diaphragmBlades.length > 0) {
        const wave = Math.sin(elapsed * 0.42) * 0.5 + 0.5; // 0 = closed, 1 = wide open
        diaphragmOpening = wave;
        const swing = THREE.MathUtils.lerp(0.06, 0.72, wave);
        for (const db of diaphragmBlades) {
          db.pivot.rotation.y = -db.baseAngle + Math.PI - swing;
        }
      }

      // Update Mirror World Transforms & Highlight Decay
      for (const m of mirrors) {
        m.highlightFactor = Math.max(0, m.highlightFactor - dt * 2.5);
        m.surfaceMesh.getWorldPosition(m.position);
        m.surfaceMesh.getWorldDirection(m.normal);
      }
    },
    getFloorHeightAt: (x, z, playerY) => {
      const rSq = x * x + z * z;
      const r = Math.sqrt(rSq);

      // Check rotating platforms first (Layer 1)
      for (const rp of rotatingPlatforms) {
        const dx = x - rp.group.position.x;
        const dz = z - rp.group.position.z;
        const cos = Math.cos(-rp.group.rotation.y);
        const sin = Math.sin(-rp.group.rotation.y);
        const lx = dx * cos - dz * sin;
        const lz = dx * sin + dz * cos;
        if (Math.abs(lx) <= rp.halfWidth && Math.abs(lz) <= rp.halfLength && playerY >= rp.yTop - 1.1) {
          return rp.yTop;
        }
      }

      // Check Hard-Light Blue Bridges (Layer 2)
      for (const b of bridges) {
        if (!b.active) continue;
        if (
          x >= b.box.min.x - 0.5 &&
          x <= b.box.max.x + 0.5 &&
          z >= b.box.min.z - 0.5 &&
          z <= b.box.max.z + 0.5 &&
          playerY >= 3.0
        ) {
          return 3.65;
        }
      }

      // Check Elevated Daises (Layer 2)
      if (layerId === 2) {
        const daisAngles = [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3];
        for (const a of daisAngles) {
          const dx = x - Math.cos(a) * 17;
          const dz = z - Math.sin(a) * 17;
          if (dx * dx + dz * dz <= 5.8 * 5.8 && playerY >= 3.0) {
            return 3.62;
          }
        }
      }

      // Check Fiber-Optic Tube Spines (Layer 3)
      if (layerId === 3) {
        for (const lt of liquidTubes) {
          // Sample 16 points along curve for reliable collision
          for (let t = 0; t <= 1; t += 0.0625) {
            const pt = lt.curve.getPoint(t);
            const dx = x - pt.x;
            const dz = z - pt.z;
            if (dx * dx + dz * dz <= (lt.tubeRadius + 0.5) ** 2 && playerY >= pt.y + 0.2) {
              return pt.y + lt.tubeRadius;
            }
          }
        }
        // Central hub or outer ring
        if (r <= 11.2 || (r >= 18.6 && r <= arenaRadius + 1)) {
          return 0.0;
        }
        return null; // Abyss chasm!
      }

      // Check Mechanical Diaphragm Opening (Layer 5)
      if (layerId === 5) {
        const holeRadius = THREE.MathUtils.lerp(2.2, 14.5, diaphragmOpening);
        if (r < holeRadius) {
          return null; // Falling into the Singularity Lens void!
        }
        return 0.0;
      }

      if (r <= arenaRadius + 1.0) return 0.0;
      return null;
    },
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
}
