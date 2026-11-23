import * as THREE from 'three';
import type { EnemyEntity, FloorCrystalShard, OpticalMirror, OpticalPrism } from './types';

const _dir = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _hitPos = new THREE.Vector3();
const _hitNorm = new THREE.Vector3();
const _refl = new THREE.Vector3();
const _toCenter = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();
const _dispDir = new THREE.Vector3();

export interface BeamHitEnemy {
  enemy: EnemyEntity;
  point: THREE.Vector3;
  colorHex: number;
  bounced: boolean;
}

export class SpectralBeamPool {
  private group = new THREE.Group();
  private beamGeo: THREE.CylinderGeometry;
  private discGeo: THREE.CircleGeometry;
  private segments: Array<{ mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial }> = [];
  private discs: Array<{ mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial }> = [];
  private activeSegments = 0;
  private activeDiscs = 0;

  constructor(scene: THREE.Scene, maxSegments = 72) {
    this.beamGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
    this.discGeo = new THREE.CircleGeometry(1, 16);

    for (let i = 0; i < maxSegments; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.beamGeo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.segments.push({ mesh, mat });

      const dMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.65,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const dMesh = new THREE.Mesh(this.discGeo, dMat);
      dMesh.visible = false;
      dMesh.frustumCulled = false;
      this.group.add(dMesh);
      this.discs.push({ mesh: dMesh, mat: dMat });
    }

    scene.add(this.group);
  }

  public beginFrame(): void {
    this.activeSegments = 0;
    this.activeDiscs = 0;
  }

  public pushSegment(
    start: THREE.Vector3,
    end: THREE.Vector3,
    radius: number,
    colorHex: number,
    opacity = 0.88
  ): void {
    if (this.activeSegments >= this.segments.length) return;
    const slot = this.segments[this.activeSegments++];

    _dir.subVectors(end, start);
    const len = _dir.length();
    if (len < 0.01) return;
    _dir.divideScalar(len);

    _mid.addVectors(start, end).multiplyScalar(0.5);
    _quat.setFromUnitVectors(_up, _dir);

    slot.mesh.position.copy(_mid);
    slot.mesh.quaternion.copy(_quat);
    slot.mesh.scale.set(radius, len, radius);
    slot.mat.color.setHex(colorHex);
    slot.mat.opacity = opacity;
    slot.mesh.visible = true;
  }

  public pushImpactDisc(
    pos: THREE.Vector3,
    normal: THREE.Vector3,
    radius: number,
    colorHex: number,
    opacity = 0.72
  ): void {
    if (this.activeDiscs >= this.discs.length) return;
    const slot = this.discs[this.activeDiscs++];

    slot.mesh.position.copy(pos).addScaledVector(normal, 0.03);
    _quat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    slot.mesh.quaternion.copy(_quat);
    slot.mesh.scale.setScalar(radius);
    slot.mat.color.setHex(colorHex);
    slot.mat.opacity = opacity;
    slot.mesh.visible = true;
  }

  public endFrame(): void {
    for (let i = this.activeSegments; i < this.segments.length; i++) {
      this.segments[i].mesh.visible = false;
    }
    for (let i = this.activeDiscs; i < this.discs.length; i++) {
      this.discs[i].mesh.visible = false;
    }
  }

  /**
   * Traces an optical ray with real Law of Reflection (Mirrors) and Snell Spectral Dispersion (Prisms).
   */
  public traceSpectralRay(params: {
    start: THREE.Vector3;
    direction: THREE.Vector3;
    colorHex: number;
    radius: number;
    maxBounces: number;
    maxDistance: number;
    mirrors: OpticalMirror[];
    prisms: OpticalPrism[];
    enemies?: EnemyEntity[];
    floorShards?: FloorCrystalShard[];
    hitsOut?: BeamHitEnemy[];
  }): void {
    _origin.copy(params.start);
    _dir.copy(params.direction).normalize();

    let currentColor = params.colorHex;
    let bounced = false;

    for (let bounce = 0; bounce <= params.maxBounces; bounce++) {
      let bestDist = params.maxDistance;
      let hitType: 'none' | 'mirror' | 'prism' | 'enemy' | 'floor' = 'none';
      let hitMirror: OpticalMirror | null = null;
      let hitPrism: OpticalPrism | null = null;
      let hitEnemy: EnemyEntity | null = null;

      // 1. Check floor plane y = 0.05
      if (_dir.y < -0.001) {
        const tFloor = (0.05 - _origin.y) / _dir.y;
        if (tFloor > 0.05 && tFloor < bestDist) {
          bestDist = tFloor;
          hitType = 'floor';
          _hitNorm.set(0, 1, 0);
        }
      }

      // 2. Check Mirrors (disc intersection against mirror plane + radius)
      for (let i = 0; i < params.mirrors.length; i++) {
        const m = params.mirrors[i];
        const denom = _dir.dot(m.normal);
        if (Math.abs(denom) < 0.001) continue;
        _toCenter.subVectors(m.position, _origin);
        const t = _toCenter.dot(m.normal) / denom;
        if (t > 0.15 && t < bestDist) {
          _hitPos.copy(_origin).addScaledVector(_dir, t);
          if (_hitPos.distanceToSquared(m.position) <= m.radius * m.radius) {
            bestDist = t;
            hitType = 'mirror';
            hitMirror = m;
            _hitNorm.copy(m.normal);
            if (denom > 0) _hitNorm.negate();
          }
        }
      }

      // 3. Check Prisms (vertical cylinder approx)
      for (let i = 0; i < params.prisms.length; i++) {
        const p = params.prisms[i];
        if (p.shattered) continue;
        _toCenter.subVectors(p.position, _origin);
        const proj = _toCenter.dot(_dir);
        if (proj < 0.2 || proj > bestDist) continue;
        _hitPos.copy(_origin).addScaledVector(_dir, proj);
        const dx = _hitPos.x - p.position.x;
        const dz = _hitPos.z - p.position.z;
        const dy = _hitPos.y - (p.position.y + p.height * 0.5);
        if (dx * dx + dz * dz <= p.radius * p.radius && Math.abs(dy) <= p.height * 0.52) {
          bestDist = proj;
          hitType = 'prism';
          hitPrism = p;
          _hitNorm.set(dx, 0, dz).normalize();
        }
      }

      // 4. Check Enemies (sphere intersection)
      if (params.enemies) {
        for (let i = 0; i < params.enemies.length; i++) {
          const e = params.enemies[i];
          if (e.dead) continue;
          _toCenter.subVectors(e.position, _origin);
          const proj = _toCenter.dot(_dir);
          if (proj < 0.1 || proj > bestDist) continue;
          const distSq = _toCenter.lengthSq() - proj * proj;
          const r = e.radius * 1.15;
          if (distSq <= r * r) {
            const hitT = proj - Math.sqrt(Math.max(0, r * r - distSq));
            if (hitT > 0.1 && hitT < bestDist) {
              bestDist = hitT;
              hitType = 'enemy';
              hitEnemy = e;
              _hitPos.copy(_origin).addScaledVector(_dir, hitT);
              _hitNorm.subVectors(_hitPos, e.position).normalize();
            }
          }
        }
      }

      _hitPos.copy(_origin).addScaledVector(_dir, bestDist);
      this.pushSegment(_origin, _hitPos, params.radius, currentColor, bounce === 0 ? 0.92 : 0.72);

      // Shattered floor crystal shards scatter spectral rainbow reflections if ray passes close!
      if (params.floorShards && params.floorShards.length > 0 && bounce === 0) {
        for (let s = 0; s < Math.min(params.floorShards.length, 24); s += 3) {
          const shard = params.floorShards[s];
          if (!shard.settled) continue;
          _toCenter.subVectors(shard.position, _origin);
          const tProj = _toCenter.dot(_dir);
          if (tProj > 0.5 && tProj < bestDist) {
            const dSq = _toCenter.lengthSq() - tProj * tProj;
            if (dSq < 4.5) {
              const rainbow = [0xff4b2b, 0x38f2c8, 0x9b5cff][s % 3];
              const endShard = new THREE.Vector3(
                shard.position.x + Math.cos(s * 2.1) * 3.4,
                0.28 + (s % 2) * 0.3,
                shard.position.z + Math.sin(s * 2.1) * 3.4
              );
              this.pushSegment(shard.position, endShard, 0.025, rainbow, 0.52);
            }
          }
        }
      }

      if (hitType === 'none') break;

      this.pushImpactDisc(_hitPos, _hitNorm, params.radius * 3.6, currentColor, 0.75);

      if (hitType === 'enemy' && hitEnemy) {
        if (params.hitsOut) {
          params.hitsOut.push({
            enemy: hitEnemy,
            point: _hitPos.clone(),
            colorHex: currentColor,
            bounced,
          });
        }
        break;
      }

      if (hitType === 'floor') {
        break;
      }

      if (hitType === 'mirror' && hitMirror) {
        // Exact Law of Reflection: R = D - 2(D.N)N
        const dotDN = _dir.dot(_hitNorm);
        _refl.copy(_dir).addScaledVector(_hitNorm, -2 * dotDN).normalize();
        _origin.copy(_hitPos).addScaledVector(_hitNorm, 0.08);
        _dir.copy(_refl);
        bounced = true;
        hitMirror.highlightFactor = 1.0;
        continue;
      }

      if (hitType === 'prism' && hitPrism) {
        // Spectral dispersion: Split beam into Red (680nm), Cyan (510nm), Violet (405nm)
        const spectralColors = [0xff4b2b, 0x38f2c8, 0x9b5cff];
        const iorOffsets = [-0.22, 0.0, 0.24];
        for (let k = 0; k < 3; k++) {
          _dispDir.copy(_dir);
          _dispDir.applyAxisAngle(_up, iorOffsets[k]);
          _dispDir.normalize();
          const startDisp = _hitPos.clone().addScaledVector(_dispDir, hitPrism.radius * 0.6);
          const endDisp = startDisp.clone().addScaledVector(_dispDir, 18);
          this.pushSegment(startDisp, endDisp, params.radius * 0.68, spectralColors[k], 0.72);
        }
        break;
      }
    }
  }

  public dispose(): void {
    this.beamGeo.dispose();
    this.discGeo.dispose();
    for (const s of this.segments) s.mat.dispose();
    for (const d of this.discs) d.mat.dispose();
  }
}
