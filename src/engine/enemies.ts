import * as THREE from 'three';
import type { MaterialLibrary } from './materials';
import type { EnemyEntity } from './types';

export function spawnEnemy(
  id: string,
  kind: EnemyEntity['kind'],
  pos: THREE.Vector3,
  mats: MaterialLibrary,
  scene: THREE.Scene
): EnemyEntity {
  const group = new THREE.Group();
  group.position.copy(pos);

  const armorMaterial = mats.createThermalArmorMaterial();
  const armorMeshes: THREE.Mesh[] = [];

  const isBoss = kind === 'leviathan';
  const isSentinel = kind === 'sentinel';
  const scale = isBoss ? 2.45 : isSentinel ? 1.35 : 1.0;

  // 1. Inner Refractive Crystal Core (Exposed when dark-matter armor shatters!)
  const coreGeo = new THREE.OctahedronGeometry(0.55 * scale, 0);
  const coreMat = new THREE.MeshPhysicalMaterial({
    color: 0xffc66e,
    emissive: new THREE.Color(0x521d8a),
    emissiveIntensity: 0.9,
    roughness: 0.08,
    metalness: 0.1,
    clearcoat: 1.0,
  });
  const coreMesh = new THREE.Mesh(coreGeo, coreMat);
  coreMesh.scale.set(0.85, 1.4, 0.85);
  group.add(coreMesh);

  // 2. Dark-Matter Carapace Armor Plates (4-6 faceted obsidian shards orbiting the core)
  const plateCount = isBoss ? 8 : isSentinel ? 6 : 4;
  const plateGeo = new THREE.ConeGeometry(0.45 * scale, 1.45 * scale, 4);

  for (let i = 0; i < plateCount; i++) {
    const a = (i / plateCount) * Math.PI * 2;
    const plate = new THREE.Mesh(plateGeo, armorMaterial);
    plate.position.set(
      Math.cos(a) * 0.72 * scale,
      (i % 2 === 0 ? 0.15 : -0.15) * scale,
      Math.sin(a) * 0.72 * scale
    );
    plate.rotation.z = (i % 2 === 0 ? 0.28 : -0.28);
    plate.rotation.y = -a;
    plate.castShadow = true;
    group.add(plate);
    armorMeshes.push(plate);
  }

  // 3. Crown & Orbital Shadow Ring
  const ringGeo = new THREE.TorusGeometry(0.95 * scale, 0.08 * scale, 6, 16);
  const ring = new THREE.Mesh(ringGeo, armorMaterial);
  ring.rotation.x = Math.PI * 0.38;
  group.add(ring);
  armorMeshes.push(ring);

  // Extra Boss Leviathan multi-ringed monoliths
  if (isBoss) {
    const outerRingGeo = new THREE.TorusGeometry(1.75 * scale, 0.12 * scale, 6, 24);
    const outerRing = new THREE.Mesh(outerRingGeo, armorMaterial);
    outerRing.rotation.y = Math.PI * 0.25;
    group.add(outerRing);
    armorMeshes.push(outerRing);

    const spireGeo = new THREE.OctahedronGeometry(0.55 * scale, 0);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      const spire = new THREE.Mesh(spireGeo, armorMaterial);
      spire.position.set(Math.cos(a) * 1.9 * scale, 0.5, Math.sin(a) * 1.9 * scale);
      group.add(spire);
      armorMeshes.push(spire);
    }
  }

  scene.add(group);

  const maxArmorHp = isBoss ? 220 : isSentinel ? 90 : 48;
  const maxCoreHp = isBoss ? 180 : isSentinel ? 55 : 35;

  return {
    id,
    kind,
    group,
    coreMesh,
    armorMeshes,
    armorMaterial,
    position: group.position,
    velocity: new THREE.Vector3(),
    radius: isBoss ? 2.6 : isSentinel ? 1.45 : 1.1,
    armorHp: maxArmorHp,
    maxArmorHp,
    coreHp: maxCoreHp,
    maxCoreHp,
    crystalExposed: false,
    heat: 0,
    heatColor: new THREE.Color(0xff4b2b),
    attackTimer: 1.5 + Math.random() * 1.8,
    stunTimer: 0,
    phase: Math.random() * Math.PI * 2,
    dead: false,
  };
}

export function updateEnemyVisuals(enemy: EnemyEntity, dt: number, elapsed: number): void {
  if (enemy.dead) return;

  enemy.coreMesh.rotation.y += dt * (enemy.crystalExposed ? 3.8 : 1.4);
  enemy.coreMesh.rotation.x = Math.sin(elapsed * 2.1 + enemy.phase) * 0.2;

  const coreMat = enemy.coreMesh.material as THREE.MeshPhysicalMaterial;
  if (enemy.crystalExposed) {
    coreMat.emissive.setHex(0xffe699);
    coreMat.emissiveIntensity = 2.4 + Math.sin(elapsed * 14) * 0.6;
    enemy.coreMesh.scale.setScalar(1.15);
  } else {
    coreMat.emissive.setHex(0x4b1d7a);
    coreMat.emissiveIntensity = 0.7;
  }

  // Thermal Expansion & Fracture Shader Uniforms
  const u = enemy.armorMaterial.userData.thermalUniforms as
    | { uHeat: { value: number }; uHeatColor: { value: THREE.Color }; uTime: { value: number } }
    | undefined;
  if (u) {
    u.uHeat.value = THREE.MathUtils.damp(u.uHeat.value, enemy.heat, 8, dt);
    u.uHeatColor.value.copy(enemy.heatColor);
    u.uTime.value = elapsed;
  }

  // Spin armor rings
  for (let i = 0; i < enemy.armorMeshes.length; i++) {
    const m = enemy.armorMeshes[i];
    if (!m.visible) continue;
    if (i >= enemy.armorMeshes.length - 2) {
      m.rotation.z += dt * (i % 2 === 0 ? 1.1 : -0.9);
      m.rotation.y += dt * 0.6;
    }
  }
}

export function shatterEnemyArmor(enemy: EnemyEntity): void {
  if (enemy.crystalExposed) return;
  enemy.crystalExposed = true;
  enemy.armorHp = 0;
  for (const m of enemy.armorMeshes) {
    m.visible = false;
  }
}

export function disposeEnemy(enemy: EnemyEntity, scene: THREE.Scene): void {
  scene.remove(enemy.group);
  enemy.armorMaterial.dispose();
  (enemy.coreMesh.material as THREE.Material).dispose();
  enemy.group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
    }
  });
}
