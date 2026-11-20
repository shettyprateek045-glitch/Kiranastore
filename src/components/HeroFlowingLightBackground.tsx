import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

function detectSoftwareGl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

interface RibbonConfig {
  yOffset: number;
  zOffset: number;
  width: number;
  ampY: number;
  ampZ: number;
  freq: number;
  speed: number;
  phase: number;
  twist: number;
  colorMix: number; // 0 = emerald/neon green, 0.5 = turquoise/cyan, 1 = electric blue/cyan
  strands: number;
  opacity: number;
}

const RIBBON_CONFIGS: RibbonConfig[] = [
  // Primary wide luminous ribbons weaving across the hero focal corridor
  { yOffset: 0.0, zOffset: 0.0, width: 1.55, ampY: 1.35, ampZ: 1.2, freq: 0.36, speed: 0.34, phase: 0.0, twist: 1.45, colorMix: 0.35, strands: 7.0, opacity: 0.85 },
  { yOffset: 0.45, zOffset: -0.6, width: 1.35, ampY: 1.55, ampZ: 1.35, freq: 0.31, speed: 0.28, phase: 1.15, twist: -1.25, colorMix: 0.65, strands: 6.0, opacity: 0.8 },
  { yOffset: -0.5, zOffset: 0.5, width: 1.25, ampY: 1.15, ampZ: 1.0, freq: 0.4, speed: 0.38, phase: 2.35, twist: 1.6, colorMix: 0.12, strands: 8.0, opacity: 0.78 },
  { yOffset: 0.85, zOffset: -1.4, width: 1.75, ampY: 1.8, ampZ: 1.5, freq: 0.27, speed: 0.24, phase: 3.4, twist: -0.95, colorMix: 0.82, strands: 5.0, opacity: 0.66 },
  { yOffset: -0.95, zOffset: -1.1, width: 1.5, ampY: 1.45, ampZ: 1.1, freq: 0.33, speed: 0.3, phase: 4.7, twist: 1.1, colorMix: 0.48, strands: 6.0, opacity: 0.7 },
  // Fine secondary neural fiber strands
  { yOffset: 0.18, zOffset: 0.35, width: 0.62, ampY: 1.28, ampZ: 0.95, freq: 0.42, speed: 0.42, phase: 0.55, twist: 2.1, colorMix: 0.22, strands: 4.0, opacity: 0.9 },
  { yOffset: -0.22, zOffset: -0.25, width: 0.58, ampY: 1.42, ampZ: 1.15, freq: 0.38, speed: 0.36, phase: 1.85, twist: -1.85, colorMix: 0.58, strands: 4.0, opacity: 0.88 },
  { yOffset: 1.35, zOffset: -2.2, width: 1.9, ampY: 2.0, ampZ: 1.4, freq: 0.24, speed: 0.21, phase: 5.2, twist: 0.8, colorMix: 0.9, strands: 5.0, opacity: 0.48 },
  { yOffset: -1.3, zOffset: -2.0, width: 1.85, ampY: 1.75, ampZ: 1.3, freq: 0.26, speed: 0.23, phase: 2.9, twist: -0.85, colorMix: 0.08, strands: 5.0, opacity: 0.52 },
  // Thin bright foreground accent strands
  { yOffset: 0.3, zOffset: 1.0, width: 0.42, ampY: 1.05, ampZ: 0.85, freq: 0.46, speed: 0.45, phase: 3.95, twist: 2.4, colorMix: 0.42, strands: 3.0, opacity: 0.72 },
  { yOffset: -0.65, zOffset: 0.9, width: 0.46, ampY: 1.18, ampZ: 0.9, freq: 0.44, speed: 0.4, phase: 0.9, twist: -2.2, colorMix: 0.72, strands: 3.0, opacity: 0.68 },
  // Deep background atmospheric silk waves
  { yOffset: 0.1, zOffset: -3.4, width: 2.6, ampY: 2.2, ampZ: 1.2, freq: 0.21, speed: 0.18, phase: 1.6, twist: 0.65, colorMix: 0.78, strands: 4.0, opacity: 0.36 },
  { yOffset: -0.4, zOffset: -3.8, width: 2.8, ampY: 2.1, ampZ: 1.1, freq: 0.19, speed: 0.16, phase: 4.1, twist: -0.6, colorMix: 0.18, strands: 4.0, opacity: 0.34 },
];

// Shared GLSL wave curve formula so ribbons & ribbon-bound particles stay locked in 3D space
const WAVE_PATH_GLSL = /* glsl */ `
vec3 computeRibbonPoint(
  float u,
  float uTime,
  float yOffset,
  float zOffset,
  float ampY,
  float ampZ,
  float freq,
  float speed,
  float phase,
  vec2 mouse
) {
  // Span horizontally across wide viewport (-13.5 .. +13.5) with graceful diagonal lift
  float x = (u - 0.5) * 27.0;

  // Focal convergence pinch near x = +2.2 (central glowing AI node)
  float distToCore = (u - 0.58);
  float pinch = 0.28 + 0.72 * smoothstep(0.0, 0.38, abs(distToCore));

  float wavePhase = x * freq - uTime * speed + phase;
  float secondaryPhase = x * (freq * 0.58) + uTime * (speed * 0.65) - phase * 0.7;

  float diagonalSweep = (u - 0.5) * 2.1;
  float y =
    yOffset * pinch +
    diagonalSweep +
    sin(wavePhase) * ampY * pinch +
    cos(secondaryPhase) * (ampY * 0.35) * pinch +
    mouse.y * 0.45 * (0.4 + abs(distToCore));

  float z =
    zOffset * pinch +
    cos(wavePhase * 0.88 + 0.6) * ampZ * pinch +
    sin(secondaryPhase * 1.15) * (ampZ * 0.32) +
    mouse.x * 0.35;

  return vec3(x, y, z);
}
`;

const RIBBON_VERTEX_SHADER = /* glsl */ `
uniform float uTime;
uniform vec2 uMouse;
uniform float uYOffset;
uniform float uZOffset;
uniform float uWidth;
uniform float uAmpY;
uniform float uAmpZ;
uniform float uFreq;
uniform float uSpeed;
uniform float uPhase;
uniform float uTwist;

varying vec2 vUv;
varying float vDepth;
varying float vCoreProximity;

${WAVE_PATH_GLSL}

void main() {
  vUv = uv;
  float u = uv.x;
  float v = uv.y - 0.5; // -0.5 .. +0.5 across ribbon width

  vec3 center = computeRibbonPoint(
    u, uTime, uYOffset, uZOffset, uAmpY, uAmpZ, uFreq, uSpeed, uPhase, uMouse
  );
  vec3 ahead = computeRibbonPoint(
    min(1.0, u + 0.006), uTime, uYOffset, uZOffset, uAmpY, uAmpZ, uFreq, uSpeed, uPhase, uMouse
  );

  vec3 tangent = normalize(ahead - center);
  vec3 worldUp = vec3(0.0, 1.0, 0.0);
  vec3 side = normalize(cross(tangent, worldUp));
  vec3 up = normalize(cross(side, tangent));

  // Organic flowing twist along ribbon length
  float twistAngle = u * 6.28318 * uTwist + uTime * (uSpeed * 0.9) + uPhase;
  vec3 twistedBinormal = side * cos(twistAngle) + up * sin(twistAngle);

  // Subtle ribbon taper at ends and gentle pinch near central focal energy point
  float endTaper = smoothstep(0.0, 0.14, u) * smoothstep(1.0, 0.86, u);
  float corePinch = 0.55 + 0.45 * smoothstep(0.0, 0.28, abs(u - 0.58));
  float halfWidth = uWidth * endTaper * corePinch;

  vec3 displaced = center + twistedBinormal * (v * halfWidth);

  vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);
  vDepth = -mvPosition.z;
  vCoreProximity = exp(-pow((u - 0.58) * 4.2, 2.0));

  gl_Position = projectionMatrix * mvPosition;
}
`;

const RIBBON_FRAGMENT_SHADER = /* glsl */ `
uniform float uTime;
uniform float uColorMix;
uniform float uStrands;
uniform float uOpacity;
uniform float uSpeed;
uniform float uPhase;

varying vec2 vUv;
varying float vDepth;
varying float vCoreProximity;

void main() {
  float across = abs(vUv.y - 0.5) * 2.0; // 0 at center, 1 at edge

  // Subtle optical depth-of-field blur (focus plane around z ~ 11.5)
  float dofFactor = clamp(abs(vDepth - 11.5) / 10.5, 0.0, 1.0);
  float edgeSoftness = mix(1.0, 0.62, dofFactor);

  // Smooth gaussian ribbon envelope
  float bodyGlow = exp(-across * across * mix(4.2, 2.2, dofFactor));

  // Multiple thin luminous neural fiber strands flowing inside the ribbon
  float strandWave = 0.5 + 0.5 * sin(
    vUv.y * 3.14159 * uStrands * 2.0 + sin(vUv.x * 8.0 - uTime * uSpeed * 1.6 + uPhase) * 1.4
  );
  float fineStrands = pow(strandWave, mix(5.5, 2.6, dofFactor)) * (1.0 - smoothstep(0.55, 1.0, across));
  float centerCore = exp(-across * across * 24.0);

  // Traveling energy light pulses streaming along the ribbon
  float flowPulse1 = 0.5 + 0.5 * sin(vUv.x * 16.0 - uTime * (uSpeed * 3.8) + uPhase * 2.0);
  float flowPulse2 = 0.5 + 0.5 * sin(vUv.x * 9.0 - uTime * (uSpeed * 2.2) - uPhase);
  float pulseBoost = 0.68 + 0.45 * pow(flowPulse1, 3.0) + 0.25 * flowPulse2;

  // Agritech AI color palette: Emerald -> Neon Green -> Turquoise -> Cyan -> Electric Blue
  vec3 emerald = vec3(0.06, 0.73, 0.50);
  vec3 neonGreen = vec3(0.18, 0.98, 0.58);
  vec3 turquoise = vec3(0.08, 0.82, 0.76);
  vec3 cyan = vec3(0.05, 0.90, 1.00);
  vec3 electricBlue = vec3(0.11, 0.46, 1.00);

  float colorFlow = fract(uColorMix + vUv.x * 0.36 - uTime * 0.035);
  vec3 ribbonCol = mix(emerald, turquoise, smoothstep(0.0, 0.35, colorFlow));
  ribbonCol = mix(ribbonCol, cyan, smoothstep(0.32, 0.68, colorFlow));
  ribbonCol = mix(ribbonCol, electricBlue, smoothstep(0.65, 1.0, colorFlow));

  // Infuse subtle neon-green highlight on inner filaments & cyan-white near center energy point
  vec3 strandCol = mix(neonGreen, cyan, clamp(uColorMix + 0.2, 0.0, 1.0));
  vec3 finalCol = mix(ribbonCol, strandCol, fineStrands * 0.65 + centerCore * 0.45);
  finalCol += vec3(0.55, 0.98, 1.0) * (centerCore * 0.55 + vCoreProximity * 0.5);

  // Fade ribbon tips smoothly into darkness
  float endFade = smoothstep(0.0, 0.16, vUv.x) * smoothstep(1.0, 0.84, vUv.x);

  float intensity = (bodyGlow * 0.42 + fineStrands * 0.95 + centerCore * 0.72) * pulseBoost;
  float alpha = intensity * endFade * uOpacity * edgeSoftness;

  gl_FragColor = vec4(finalCol * alpha * 1.35, alpha);
}
`;

// Ribbon-following GPU particles vertex & fragment shaders
const FLOW_PARTICLE_VERTEX_SHADER = /* glsl */ `
uniform float uTime;
uniform vec2 uMouse;
uniform float uPixelRatio;

attribute float aProgress;
attribute float aSpeed;
attribute float aSize;
attribute float aOffsetY;
attribute float aOffsetZ;
attribute float aRibbonY;
attribute float aRibbonZ;
attribute float aAmpY;
attribute float aAmpZ;
attribute float aFreq;
attribute float aRibbonSpeed;
attribute float aPhase;
attribute float aColorMix;

varying float vColorMix;
varying float vAlpha;
varying float vDof;

${WAVE_PATH_GLSL}

void main() {
  float u = fract(aProgress + uTime * aSpeed);
  vec3 basePos = computeRibbonPoint(
    u, uTime, aRibbonY, aRibbonZ, aAmpY, aAmpZ, aFreq, aRibbonSpeed, aPhase, uMouse
  );

  // Gentle orbital drift around the parent ribbon
  float swirl = uTime * 1.4 + aPhase * 3.0 + u * 12.0;
  vec3 pos = basePos + vec3(
    sin(swirl * 0.7) * 0.12,
    aOffsetY + cos(swirl) * 0.14,
    aOffsetZ + sin(swirl) * 0.14
  );

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  float depth = max(1.5, -mvPosition.z);

  vDof = clamp(abs(depth - 11.5) / 10.0, 0.0, 1.0);
  vColorMix = aColorMix;

  float endFade = smoothstep(0.0, 0.1, u) * smoothstep(1.0, 0.9, u);
  float twinkle = 0.65 + 0.35 * sin(uTime * 3.2 + aPhase * 11.0);
  vAlpha = endFade * twinkle * mix(1.0, 0.58, vDof);

  // Perspective size attenuation + slight bokeh expansion out of focus
  float dofGrow = mix(1.0, 1.65, vDof);
  gl_PointSize = clamp(aSize * uPixelRatio * dofGrow * (14.0 / depth), 1.5, 42.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const PARTICLE_FRAGMENT_SHADER = /* glsl */ `
varying float vColorMix;
varying float vAlpha;
varying float vDof;

void main() {
  vec2 c = gl_PointCoord - vec2(0.5);
  float dist = length(c);
  if (dist > 0.5) discard;

  // Crisp glowing dot in focus, softer bokeh halo when out of focus
  float core = exp(-dist * dist * mix(28.0, 9.0, vDof));
  float halo = exp(-dist * dist * mix(8.5, 4.2, vDof));

  vec3 emerald = vec3(0.14, 0.96, 0.58);
  vec3 cyan = vec3(0.08, 0.94, 1.00);
  vec3 electricBlue = vec3(0.24, 0.62, 1.00);

  vec3 col = mix(emerald, cyan, smoothstep(0.0, 0.55, vColorMix));
  col = mix(col, electricBlue, smoothstep(0.55, 1.0, vColorMix));
  col += vec3(0.75, 1.0, 1.0) * core * 0.85;

  float alpha = (core * 0.95 + halo * 0.45) * vAlpha;
  gl_FragColor = vec4(col * alpha * 1.4, alpha);
}
`;

// Ambient floating bokeh sparkles vertex shader
const AMBIENT_PARTICLE_VERTEX_SHADER = /* glsl */ `
uniform float uTime;
uniform vec2 uMouse;
uniform float uPixelRatio;

attribute float aSize;
attribute float aPhase;
attribute float aSpeed;
attribute float aColorMix;

varying float vColorMix;
varying float vAlpha;
varying float vDof;

void main() {
  vec3 pos = position;
  pos.x += sin(uTime * aSpeed * 0.45 + aPhase) * 0.65 + uMouse.x * (0.2 + pos.z * 0.04);
  pos.y += cos(uTime * aSpeed * 0.38 + aPhase * 1.3) * 0.55 + uMouse.y * 0.25;
  pos.z += sin(uTime * aSpeed * 0.3 + aPhase * 0.7) * 0.45;

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  float depth = max(2.0, -mvPosition.z);

  vDof = clamp(abs(depth - 11.5) / 9.5, 0.0, 1.0);
  vColorMix = aColorMix;

  float sparkle = 0.45 + 0.55 * pow(0.5 + 0.5 * sin(uTime * (1.8 + aSpeed) + aPhase * 5.0), 2.0);
  vAlpha = sparkle * mix(0.85, 0.45, vDof);

  float dofGrow = mix(1.0, 1.8, vDof);
  gl_PointSize = clamp(aSize * uPixelRatio * dofGrow * (13.0 / depth), 1.5, 38.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

// Central pulsing AI energy core shader
const ENERGY_CORE_VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const ENERGY_CORE_FRAGMENT_SHADER = /* glsl */ `
uniform float uTime;
varying vec2 vUv;

void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  if (r > 1.0) discard;

  float pulse = 0.88 + 0.14 * sin(uTime * 1.4) + 0.06 * cos(uTime * 2.7);
  float angle = atan(p.y, p.x);

  // Incandescent center + soft plasma aura + subtle anamorphic light flare
  float innerStar = exp(-r * r * (26.0 / pulse));
  float midHalo = exp(-r * r * (5.2 / pulse));
  float outerAura = exp(-r * r * 1.85) * (1.0 - smoothstep(0.65, 1.0, r));
  float rays = pow(0.5 + 0.5 * cos(angle * 4.0 + uTime * 0.25), 6.0) * exp(-r * 3.8) * 0.35;
  float horizontalFlare = exp(-abs(p.y) * 18.0) * exp(-abs(p.x) * 2.6) * 0.48 * pulse;

  vec3 emerald = vec3(0.10, 0.92, 0.58);
  vec3 cyan = vec3(0.10, 0.94, 1.00);
  vec3 blue = vec3(0.16, 0.52, 1.00);
  vec3 coreWhite = vec3(0.88, 1.00, 1.00);

  vec3 col =
    outerAura * mix(emerald, blue, 0.55) * 0.52 +
    midHalo * mix(emerald, cyan, 0.65) * 0.95 +
    (innerStar + horizontalFlare + rays) * coreWhite * 1.25;

  float alpha = clamp((innerStar + midHalo * 0.72 + outerAura * 0.42 + horizontalFlare + rays), 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`;

function createRibbonGeometry(lengthSegments: number, widthSegments: number): THREE.BufferGeometry {
  const geom = new THREE.PlaneGeometry(1, 1, lengthSegments, widthSegments);
  return geom;
}

export default function HeroFlowingLightBackground() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [fallbackCss, setFallbackCss] = useState(false);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareGl();
    const isMobile = window.innerWidth < 768;
    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let prefersReducedMotion = reducedMotionQuery.matches;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl && !isMobile,
        alpha: true,
        powerPreference: 'high-performance',
      });
    } catch {
      setFallbackCss(true);
      return;
    }

    const width = Math.max(1, container.clientWidth || window.innerWidth);
    const height = Math.max(1, container.clientHeight || 640);
    const pixelRatio = isSoftwareGl
      ? 1
      : Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2);

    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.setClearColor(0x06140d, 1);

    container.innerHTML = '';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(46, width / height, 0.1, 100);
    const baseCamPos = new THREE.Vector3(0, 0.15, 11.8);
    camera.position.copy(baseCamPos);
    camera.lookAt(0.6, 0.05, 0);

    // Optional GPU Bloom Post-Processing (skipped on software WebGL per Three.js perf rules)
    let composer: EffectComposer | null = null;
    let bloomPass: UnrealBloomPass | null = null;
    if (!isSoftwareGl) {
      composer = new EffectComposer(renderer);
      const renderPass = new RenderPass(scene, camera);
      composer.addPass(renderPass);

      const bloomScale = isMobile ? 0.45 : 0.65;
      bloomPass = new UnrealBloomPass(
        new THREE.Vector2(Math.max(1, Math.floor(width * bloomScale)), Math.max(1, Math.floor(height * bloomScale))),
        isMobile ? 0.65 : 0.92, // strength
        0.62, // radius
        0.18 // threshold
      );
      composer.addPass(bloomPass);
    }

    // Shared mutable uniforms (zero allocation in render loop)
    const uMouse = new THREE.Vector2(0, 0);
    const activeRibbons = isMobile ? RIBBON_CONFIGS.slice(0, 8) : RIBBON_CONFIGS;

    // 1. Flowing GLSL Light Ribbons
    const ribbonGroup = new THREE.Group();
    const ribbonMaterials: THREE.ShaderMaterial[] = [];
    const sharedRibbonGeom = createRibbonGeometry(isMobile ? 84 : 156, 6);

    for (const cfg of activeRibbons) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uMouse: { value: uMouse },
          uYOffset: { value: cfg.yOffset },
          uZOffset: { value: cfg.zOffset },
          uWidth: { value: cfg.width },
          uAmpY: { value: cfg.ampY },
          uAmpZ: { value: cfg.ampZ },
          uFreq: { value: cfg.freq },
          uSpeed: { value: cfg.speed },
          uPhase: { value: cfg.phase },
          uTwist: { value: cfg.twist },
          uColorMix: { value: cfg.colorMix },
          uStrands: { value: cfg.strands },
          uOpacity: { value: cfg.opacity },
        },
        vertexShader: RIBBON_VERTEX_SHADER,
        fragmentShader: RIBBON_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(sharedRibbonGeom, mat);
      mesh.frustumCulled = false;
      ribbonMaterials.push(mat);
      ribbonGroup.add(mesh);
    }
    scene.add(ribbonGroup);

    // 2. Central Pulsing Glowing Energy Point (at ribbon convergence vortex)
    const coreGeom = new THREE.PlaneGeometry(5.8, 5.8);
    const coreMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader: ENERGY_CORE_VERTEX_SHADER,
      fragmentShader: ENERGY_CORE_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const coreMesh = new THREE.Mesh(coreGeom, coreMat);
    coreMesh.position.set(2.15, 0.22, -0.35);
    scene.add(coreMesh);

    // 3. GPU Ribbon-Streaming Particle System
    const flowCount = isMobile ? 340 : 880;
    const flowGeom = new THREE.BufferGeometry();
    const flowPositions = new Float32Array(flowCount * 3);
    const aProgress = new Float32Array(flowCount);
    const aSpeed = new Float32Array(flowCount);
    const aSize = new Float32Array(flowCount);
    const aOffsetY = new Float32Array(flowCount);
    const aOffsetZ = new Float32Array(flowCount);
    const aRibbonY = new Float32Array(flowCount);
    const aRibbonZ = new Float32Array(flowCount);
    const aAmpY = new Float32Array(flowCount);
    const aAmpZ = new Float32Array(flowCount);
    const aFreq = new Float32Array(flowCount);
    const aRibbonSpeed = new Float32Array(flowCount);
    const aPhase = new Float32Array(flowCount);
    const aColorMix = new Float32Array(flowCount);

    for (let i = 0; i < flowCount; i++) {
      const cfg = activeRibbons[i % activeRibbons.length];
      aProgress[i] = Math.random();
      aSpeed[i] = 0.025 + Math.random() * 0.055;
      aSize[i] = 2.4 + Math.pow(Math.random(), 2.2) * 8.5;
      aOffsetY[i] = (Math.random() - 0.5) * cfg.width * 0.72;
      aOffsetZ[i] = (Math.random() - 0.5) * 0.65;
      aRibbonY[i] = cfg.yOffset;
      aRibbonZ[i] = cfg.zOffset;
      aAmpY[i] = cfg.ampY;
      aAmpZ[i] = cfg.ampZ;
      aFreq[i] = cfg.freq;
      aRibbonSpeed[i] = cfg.speed;
      aPhase[i] = cfg.phase;
      aColorMix[i] = Math.min(1, Math.max(0, cfg.colorMix + (Math.random() - 0.5) * 0.35));
    }

    flowGeom.setAttribute('position', new THREE.BufferAttribute(flowPositions, 3));
    flowGeom.setAttribute('aProgress', new THREE.BufferAttribute(aProgress, 1));
    flowGeom.setAttribute('aSpeed', new THREE.BufferAttribute(aSpeed, 1));
    flowGeom.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1));
    flowGeom.setAttribute('aOffsetY', new THREE.BufferAttribute(aOffsetY, 1));
    flowGeom.setAttribute('aOffsetZ', new THREE.BufferAttribute(aOffsetZ, 1));
    flowGeom.setAttribute('aRibbonY', new THREE.BufferAttribute(aRibbonY, 1));
    flowGeom.setAttribute('aRibbonZ', new THREE.BufferAttribute(aRibbonZ, 1));
    flowGeom.setAttribute('aAmpY', new THREE.BufferAttribute(aAmpY, 1));
    flowGeom.setAttribute('aAmpZ', new THREE.BufferAttribute(aAmpZ, 1));
    flowGeom.setAttribute('aFreq', new THREE.BufferAttribute(aFreq, 1));
    flowGeom.setAttribute('aRibbonSpeed', new THREE.BufferAttribute(aRibbonSpeed, 1));
    flowGeom.setAttribute('aPhase', new THREE.BufferAttribute(aPhase, 1));
    flowGeom.setAttribute('aColorMix', new THREE.BufferAttribute(aColorMix, 1));

    const flowParticleMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMouse: { value: uMouse },
        uPixelRatio: { value: pixelRatio },
      },
      vertexShader: FLOW_PARTICLE_VERTEX_SHADER,
      fragmentShader: PARTICLE_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const flowPoints = new THREE.Points(flowGeom, flowParticleMat);
    flowPoints.frustumCulled = false;
    scene.add(flowPoints);

    // 4. Ambient Floating Sparkling Depth-of-Field Dust
    const ambientCount = isMobile ? 140 : 380;
    const ambientGeom = new THREE.BufferGeometry();
    const ambPositions = new Float32Array(ambientCount * 3);
    const ambSize = new Float32Array(ambientCount);
    const ambPhase = new Float32Array(ambientCount);
    const ambSpeed = new Float32Array(ambientCount);
    const ambColor = new Float32Array(ambientCount);

    for (let i = 0; i < ambientCount; i++) {
      ambPositions[i * 3] = (Math.random() - 0.5) * 26.0;
      ambPositions[i * 3 + 1] = (Math.random() - 0.5) * 11.5;
      ambPositions[i * 3 + 2] = -6.0 + Math.random() * 10.5;
      ambSize[i] = 1.8 + Math.pow(Math.random(), 2.5) * 7.5;
      ambPhase[i] = Math.random() * Math.PI * 2;
      ambSpeed[i] = 0.4 + Math.random() * 0.9;
      ambColor[i] = Math.random();
    }

    ambientGeom.setAttribute('position', new THREE.BufferAttribute(ambPositions, 3));
    ambientGeom.setAttribute('aSize', new THREE.BufferAttribute(ambSize, 1));
    ambientGeom.setAttribute('aPhase', new THREE.BufferAttribute(ambPhase, 1));
    ambientGeom.setAttribute('aSpeed', new THREE.BufferAttribute(ambSpeed, 1));
    ambientGeom.setAttribute('aColorMix', new THREE.BufferAttribute(ambColor, 1));

    const ambientMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMouse: { value: uMouse },
        uPixelRatio: { value: pixelRatio },
      },
      vertexShader: AMBIENT_PARTICLE_VERTEX_SHADER,
      fragmentShader: PARTICLE_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const ambientPoints = new THREE.Points(ambientGeom, ambientMat);
    ambientPoints.frustumCulled = false;
    scene.add(ambientPoints);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // Subtle pointer parallax (never blocks clicks/scroll since container is pointer-events-none)
    const mouseTarget = new THREE.Vector2(0, 0);
    const onPointerMove = (e: PointerEvent) => {
      const nx = (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
      const ny = -((e.clientY / Math.max(1, window.innerHeight)) * 2 - 1);
      mouseTarget.set(
        THREE.MathUtils.clamp(nx, -1, 1),
        THREE.MathUtils.clamp(ny, -1, 1)
      );
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });

    // Responsive sizing via ResizeObserver
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.max(1, Math.floor(entry.contentRect.width));
        const h = Math.max(1, Math.floor(entry.contentRect.height));
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
        if (composer) {
          composer.setSize(w, h);
        }
        if (bloomPass) {
          const bloomScale = w < 768 ? 0.45 : 0.65;
          bloomPass.resolution.set(
            Math.max(1, Math.floor(w * bloomScale)),
            Math.max(1, Math.floor(h * bloomScale))
          );
        }
      }
    });
    resizeObserver.observe(container);

    // Pause when scrolled off-screen or browser tab is hidden
    let isVisible = true;
    let isTabVisible = !document.hidden;
    let disposed = false;
    let frameId = 0;
    let timerId = 0;

    const clock = new THREE.Clock();
    let elapsed = 4.2; // Start at an already-flowing organic phase

    const lookAtTarget = new THREE.Vector3(0.6, 0.05, 0);

    const renderFrame = (dt: number) => {
      if (!prefersReducedMotion) {
        elapsed += Math.min(dt, 0.05);
      }

      // Smooth exponential damping for mouse parallax
      uMouse.x = THREE.MathUtils.damp(uMouse.x, mouseTarget.x, 2.4, Math.min(dt, 0.05));
      uMouse.y = THREE.MathUtils.damp(uMouse.y, mouseTarget.y, 2.4, Math.min(dt, 0.05));

      // Gentle camera parallax & organic breathing drift
      const driftX = Math.sin(elapsed * 0.16) * 0.32;
      const driftY = Math.cos(elapsed * 0.13) * 0.2;
      camera.position.x = baseCamPos.x + uMouse.x * 0.85 + driftX;
      camera.position.y = baseCamPos.y + uMouse.y * 0.55 + driftY;
      camera.lookAt(lookAtTarget);

      // Keep central glowing energy point facing camera & subtly pulsing
      coreMesh.position.x = 2.15 + uMouse.x * 0.25;
      coreMesh.position.y = 0.22 + uMouse.y * 0.2 + Math.sin(elapsed * 0.45) * 0.12;
      coreMesh.lookAt(camera.position);

      for (let i = 0; i < ribbonMaterials.length; i++) {
        ribbonMaterials[i].uniforms.uTime.value = elapsed;
      }
      coreMat.uniforms.uTime.value = elapsed;
      flowParticleMat.uniforms.uTime.value = elapsed;
      ambientMat.uniforms.uTime.value = elapsed;

      if (composer && !isSoftwareGl) {
        composer.render();
      } else {
        renderer.render(scene, camera);
      }
    };

    const afterDraw = (cb: () => void) => {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (typeof gl.fenceSync === 'function') {
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        const poll = () => {
          if (disposed) {
            if (sync) gl.deleteSync(sync);
            return;
          }
          const state = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
          if (state === gl.UNSIGNALED) {
            timerId = window.setTimeout(poll, 5);
          } else {
            if (sync) gl.deleteSync(sync);
            timerId = window.setTimeout(cb, 80);
          }
        };
        timerId = window.setTimeout(poll, 5);
      } else {
        timerId = window.setTimeout(cb, 80);
      }
    };

    const scheduleNext = () => {
      if (disposed || prefersReducedMotion || !isVisible || !isTabVisible) return;
      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    };

    const tick = () => {
      if (disposed || !isVisible || !isTabVisible) return;
      const dt = clock.getDelta();
      renderFrame(dt);
      scheduleNext();
    };

    const startOrStopLoop = () => {
      cancelAnimationFrame(frameId);
      clearTimeout(timerId);
      if (disposed) return;

      if (prefersReducedMotion) {
        renderFrame(0);
        return;
      }

      if (isVisible && isTabVisible) {
        clock.getDelta(); // reset delta after pause so ribbons never jump
        tick();
      }
    };

    const intersectionObserver = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        const nextVis = entry.isIntersecting;
        if (nextVis !== isVisible) {
          isVisible = nextVis;
          startOrStopLoop();
        }
      },
      { threshold: 0.02 }
    );
    intersectionObserver.observe(container);

    const onVisibilityChange = () => {
      isTabVisible = !document.hidden;
      startOrStopLoop();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    const onMotionPrefChange = (e: MediaQueryListEvent) => {
      prefersReducedMotion = e.matches;
      startOrStopLoop();
    };
    reducedMotionQuery.addEventListener('change', onMotionPrefChange);

    // Kick off rendering
    startOrStopLoop();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(timerId);
      window.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      reducedMotionQuery.removeEventListener('change', onMotionPrefChange);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();

      sharedRibbonGeom.dispose();
      ribbonMaterials.forEach((m) => m.dispose());
      coreGeom.dispose();
      coreMat.dispose();
      flowGeom.dispose();
      flowParticleMat.dispose();
      ambientGeom.dispose();
      ambientMat.dispose();
      if (bloomPass) bloomPass.dispose();
      if (composer) composer.dispose();
      renderer.dispose();

      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  if (fallbackCss) {
    return (
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
        style={{
          background:
            'radial-gradient(55% 65% at 62% 45%, rgba(6, 230, 255, 0.22) 0%, rgba(16, 185, 129, 0.14) 38%, rgba(4, 16, 13, 0) 75%)',
        }}
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden select-none"
    >
      {/* Dedicated WebGL canvas mount */}
      <div ref={mountRef} className="absolute inset-0 w-full h-full" />

      {/* Subtle readability gradient vignette over left headline side & bottom seam */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(95deg, rgba(6, 20, 13, 0.68) 0%, rgba(6, 20, 13, 0.34) 48%, rgba(4, 16, 18, 0.16) 100%), linear-gradient(180deg, rgba(6, 20, 13, 0.25) 0%, rgba(6, 20, 13, 0) 25%, rgba(6, 20, 13, 0.72) 100%)',
        }}
      />
    </div>
  );
}
