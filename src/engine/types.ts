import * as THREE from 'three';

export type WavelengthBand = 'infrared' | 'visible' | 'ultraviolet';

export interface WavelengthSpec {
  id: WavelengthBand;
  label: string;
  nm: number;
  colorHex: number;
  cssHex: string;
  ior: number;
  thermalRate: number;
  pitchRatio: number;
}

export const WAVELENGTHS: Record<WavelengthBand, WavelengthSpec> = {
  infrared: {
    id: 'infrared',
    label: '680nm Kızılötesi',
    nm: 680,
    colorHex: 0xff4b2b,
    cssHex: '#ff4b2b',
    ior: 1.51,
    thermalRate: 1.45,
    pitchRatio: 1.0,
  },
  visible: {
    id: 'visible',
    label: '510nm Görünür Tayf',
    nm: 510,
    colorHex: 0x38f2c8,
    cssHex: '#38f2c8',
    ior: 1.55,
    thermalRate: 1.0,
    pitchRatio: 1.25,
  },
  ultraviolet: {
    id: 'ultraviolet',
    label: '405nm Morötesi',
    nm: 405,
    colorHex: 0x9b5cff,
    cssHex: '#9b5cff',
    ior: 1.61,
    thermalRate: 1.2,
    pitchRatio: 1.5,
  },
};

export type ArenaLayerId = 1 | 2 | 3 | 4 | 5;

export interface ArenaLayerInfo {
  id: ArenaLayerId;
  code: string;
  title: string;
  subtitle: string;
  description: string;
  skyColor: number;
  fogColor: number;
  fogDensity: number;
}

export const ARENA_LAYERS: ArenaLayerInfo[] = [
  {
    id: 1,
    code: 'Katman I',
    title: 'Dev Aynalar Vadisi',
    subtitle: 'The Parabolic Mirrors',
    description:
      'Yıldız ışığını dev çukur aynalarla odaklayan, sürekli dönen pirinç platformlar ve yansıma zincirleri.',
    skyColor: 0x090d16,
    fogColor: 0x0b101b,
    fogDensity: 0.0085,
  },
  {
    id: 2,
    code: 'Katman II',
    title: 'Kuvars Prizma Labirenti',
    subtitle: 'The Spectral Labyrinth',
    description:
      'Kırmızı yakıcı ışınlar, mavi katı fotonik köprüler ve mor yerçekimi tersine çevirici prizma sütunları.',
    skyColor: 0x0b0918,
    fogColor: 0x0e0c1f,
    fogDensity: 0.009,
  },
  {
    id: 3,
    code: 'Katman III',
    title: 'Fiber Optik Uçurumu',
    subtitle: 'The Total-Reflection Chasm',
    description:
      'Sıvı ışık akıntıları taşıyan dev borosilikat cam borular ve uçurum üzerindeki pirinç köprüler.',
    skyColor: 0x050b12,
    fogColor: 0x071019,
    fogDensity: 0.0095,
  },
  {
    id: 4,
    code: 'Katman IV',
    title: 'Karanlık Oda Kalesi',
    subtitle: 'The Camera Obscura Bastion',
    description:
      'Tepedeki mekanik diyafram kapaklarından sızan ışığı el yapımı pirinç aynalarla gölgelere yönlendirin.',
    skyColor: 0x040508,
    fogColor: 0x05070b,
    fogDensity: 0.013,
  },
  {
    id: 5,
    code: 'Katman V',
    title: 'Mutlak Tekillik Merceği',
    subtitle: 'The Singularity Lens',
    description:
      'Açılıp kapanan dev mekanik diyafram zemini üzerinde Kara Madde Algoritması Umbra Leviathan ile final yüzleşmesi.',
    skyColor: 0x08060f,
    fogColor: 0x0b0814,
    fogDensity: 0.0075,
  },
];

export interface OpticalMirror {
  id: string;
  mesh: THREE.Object3D;
  surfaceMesh: THREE.Mesh;
  position: THREE.Vector3;
  normal: THREE.Vector3;
  radius: number;
  rotatable?: boolean;
  yawAngle?: number;
  baseGroup?: THREE.Group;
  yokeGroup?: THREE.Group;
  highlightFactor: number;
}

export interface OpticalPrism {
  id: string;
  mesh: THREE.Group;
  position: THREE.Vector3;
  radius: number;
  height: number;
  shattered: boolean;
  maxHp: number;
  hp: number;
  emitsSpectral?: boolean;
}

export interface HardLightBridge {
  mesh: THREE.Mesh;
  box: THREE.Box3;
  active: boolean;
}

export interface GravityUpdraft {
  position: THREE.Vector3;
  radius: number;
  height: number;
  mesh: THREE.Mesh;
}

export interface FocalHotspot {
  position: THREE.Vector3;
  radius: number;
  intensity: number;
  mesh: THREE.Mesh;
}

export interface LiquidTubePath {
  curve: THREE.CatmullRomCurve3;
  tubeRadius: number;
  mesh: THREE.Mesh;
  flowColor: number;
}

export interface RotatingPlatform {
  group: THREE.Group;
  center: THREE.Vector3;
  radius: number;
  angularSpeed: number;
  yTop: number;
  halfWidth: number;
  halfLength: number;
  angle: number;
}

export interface DiaphragmFloorBlade {
  pivot: THREE.Group;
  baseAngle: number;
  mesh: THREE.Mesh;
}

export interface FloorCrystalShard {
  mesh: THREE.Mesh;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  rotVel: THREE.Vector3;
  life: number;
  wavelengthHex: number;
  settled: boolean;
}

export interface EnemyEntity {
  id: string;
  kind: 'stalker' | 'sentinel' | 'leviathan';
  group: THREE.Group;
  coreMesh: THREE.Mesh;
  armorMeshes: THREE.Mesh[];
  armorMaterial: THREE.MeshStandardMaterial;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  radius: number;
  armorHp: number;
  maxArmorHp: number;
  coreHp: number;
  maxCoreHp: number;
  crystalExposed: boolean;
  heat: number;
  heatColor: THREE.Color;
  attackTimer: number;
  stunTimer: number;
  phase: number;
  dead: boolean;
}

export interface EngineUiBridge {
  layer: ArenaLayerId;
  gameState: 'title' | 'playing' | 'paused' | 'victory' | 'defeated';
  pointerLocked: boolean;
  combo: number;
  waveIndex: number;
  totalWaves: number;
  nearInteractable: string | null;
  dashReadyMirror: boolean;
  exposedTargetLocked: boolean;
  wavelength: WavelengthBand;
}
