import * as THREE from 'three';
import type { MaterialLibrary } from './materials';
import { WAVELENGTHS, type WavelengthBand } from './types';

export interface FirstPersonRig {
  root: THREE.Group;
  sabrePivot: THREE.Group;
  gauntletPivot: THREE.Group;
  slashRibbon: THREE.Mesh;
  update: (params: {
    dt: number;
    elapsed: number;
    moveSpeedRatio: number;
    wavelength: WavelengthBand;
    photonEnergy: number;
    beamActive: boolean;
    slashTimer: number;
    slashComboStep: number;
    comboCount: number;
    visorDamage: number;
    recoil: number;
  }) => void;
  getApertureMuzzleWorldPos: (out: THREE.Vector3) => THREE.Vector3;
  dispose: () => void;
}

export function createFirstPersonRig(
  mats: MaterialLibrary,
  isSoftwareGl: boolean
): FirstPersonRig {
  const root = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];

  // =========================================================================
  // RIGHT HAND: THE PRISM SABRE (Prizma Kılıcı) — 10+ Handcrafted Parts
  // =========================================================================
  const sabrePivot = new THREE.Group();
  sabrePivot.position.set(0.42, -0.34, -0.58);
  root.add(sabrePivot);

  const sabreModel = new THREE.Group();
  sabrePivot.add(sabreModel);

  // 1. Octagonal Titanium Grip
  const gripGeo = new THREE.CylinderGeometry(0.022, 0.025, 0.24, 8);
  const gripMesh = new THREE.Mesh(gripGeo, mats.titanium);
  sabreModel.add(gripMesh);
  disposables.push(gripGeo);

  // 2. Hand-wound Brass Grip Rings
  const ringGeo = new THREE.TorusGeometry(0.0245, 0.0032, 8, 20);
  disposables.push(ringGeo);
  for (let i = -3; i <= 3; i++) {
    const ring = new THREE.Mesh(ringGeo, mats.brass);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = i * 0.024;
    sabreModel.add(ring);
  }

  // 3. Beveled Pommel Cap
  const pommelGeo = new THREE.CylinderGeometry(0.03, 0.018, 0.045, 8);
  const pommel = new THREE.Mesh(pommelGeo, mats.darkBrass);
  pommel.position.y = -0.14;
  sabreModel.add(pommel);
  disposables.push(pommelGeo);

  // 4. Sculpted Wing Crossguard (ExtrudeGeometry with bevels)
  const guardShape = new THREE.Shape();
  guardShape.moveTo(-0.095, 0.0);
  guardShape.lineTo(-0.045, 0.024);
  guardShape.lineTo(0.045, 0.024);
  guardShape.lineTo(0.095, 0.0);
  guardShape.lineTo(0.055, -0.02);
  guardShape.lineTo(-0.055, -0.02);
  guardShape.closePath();

  const guardGeo = new THREE.ExtrudeGeometry(guardShape, {
    depth: 0.036,
    bevelEnabled: true,
    bevelThickness: 0.006,
    bevelSize: 0.006,
    bevelSegments: 2,
  });
  guardGeo.center();
  const guardMesh = new THREE.Mesh(guardGeo, mats.brass);
  guardMesh.position.y = 0.13;
  sabreModel.add(guardMesh);
  disposables.push(guardGeo);

  // 5. Dual Rotating Brass Vernier Calibration Rings
  const vernierGeo = new THREE.TorusGeometry(0.042, 0.004, 10, 24);
  const vernierA = new THREE.Mesh(vernierGeo, mats.brass);
  vernierA.position.y = 0.16;
  vernierA.rotation.x = Math.PI / 2;
  sabreModel.add(vernierA);

  const vernierB = new THREE.Mesh(vernierGeo, mats.titanium);
  vernierB.position.y = 0.175;
  vernierB.rotation.x = Math.PI / 2;
  sabreModel.add(vernierB);
  disposables.push(vernierGeo);

  // 6. Optical Emitter Collar (LatheGeometry)
  const collarPoints = [
    new THREE.Vector2(0.018, 0),
    new THREE.Vector2(0.036, 0.01),
    new THREE.Vector2(0.03, 0.035),
    new THREE.Vector2(0.04, 0.052),
    new THREE.Vector2(0.022, 0.065),
  ];
  const collarGeo = new THREE.LatheGeometry(collarPoints, 16);
  const collarMesh = new THREE.Mesh(collarGeo, mats.darkBrass);
  collarMesh.position.y = 0.15;
  sabreModel.add(collarMesh);
  disposables.push(collarGeo);

  // 7. Hand-cut Quartz Wavelength Core (Diegetic Wavelength Indicator!)
  const crystalCoreMat = new THREE.MeshPhysicalMaterial({
    color: WAVELENGTHS.visible.colorHex,
    emissive: new THREE.Color(WAVELENGTHS.visible.colorHex),
    emissiveIntensity: 1.6,
    roughness: 0.08,
    metalness: 0.05,
    clearcoat: 1.0,
  });
  const coreGeo = new THREE.OctahedronGeometry(0.024, 0);
  const crossguardCrystal = new THREE.Mesh(coreGeo, crystalCoreMat);
  crossguardCrystal.position.set(0, 0.13, 0.026);
  crossguardCrystal.scale.set(0.85, 1.35, 0.75);
  sabreModel.add(crossguardCrystal);

  const pommelCrystal = new THREE.Mesh(coreGeo, crystalCoreMat);
  pommelCrystal.position.set(0, -0.17, 0);
  pommelCrystal.scale.set(0.6, 0.9, 0.6);
  sabreModel.add(pommelCrystal);
  disposables.push(crystalCoreMat, coreGeo);

  // 8. Faceted Diamond-Quartz Blade (ExtrudeGeometry tapered prism)
  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(0, 0);
  bladeShape.lineTo(0.028, 0.06);
  bladeShape.lineTo(0.018, 0.62);
  bladeShape.lineTo(0, 0.76);
  bladeShape.lineTo(-0.018, 0.62);
  bladeShape.lineTo(-0.028, 0.06);
  bladeShape.closePath();

  const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, {
    depth: 0.012,
    bevelEnabled: true,
    bevelThickness: 0.008,
    bevelSize: 0.007,
    bevelSegments: 2,
  });
  bladeGeo.translate(0, 0, -0.006);

  const bladeMat = new THREE.MeshPhysicalMaterial({
    color: 0xdff8ff,
    emissive: new THREE.Color(WAVELENGTHS.visible.colorHex),
    emissiveIntensity: 0.45,
    roughness: 0.05,
    metalness: 0.05,
    ior: 2.1,
    transmission: isSoftwareGl ? 0 : 0.75,
    transparent: true,
    opacity: isSoftwareGl ? 0.65 : 0.94,
    iridescence: 0.95,
    clearcoat: 1.0,
  });
  const bladeMesh = new THREE.Mesh(bladeGeo, bladeMat);
  bladeMesh.position.y = 0.2;
  sabreModel.add(bladeMesh);
  disposables.push(bladeGeo, bladeMat);

  // 9. Inner Spectral Refractive Filament
  const filamentGeo = new THREE.CylinderGeometry(0.003, 0.007, 0.68, 6);
  const filamentMat = new THREE.MeshBasicMaterial({
    color: WAVELENGTHS.visible.colorHex,
    transparent: true,
    opacity: 0.92,
  });
  const filamentMesh = new THREE.Mesh(filamentGeo, filamentMat);
  filamentMesh.position.y = 0.55;
  sabreModel.add(filamentMesh);
  disposables.push(filamentGeo, filamentMat);

  // 10. Diegetic Harmonic Combo Orbiters (up to 6 floating crystal shards around guard)
  const comboOrbiterGroup = new THREE.Group();
  comboOrbiterGroup.position.y = 0.19;
  sabreModel.add(comboOrbiterGroup);
  const moteGeo = new THREE.OctahedronGeometry(0.007, 0);
  const moteMat = new THREE.MeshBasicMaterial({ color: 0xffe49e });
  disposables.push(moteGeo, moteMat);
  const comboMotes: THREE.Mesh[] = [];
  for (let i = 0; i < 6; i++) {
    const mote = new THREE.Mesh(moteGeo, moteMat);
    mote.visible = false;
    comboOrbiterGroup.add(mote);
    comboMotes.push(mote);
  }

  // Sweeping 3D Slash Arc Ribbon attached to camera root
  const slashGeo = new THREE.RingGeometry(0.45, 0.95, 28, 1, -Math.PI * 0.45, Math.PI * 0.9);
  const slashMat = new THREE.MeshBasicMaterial({
    color: WAVELENGTHS.visible.colorHex,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const slashRibbon = new THREE.Mesh(slashGeo, slashMat);
  slashRibbon.position.set(0, -0.05, -0.82);
  root.add(slashRibbon);
  disposables.push(slashGeo, slashMat);

  // Default sabre poise
  sabreModel.rotation.set(-0.36, -0.2, 0.14);

  // =========================================================================
  // LEFT HAND: MECHANICAL APERTURE GAUNTLET (Diyafram Eldiveni) — 14+ Parts
  // =========================================================================
  const gauntletPivot = new THREE.Group();
  gauntletPivot.position.set(-0.44, -0.32, -0.56);
  root.add(gauntletPivot);

  const gauntletModel = new THREE.Group();
  gauntletPivot.add(gauntletModel);

  // 1. Titanium Vambrace Forearm Shell
  const vambraceGeo = new THREE.CylinderGeometry(0.052, 0.062, 0.24, 8);
  const vambrace = new THREE.Mesh(vambraceGeo, mats.titanium);
  vambrace.rotation.x = Math.PI / 2;
  vambrace.position.z = 0.13;
  gauntletModel.add(vambrace);
  disposables.push(vambraceGeo);

  // 2. Sculpted Brass Knuckle / Wrist Frame
  const frameGeo = new THREE.TorusGeometry(0.068, 0.011, 10, 28);
  const frameRing = new THREE.Mesh(frameGeo, mats.brass);
  frameRing.position.z = -0.02;
  gauntletModel.add(frameRing);
  disposables.push(frameGeo);

  // 3. Copper Arc Winding Coils (3 rings along forearm)
  const coilGeo = new THREE.TorusGeometry(0.057, 0.0055, 8, 22);
  disposables.push(coilGeo);
  for (let i = 0; i < 3; i++) {
    const coil = new THREE.Mesh(coilGeo, mats.copperCoil);
    coil.position.z = 0.04 + i * 0.042;
    gauntletModel.add(coil);
  }

  // 4. Stepped Optical Objective Barrel (LatheGeometry)
  const barrelPoints = [
    new THREE.Vector2(0.048, -0.06),
    new THREE.Vector2(0.072, -0.05),
    new THREE.Vector2(0.076, 0.01),
    new THREE.Vector2(0.064, 0.02),
  ];
  const barrelGeo = new THREE.LatheGeometry(barrelPoints, 24);
  const barrelMesh = new THREE.Mesh(barrelGeo, mats.darkBrass);
  barrelMesh.rotation.x = Math.PI / 2;
  barrelMesh.position.z = -0.02;
  gauntletModel.add(barrelMesh);
  disposables.push(barrelGeo);

  // 5. Recessed Sapphire Focusing Lens
  const lensGeo = new THREE.SphereGeometry(0.046, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.45);
  const lensMesh = new THREE.Mesh(lensGeo, mats.sapphireLens);
  lensMesh.rotation.x = -Math.PI / 2;
  lensMesh.position.z = -0.02;
  gauntletModel.add(lensMesh);
  disposables.push(lensGeo);

  // 6. Central High-Voltage Arc Ring (Emissive Focus Indicator)
  const arcRingGeo = new THREE.TorusGeometry(0.036, 0.004, 8, 24);
  const arcRingMat = new THREE.MeshBasicMaterial({
    color: WAVELENGTHS.visible.colorHex,
    transparent: true,
    opacity: 0.75,
  });
  const arcRing = new THREE.Mesh(arcRingGeo, arcRingMat);
  arcRing.position.z = -0.042;
  gauntletModel.add(arcRing);
  disposables.push(arcRingGeo, arcRingMat);

  // 7. 10 Individually Articulated Brass Iris Diaphragm Blades (Diegetic Energy Gauge!)
  const irisBladeShape = new THREE.Shape();
  irisBladeShape.moveTo(0, 0);
  irisBladeShape.lineTo(0.048, -0.012);
  irisBladeShape.quadraticCurveTo(0.056, 0.026, 0.012, 0.042);
  irisBladeShape.closePath();

  const irisBladeGeo = new THREE.ExtrudeGeometry(irisBladeShape, {
    depth: 0.0028,
    bevelEnabled: false,
  });
  disposables.push(irisBladeGeo);

  const irisLeafPivots: THREE.Group[] = [];
  const irisCount = 10;
  for (let i = 0; i < irisCount; i++) {
    const angle = (i / irisCount) * Math.PI * 2;
    const pivot = new THREE.Group();
    pivot.position.set(Math.cos(angle) * 0.056, Math.sin(angle) * 0.056, -0.068 + i * 0.0002);
    pivot.rotation.z = angle + Math.PI * 0.55;

    const leaf = new THREE.Mesh(irisBladeGeo, i % 2 === 0 ? mats.brass : mats.darkBrass);
    pivot.add(leaf);
    gauntletModel.add(pivot);
    irisLeafPivots.push(pivot);
  }

  const muzzleMarker = new THREE.Object3D();
  muzzleMarker.position.set(0, 0, -0.09);
  gauntletModel.add(muzzleMarker);

  // =========================================================================
  // DIEGETIC VISOR LENS RIM & ETCHED CRYSTAL CRACKS (Visible on Damage)
  // =========================================================================
  const crackGroup = new THREE.Group();
  crackGroup.position.z = -0.32;
  root.add(crackGroup);

  const crackMat = new THREE.LineBasicMaterial({
    color: 0xdff6ff,
    transparent: true,
    opacity: 0.0,
    depthTest: false,
  });
  disposables.push(crackMat);

  const crackLines: THREE.Line[] = [];
  const crackAngles = [0.22, 0.78, 1.38, 2.1, 2.75, 3.45, 4.18, 5.1, 5.85];
  for (let i = 0; i < crackAngles.length; i++) {
    const a = crackAngles[i];
    const outerR = 0.24;
    const pts: THREE.Vector3[] = [];
    let r = outerR;
    let ang = a;
    for (let seg = 0; seg < 6; seg++) {
      pts.push(new THREE.Vector3(Math.cos(ang) * r, Math.sin(ang) * r * 0.62, 0));
      r -= 0.018 + (i % 3) * 0.004;
      ang += ((seg % 2 === 0 ? 1 : -1) * 0.075);
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(geo, crackMat);
    line.renderOrder = 100;
    crackGroup.add(line);
    crackLines.push(line);
    disposables.push(geo);
  }

  // Smooth internal state
  const targetColor = new THREE.Color();
  const currentColor = new THREE.Color(WAVELENGTHS.visible.colorHex);
  let smoothedIris = 1.0;

  return {
    root,
    sabrePivot,
    gauntletPivot,
    slashRibbon,
    getApertureMuzzleWorldPos: (out: THREE.Vector3) => {
      muzzleMarker.getWorldPosition(out);
      return out;
    },
    update: ({
      dt,
      elapsed,
      moveSpeedRatio,
      wavelength,
      photonEnergy,
      beamActive,
      slashTimer,
      slashComboStep,
      comboCount,
      visorDamage,
      recoil,
    }) => {
      const spec = WAVELENGTHS[wavelength];
      targetColor.setHex(spec.colorHex);
      currentColor.lerp(targetColor, 1 - Math.exp(-10 * dt));

      // Update Sabre Crystal Color & Glow
      crystalCoreMat.color.copy(currentColor);
      crystalCoreMat.emissive.copy(currentColor);
      bladeMat.emissive.copy(currentColor);
      filamentMat.color.copy(currentColor);
      arcRingMat.color.copy(currentColor);
      slashMat.color.copy(currentColor);

      // Gentle breathing + movement bob
      const bobX = Math.sin(elapsed * 5.4) * 0.011 * moveSpeedRatio;
      const bobY = Math.abs(Math.cos(elapsed * 5.4)) * 0.013 * moveSpeedRatio;
      const idleBreath = Math.sin(elapsed * 2.1) * 0.004;

      // Right-hand Sabre Slash Choreography (3 distinct directional arcs)
      if (slashTimer > 0) {
        const p = 1 - Math.min(1, slashTimer / 0.28);
        const swing = Math.sin(p * Math.PI);
        const dirSign = slashComboStep % 2 === 0 ? 1 : -1;
        const tilt = slashComboStep === 2 ? 0.08 : 0.48 * dirSign;

        sabrePivot.position.set(
          0.42 - swing * 0.38 * dirSign,
          -0.34 + swing * 0.14,
          -0.58 - swing * 0.22
        );
        sabreModel.rotation.set(
          -0.36 - swing * 1.15,
          -0.2 + swing * 1.35 * dirSign,
          0.14 + tilt + swing * 0.9 * dirSign
        );

        slashRibbon.visible = true;
        slashRibbon.rotation.set(0.25, 0, tilt + (p - 0.5) * 1.1 * dirSign);
        slashMat.opacity = Math.sin(p * Math.PI) * 0.72;
      } else {
        sabrePivot.position.set(
          THREE.MathUtils.damp(sabrePivot.position.x, 0.42 + bobX, 14, dt),
          THREE.MathUtils.damp(sabrePivot.position.y, -0.34 - bobY + idleBreath, 14, dt),
          THREE.MathUtils.damp(sabrePivot.position.z, -0.58, 14, dt)
        );
        sabreModel.rotation.x = THREE.MathUtils.damp(sabreModel.rotation.x, -0.36, 12, dt);
        sabreModel.rotation.y = THREE.MathUtils.damp(sabreModel.rotation.y, -0.2, 12, dt);
        sabreModel.rotation.z = THREE.MathUtils.damp(sabreModel.rotation.z, 0.14, 12, dt);
        slashRibbon.visible = false;
        slashMat.opacity = 0;
      }

      vernierA.rotation.z = elapsed * 0.8;
      vernierB.rotation.z = -elapsed * 1.25;

      // Combo motes orbiting crossguard
      const visibleMotes = Math.min(6, Math.floor(comboCount / 2));
      for (let i = 0; i < comboMotes.length; i++) {
        const m = comboMotes[i];
        m.visible = i < visibleMotes;
        if (m.visible) {
          const a = elapsed * 3.6 + (i * Math.PI * 2) / Math.max(1, visibleMotes);
          m.position.set(Math.cos(a) * 0.068, Math.sin(a * 1.5) * 0.02, Math.sin(a) * 0.068);
          m.rotation.y = elapsed * 4;
        }
      }

      // Left-hand Aperture Gauntlet recoil & forward aim
      const aimForward = beamActive ? 0.08 : 0.0;
      const shake = beamActive ? Math.sin(elapsed * 48) * 0.003 : 0;
      gauntletPivot.position.set(
        THREE.MathUtils.damp(gauntletPivot.position.x, -0.44 + bobX + aimForward * 0.6 + shake, 15, dt),
        THREE.MathUtils.damp(gauntletPivot.position.y, -0.32 - bobY + idleBreath + aimForward * 0.4, 15, dt),
        THREE.MathUtils.damp(gauntletPivot.position.z, -0.56 - aimForward + recoil * 0.06, 15, dt)
      );

      // Mechanical Brass Iris Blades: Open = High Energy, Closed = Depleted!
      smoothedIris = THREE.MathUtils.damp(smoothedIris, photonEnergy, 10, dt);
      const bladeSwing = THREE.MathUtils.lerp(0.05, 0.92, smoothedIris);
      for (let i = 0; i < irisLeafPivots.length; i++) {
        const baseA = (i / irisCount) * Math.PI * 2 + Math.PI * 0.55;
        irisLeafPivots[i].rotation.z = baseA - bladeSwing;
      }

      arcRingMat.opacity = beamActive ? 0.95 : 0.3 + photonEnergy * 0.5;
      arcRing.scale.setScalar(beamActive ? 1.12 + Math.sin(elapsed * 40) * 0.06 : 1.0);

      // Diegetic Visor Crystal Cracks
      const activeCracks = Math.floor(visorDamage * crackLines.length);
      crackMat.opacity = visorDamage > 0.05 ? Math.min(0.62, visorDamage * 0.72) : 0;
      for (let i = 0; i < crackLines.length; i++) {
        crackLines[i].visible = i < activeCracks;
      }
    },
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
}
