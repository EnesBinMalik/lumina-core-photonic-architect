import * as THREE from 'three';

export interface MaterialLibrary {
  brass: THREE.MeshPhysicalMaterial;
  darkBrass: THREE.MeshPhysicalMaterial;
  titanium: THREE.MeshPhysicalMaterial;
  silverMirror: THREE.MeshPhysicalMaterial;
  obsidianFloor: THREE.MeshStandardMaterial;
  obsidianStone: THREE.MeshStandardMaterial;
  quartzCrystal: THREE.MeshPhysicalMaterial;
  sapphireLens: THREE.MeshPhysicalMaterial;
  copperCoil: THREE.MeshStandardMaterial;
  hardLightBridge: THREE.MeshPhysicalMaterial;
  liquidLightShader: THREE.ShaderMaterial;
  createThermalArmorMaterial: () => THREE.MeshStandardMaterial;
  dispose: () => void;
}

function createBrushedMetalMaps(maxAnisotropy: number, baseHex: string, scratchAlpha: number) {
  const size = 256;
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = size;
  colorCanvas.height = size;
  const cctx = colorCanvas.getContext('2d')!;
  cctx.fillStyle = baseHex;
  cctx.fillRect(0, 0, size, size);

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = size;
  roughCanvas.height = size;
  const rctx = roughCanvas.getContext('2d')!;
  rctx.fillStyle = '#555555';
  rctx.fillRect(0, 0, size, size);

  // Hand-brushed lathe striations
  for (let y = 0; y < size; y++) {
    const tone = Math.floor(110 + (Math.sin(y * 0.7) * 0.5 + Math.random()) * 55);
    cctx.fillStyle = `rgba(255,245,220,${(Math.random() * scratchAlpha).toFixed(3)})`;
    cctx.fillRect(0, y, size, 1);
    rctx.fillStyle = `rgb(${tone},${tone},${tone})`;
    rctx.fillRect(0, y, size, 1);
  }

  // Subtle observatory concentric calibration hairline rings
  cctx.strokeStyle = 'rgba(20,16,10,0.12)';
  cctx.lineWidth = 1;
  for (let i = 16; i < size; i += 32) {
    cctx.beginPath();
    cctx.moveTo(0, i);
    cctx.lineTo(size, i);
    cctx.stroke();
  }

  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = maxAnisotropy;

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.colorSpace = THREE.NoColorSpace;
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.anisotropy = maxAnisotropy;

  return { map, roughnessMap };
}

function createObsidianDialFloorMaps(maxAnisotropy: number) {
  const size = 512;
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = size;
  colorCanvas.height = size;
  const ctx = colorCanvas.getContext('2d')!;

  ctx.fillStyle = '#0c1018';
  ctx.fillRect(0, 0, size, size);

  // Hand-chiseled slate stone grain
  for (let i = 0; i < 2400; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 1 + Math.random() * 2.5;
    const v = 14 + Math.floor(Math.random() * 14);
    ctx.fillStyle = `rgba(${v},${v + 4},${v + 12},0.38)`;
    ctx.fillRect(x, y, r, r);
  }

  // Precision brass optical vernier grid lines
  ctx.strokeStyle = 'rgba(182, 142, 72, 0.24)';
  ctx.lineWidth = 1.25;
  const step = 64;
  for (let i = 0; i <= size; i += step) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(size, i);
    ctx.stroke();
  }

  // Optical radial calibration circles
  ctx.strokeStyle = 'rgba(212, 175, 102, 0.18)';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, 180, 0, Math.PI * 2);
  ctx.stroke();

  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(8, 8);
  map.anisotropy = maxAnisotropy;

  // Normal-like bump texture
  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bctx = bumpCanvas.getContext('2d')!;
  bctx.fillStyle = '#808080';
  bctx.fillRect(0, 0, size, size);
  bctx.strokeStyle = '#383838';
  bctx.lineWidth = 2;
  for (let i = 0; i <= size; i += step) {
    bctx.beginPath();
    bctx.moveTo(i, 0);
    bctx.lineTo(i, size);
    bctx.stroke();
    bctx.beginPath();
    bctx.moveTo(0, i);
    bctx.lineTo(size, i);
    bctx.stroke();
  }
  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.colorSpace = THREE.NoColorSpace;
  bumpMap.wrapS = bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.repeat.set(8, 8);
  bumpMap.anisotropy = maxAnisotropy;

  return { map, bumpMap };
}

export function createMaterialLibrary(
  renderer: THREE.WebGLRenderer,
  isSoftwareGl: boolean
): MaterialLibrary {
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const disposables: Array<{ dispose: () => void }> = [];

  const brassMaps = createBrushedMetalMaps(maxAniso, '#c89b48', 0.14);
  const titaniumMaps = createBrushedMetalMaps(maxAniso, '#364152', 0.09);
  const floorMaps = createObsidianDialFloorMaps(maxAniso);

  disposables.push(
    brassMaps.map,
    brassMaps.roughnessMap,
    titaniumMaps.map,
    titaniumMaps.roughnessMap,
    floorMaps.map,
    floorMaps.bumpMap
  );

  const brass = new THREE.MeshPhysicalMaterial({
    color: 0xd9ad5b,
    map: brassMaps.map,
    roughnessMap: brassMaps.roughnessMap,
    metalness: 0.94,
    roughness: 0.22,
    anisotropy: 0.85,
    clearcoat: 0.35,
    clearcoatRoughness: 0.15,
  });

  const darkBrass = new THREE.MeshPhysicalMaterial({
    color: 0x705327,
    map: brassMaps.map,
    roughnessMap: brassMaps.roughnessMap,
    metalness: 0.9,
    roughness: 0.38,
    anisotropy: 0.65,
  });

  const titanium = new THREE.MeshPhysicalMaterial({
    color: 0x5c6b7e,
    map: titaniumMaps.map,
    roughnessMap: titaniumMaps.roughnessMap,
    metalness: 0.92,
    roughness: 0.28,
    anisotropy: 0.75,
  });

  const silverMirror = new THREE.MeshPhysicalMaterial({
    color: 0xeef5ff,
    metalness: 1.0,
    roughness: 0.04,
    clearcoat: 1.0,
    clearcoatRoughness: 0.03,
    envMapIntensity: 1.65,
  });

  const obsidianFloor = new THREE.MeshStandardMaterial({
    color: 0x1a2232,
    map: floorMaps.map,
    bumpMap: floorMaps.bumpMap,
    bumpScale: 0.06,
    roughness: 0.62,
    metalness: 0.22,
  });

  const obsidianStone = new THREE.MeshStandardMaterial({
    color: 0x141925,
    roughness: 0.76,
    metalness: 0.12,
  });

  const quartzCrystal = new THREE.MeshPhysicalMaterial({
    color: 0xd8f4ff,
    metalness: 0.02,
    roughness: 0.06,
    ior: 1.56,
    thickness: 1.4,
    transmission: isSoftwareGl ? 0 : 0.9,
    transparent: true,
    opacity: isSoftwareGl ? 0.52 : 1.0,
    iridescence: 0.75,
    iridescenceIOR: 1.35,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
    attenuationColor: new THREE.Color(0x9be6ff),
    attenuationDistance: 4.0,
    envMapIntensity: 1.5,
  });

  const sapphireLens = new THREE.MeshPhysicalMaterial({
    color: 0x8fe6ff,
    metalness: 0.0,
    roughness: 0.04,
    ior: 1.77,
    thickness: 0.9,
    transmission: isSoftwareGl ? 0 : 0.94,
    transparent: true,
    opacity: isSoftwareGl ? 0.58 : 1.0,
    clearcoat: 1.0,
    envMapIntensity: 1.7,
  });

  const copperCoil = new THREE.MeshStandardMaterial({
    color: 0xb8663a,
    metalness: 0.9,
    roughness: 0.28,
  });

  const hardLightBridge = new THREE.MeshPhysicalMaterial({
    color: 0x4be3ff,
    emissive: new THREE.Color(0x1680b8),
    emissiveIntensity: 0.75,
    metalness: 0.1,
    roughness: 0.12,
    transparent: true,
    opacity: 0.72,
    clearcoat: 1.0,
  });

  const liquidLightShader = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColorA: { value: new THREE.Color(0x18d8ff) },
      uColorB: { value: new THREE.Color(0xb875ff) },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewPos;
      void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vViewPos = -mvPos.xyz;
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewPos;
      void main() {
        vec3 viewDir = normalize(vViewPos);
        float fresnel = pow(1.0 - abs(dot(viewDir, vNormal)), 2.2);
        float flow1 = sin(vUv.x * 26.0 - uTime * 5.2) * 0.5 + 0.5;
        float flow2 = sin(vUv.x * 52.0 - uTime * 9.0 + vUv.y * 6.2831) * 0.5 + 0.5;
        float pulse = smoothstep(0.35, 0.95, flow1 * 0.65 + flow2 * 0.35);
        vec3 core = mix(uColorA, uColorB, sin(vUv.x * 8.0 - uTime * 2.0) * 0.5 + 0.5);
        vec3 col = core * (0.55 + pulse * 1.15) + vec3(0.85, 0.95, 1.0) * fresnel * 0.7;
        gl_FragColor = vec4(col, 0.78 + fresnel * 0.2);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  disposables.push(
    brass,
    darkBrass,
    titanium,
    silverMirror,
    obsidianFloor,
    obsidianStone,
    quartzCrystal,
    sapphireLens,
    copperCoil,
    hardLightBridge,
    liquidLightShader
  );

  // Thermal-expansion & wavelength fracture shader injection via onBeforeCompile
  const createThermalArmorMaterial = (): THREE.MeshStandardMaterial => {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x161922,
      roughness: 0.42,
      metalness: 0.78,
      flatShading: true,
    });
    const customUniforms = {
      uHeat: { value: 0.0 },
      uHeatColor: { value: new THREE.Color(0xff4b2b) },
      uTime: { value: 0.0 },
    };
    mat.userData.thermalUniforms = customUniforms;

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uHeat = customUniforms.uHeat;
      shader.uniforms.uHeatColor = customUniforms.uHeatColor;
      shader.uniforms.uTime = customUniforms.uTime;

      shader.vertexShader =
        `
        uniform float uHeat;
        uniform float uTime;
        varying vec3 vLocalPos;
        ` +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          `
          #include <begin_vertex>
          vLocalPos = position;
          float expand = uHeat * 0.095 * (1.0 + 0.25 * sin(uTime * 18.0 + position.y * 6.0));
          transformed += normal * expand;
          `
        );

      shader.fragmentShader =
        `
        uniform float uHeat;
        uniform vec3 uHeatColor;
        varying vec3 vLocalPos;
        ` +
        shader.fragmentShader.replace(
          '#include <emissivemap_fragment>',
          `
          #include <emissivemap_fragment>
          float vein = abs(sin(vLocalPos.x * 13.0 + vLocalPos.y * 9.0) * cos(vLocalPos.z * 11.0 - vLocalPos.y * 7.0));
          float crack = smoothstep(0.16, 0.02, vein);
          totalEmissiveRadiance += uHeatColor * crack * uHeat * 3.2;
          `
        );
    };

    return mat;
  };

  return {
    brass,
    darkBrass,
    titanium,
    silverMirror,
    obsidianFloor,
    obsidianStone,
    quartzCrystal,
    sapphireLens,
    copperCoil,
    hardLightBridge,
    liquidLightShader,
    createThermalArmorMaterial,
    dispose: () => {
      for (const item of disposables) {
        item.dispose();
      }
    },
  };
}
