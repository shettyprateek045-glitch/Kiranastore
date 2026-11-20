import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  AlertTriangle,
  Box,
  ChevronUp,
  Eye,
  EyeOff,
  Flame,
  Layers,
  Package,
  Receipt,
  RotateCcw,
  RotateCw,
  SlidersHorizontal,
  TrendingUp,
  X,
} from 'lucide-react';
import { useShop } from '../context/ShopContext.tsx';
import type { Product, ProductForecast } from '../types/dukaaniq.ts';
import { daysBetweenDates, formatISODate } from '../services/intelligenceEngine.ts';

type OverlayMode = 'stock' | 'expiry' | 'velocity';
type CameraPresetId = 'overview' | 'staples' | 'snacks' | 'checkout' | 'floorplan';

interface CameraPreset {
  id: CameraPresetId;
  label: string;
  position: [number, number, number];
  target: [number, number, number];
}

const CAMERA_PRESETS: CameraPreset[] = [
  { id: 'overview', label: 'Store Overview', position: [12.5, 9.6, 13.2], target: [0, 1.15, 0] },
  { id: 'staples', label: 'Staples & Oils', position: [-8.2, 5.2, 7.6], target: [-3.4, 1.25, -0.6] },
  { id: 'snacks', label: 'Snacks & Dairy', position: [8.4, 5.2, 7.8], target: [2.8, 1.25, -0.6] },
  { id: 'checkout', label: 'Billing Counter', position: [9.4, 4.4, 9.8], target: [5.4, 1.0, 4.4] },
  { id: 'floorplan', label: 'Top-Down Map', position: [0.01, 18.8, 0.25], target: [0, 0, 0] },
];

interface AisleConfig {
  id: number;
  title: string;
  subtitle: string;
  basePos: [number, number, number];
  explodeDir: [number, number, number];
  categories: string[];
  accentHex: string;
}

const AISLE_CONFIGS: AisleConfig[] = [
  {
    id: 0,
    title: 'AISLE 01 · STAPLES & PULSES',
    subtitle: 'Grains, Atta, Rice & Dal',
    basePos: [-5.1, 0, -1.8],
    explodeDir: [-1.45, 0, -0.8],
    categories: ['Staples & Grains', 'Pulses', 'Dry Fruits'],
    accentHex: '#15803D',
  },
  {
    id: 1,
    title: 'AISLE 02 · OILS & MASALA',
    subtitle: 'Cooking Oils & Spices',
    basePos: [-1.7, 0, -1.8],
    explodeDir: [-0.45, 0, -0.8],
    categories: ['Cooking Oils', 'Spices & Masala'],
    accentHex: '#B45309',
  },
  {
    id: 2,
    title: 'AISLE 03 · SNACKS & DRINKS',
    subtitle: 'Biscuits, Tea & Beverages',
    basePos: [1.7, 0, -1.8],
    explodeDir: [0.45, 0, -0.8],
    categories: ['Biscuits & Snacks', 'Beverages'],
    accentHex: '#0F766E',
  },
  {
    id: 3,
    title: 'AISLE 04 · DAIRY & CARE',
    subtitle: 'Dairy, Home & Personal Care',
    basePos: [5.1, 0, -1.8],
    explodeDir: [1.45, 0, -0.8],
    categories: ['Dairy & Bakery', 'Home Care', 'Personal Care', 'Other'],
    accentHex: '#1D4ED8',
  },
];

interface SlotVisualRecord {
  product: Product;
  aisleIndex: number;
  rootGroup: THREE.Group;
  clickHitbox: THREE.Mesh;
  materials: THREE.MeshStandardMaterial[];
  wireMaterial: THREE.MeshBasicMaterial | null;
  worldAnchor: THREE.Vector3;
  expiryDaysLeft: number | null;
  velocityAvg: number;
  isSlow: boolean;
  isDead: boolean;
}

function detectSoftwareGl(): boolean {
  try {
    const probe = document.createElement('canvas');
    const gl =
      (probe.getContext('webgl2') as WebGL2RenderingContext | null) ||
      (probe.getContext('webgl') as WebGLRenderingContext | null);
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const rendererStr = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '') : '';
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(rendererStr);
  } catch {
    return false;
  }
}

function createFloorTileTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#E6ECE7';
  ctx.fillRect(0, 0, size, size);

  const tiles = 4;
  const step = size / tiles;
  for (let y = 0; y < tiles; y++) {
    for (let x = 0; x < tiles; x++) {
      const shade = (x + y) % 2 === 0 ? '#EEF3EE' : '#E8EFE9';
      ctx.fillStyle = shade;
      ctx.fillRect(x * step + 2, y * step + 2, step - 4, step - 4);

      // Subtle terrazzo speckles
      for (let i = 0; i < 24; i++) {
        const sx = x * step + 6 + ((i * 37 + x * 19 + y * 13) % (step - 12));
        const sy = y * step + 6 + ((i * 53 + x * 29 + y * 17) % (step - 12));
        ctx.fillStyle = i % 3 === 0 ? 'rgba(13,40,24,0.06)' : 'rgba(21,128,61,0.05)';
        ctx.fillRect(sx, sy, 2.5, 2.5);
      }
    }
  }

  ctx.strokeStyle = '#D0DDD3';
  ctx.lineWidth = 2;
  for (let i = 0; i <= tiles; i++) {
    ctx.beginPath();
    ctx.moveTo(i * step, 0);
    ctx.lineTo(i * step, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * step);
    ctx.lineTo(size, i * step);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 5);
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function createWoodShelfTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#C9A276';
  ctx.fillRect(0, 0, 512, 128);

  for (let i = 0; i < 42; i++) {
    const y = (i / 42) * 128;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(120, 74, 34, 0.12)' : 'rgba(255, 238, 214, 0.14)';
    ctx.fillRect(0, y, 512, 2 + (i % 3));
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function createSignboardTexture(
  title: string,
  subtitle: string,
  accentHex: string,
  maxAnisotropy: number
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 112;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#0D2818';
  ctx.fillRect(0, 0, 512, 112);

  ctx.fillStyle = accentHex;
  ctx.fillRect(0, 0, 14, 112);

  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 3;
  ctx.strokeRect(4, 4, 504, 104);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 28px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, 30, 42);

  ctx.fillStyle = '#A7F3D0';
  ctx.font = '500 18px "DM Sans", system-ui, sans-serif';
  ctx.fillText(subtitle, 30, 78);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function createShopFasciaTexture(shopName: string, city: string, maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 180;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#0D2818';
  ctx.fillRect(0, 0, 1024, 180);

  ctx.fillStyle = '#15803D';
  ctx.fillRect(0, 158, 1024, 22);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '800 54px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cleanName = shopName.length > 30 ? `${shopName.slice(0, 29)}…` : shopName;
  ctx.fillText(cleanName.toUpperCase(), 512, 72);

  ctx.fillStyle = '#BBF7D0';
  ctx.font = '600 22px "DM Sans", system-ui, sans-serif';
  ctx.fillText(`DUKAANIQ SPATIAL DIGITAL TWIN  ·  ${city.toUpperCase()}`, 512, 126);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function createPosScreenTexture(shopName: string, totalProducts: number, maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 160;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#0B1F14';
  ctx.fillRect(0, 0, 256, 160);

  ctx.fillStyle = '#15803D';
  ctx.fillRect(0, 0, 256, 30);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 13px system-ui, sans-serif';
  ctx.fillText('DUKAANIQ POS', 12, 20);

  ctx.fillStyle = '#86EFAC';
  ctx.font = '600 12px monospace';
  ctx.fillText(`ACTIVE SKUS: ${totalProducts}`, 14, 58);

  ctx.fillStyle = '#E2ECE5';
  ctx.font = '500 11px system-ui, sans-serif';
  ctx.fillText(shopName.slice(0, 22), 14, 82);

  // Mini bar chart graphic on POS monitor
  const bars = [26, 42, 34, 52, 46, 60];
  bars.forEach((h, i) => {
    ctx.fillStyle = i === bars.length - 1 ? '#22C55E' : '#15803D';
    ctx.fillRect(16 + i * 36, 146 - h, 24, h);
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function getAisleIndexForCategory(category: string): number {
  const idx = AISLE_CONFIGS.findIndex((a) => a.categories.includes(category));
  return idx >= 0 ? idx : 3;
}

function computeStatusColorHex(
  mode: OverlayMode,
  product: Product,
  expiryDaysLeft: number | null,
  velocityAvg: number,
  isSlow: boolean,
  isDead: boolean
): number {
  if (mode === 'stock') {
    if (product.currentStock <= 0) return 0xdc2626;
    if (product.currentStock <= product.minStockLevel) return 0xd97706;
    return 0x15803d;
  }
  if (mode === 'expiry') {
    if (expiryDaysLeft === null) return 0x15803d;
    if (expiryDaysLeft < 0) return 0xb91c1c;
    if (expiryDaysLeft <= 7) return 0xea580c;
    if (expiryDaysLeft <= 15) return 0xd97706;
    if (expiryDaysLeft <= 30) return 0xca8a04;
    return 0x15803d;
  }
  // velocity
  if (velocityAvg >= 2) return 0x059669;
  if (isDead) return 0x64748b;
  if (isSlow) return 0xb45309;
  return 0x16a34a;
}

function buildProductMeshGroup(
  product: Product,
  initialColorHex: number,
  sharedGeos: {
    sackBody: THREE.BoxGeometry;
    sackFold: THREE.BoxGeometry;
    bottleBody: THREE.CylinderGeometry;
    bottleNeck: THREE.CylinderGeometry;
    bottleCap: THREE.CylinderGeometry;
    boxPack: THREE.BoxGeometry;
    boxLabel: THREE.BoxGeometry;
    dairyBody: THREE.BoxGeometry;
    dairyTop: THREE.CylinderGeometry;
    ghostBox: THREE.BoxGeometry;
    hitbox: THREE.BoxGeometry;
  }
): {
  group: THREE.Group;
  hitbox: THREE.Mesh;
  materials: THREE.MeshStandardMaterial[];
  wireMaterial: THREE.MeshBasicMaterial | null;
} {
  const group = new THREE.Group();
  const materials: THREE.MeshStandardMaterial[] = [];
  let wireMaterial: THREE.MeshBasicMaterial | null = null;

  const isOutOfStock = product.currentStock <= 0;

  if (isOutOfStock) {
    wireMaterial = new THREE.MeshBasicMaterial({
      color: initialColorHex,
      wireframe: true,
      transparent: true,
      opacity: 0.85,
    });
    const ghost = new THREE.Mesh(sharedGeos.ghostBox, wireMaterial);
    ghost.position.y = 0.16;
    group.add(ghost);
  } else {
    const fillRatio =
      product.maxStockLevel > 0
        ? Math.min(1, Math.max(0.2, product.currentStock / product.maxStockLevel))
        : 0.6;
    const itemCount = Math.max(1, Math.min(3, Math.ceil(fillRatio * 3)));

    const bodyMat = new THREE.MeshStandardMaterial({
      color: initialColorHex,
      roughness: 0.44,
      metalness: 0.08,
    });
    const trimMat = new THREE.MeshStandardMaterial({
      color: 0xf8faf8,
      roughness: 0.62,
      metalness: 0.04,
    });
    materials.push(bodyMat);

    const cat = product.category;
    const isBottle = cat === 'Cooking Oils' || cat === 'Beverages';
    const isSack = cat === 'Staples & Grains' || cat === 'Pulses' || cat === 'Dry Fruits';
    const isDairy = cat === 'Dairy & Bakery';

    for (let i = 0; i < itemCount; i++) {
      const zOffset = (i - (itemCount - 1) / 2) * 0.19;
      if (isBottle) {
        const unit = new THREE.Group();
        const body = new THREE.Mesh(sharedGeos.bottleBody, bodyMat);
        body.position.y = 0.14;
        body.castShadow = true;
        body.receiveShadow = true;
        const neck = new THREE.Mesh(sharedGeos.bottleNeck, bodyMat);
        neck.position.y = 0.295;
        const cap = new THREE.Mesh(sharedGeos.bottleCap, trimMat);
        cap.position.y = 0.345;
        unit.add(body, neck, cap);
        unit.position.set(i === 1 ? 0.04 : -0.02, 0, zOffset);
        group.add(unit);
      } else if (isSack) {
        const unit = new THREE.Group();
        const sack = new THREE.Mesh(sharedGeos.sackBody, bodyMat);
        sack.position.y = 0.1 + i * 0.115;
        sack.rotation.y = (i % 2 === 0 ? 1 : -1) * 0.08;
        sack.castShadow = true;
        sack.receiveShadow = true;
        const fold = new THREE.Mesh(sharedGeos.sackFold, trimMat);
        fold.position.y = 0.145 + i * 0.115;
        unit.add(sack, fold);
        group.add(unit);
      } else if (isDairy) {
        const unit = new THREE.Group();
        const body = new THREE.Mesh(sharedGeos.dairyBody, bodyMat);
        body.position.y = 0.13;
        body.castShadow = true;
        const top = new THREE.Mesh(sharedGeos.dairyTop, trimMat);
        top.position.y = 0.28;
        top.rotation.y = Math.PI / 4;
        unit.add(body, top);
        unit.position.set(0, 0, zOffset);
        group.add(unit);
      } else {
        const unit = new THREE.Group();
        const box = new THREE.Mesh(sharedGeos.boxPack, bodyMat);
        box.position.y = 0.14;
        box.castShadow = true;
        box.receiveShadow = true;
        const label = new THREE.Mesh(sharedGeos.boxLabel, trimMat);
        label.position.set(0, 0.15, 0.072);
        unit.add(box, label);
        unit.position.set(0, 0, zOffset);
        group.add(unit);
      }
    }
  }

  // Dedicated invisible hitbox for reliable click/hover raycasting
  const hitboxMat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const hitbox = new THREE.Mesh(sharedGeos.hitbox, hitboxMat);
  hitbox.position.y = 0.2;
  hitbox.userData.productId = product.id;
  group.add(hitbox);

  return { group, hitbox, materials, wireMaterial };
}

export default function Store3DTwinView() {
  const { workspace, forecasts, expirySummary, setActiveView } = useShop();

  const mountRef = useRef<HTMLDivElement | null>(null);
  const [overlayMode, setOverlayMode] = useState<OverlayMode>('stock');
  const [activePreset, setActivePreset] = useState<CameraPresetId>('overview');
  const [explodeFactor, setExplodeFactor] = useState(0);
  const [autoOrbit, setAutoOrbit] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [hoveredProductName, setHoveredProductName] = useState<string | null>(null);
  const [contextLost, setContextLost] = useState(false);

  // Refs shared with Three.js imperative engine to avoid tearing down WebGL on UI changes
  const overlayModeRef = useRef<OverlayMode>(overlayMode);
  const explodeRef = useRef<number>(explodeFactor);
  const autoOrbitRef = useRef<boolean>(autoOrbit);
  const selectedIdRef = useRef<number | null>(selectedProductId);
  const requestRenderRef = useRef<() => void>(() => {});
  const applyPresetRef = useRef<(preset: CameraPreset) => void>(() => {});
  const focusProductRef = useRef<(productId: number) => void>(() => {});
  const updateOverlayColorsRef = useRef<(mode: OverlayMode) => void>(() => {});

  overlayModeRef.current = overlayMode;
  explodeRef.current = explodeFactor;
  autoOrbitRef.current = autoOrbit;
  selectedIdRef.current = selectedProductId;

  const todayISO = useMemo(() => formatISODate(new Date()), []);

  const forecastMap = useMemo(() => {
    const map = new Map<number, ProductForecast>();
    for (const f of forecasts) map.set(f.productId, f);
    return map;
  }, [forecasts]);

  const productExpiryDaysMap = useMemo(() => {
    const map = new Map<number, number | null>();
    if (!workspace) return map;
    for (const p of workspace.products) {
      const batches = workspace.batches.filter(
        (b) => b.productId === p.id && b.status === 'active' && b.quantity > 0
      );
      if (batches.length > 0) {
        const nearest = batches.reduce(
          (min, b) => Math.min(min, daysBetweenDates(todayISO, b.expiryDate)),
          Infinity
        );
        map.set(p.id, Number.isFinite(nearest) ? nearest : null);
      } else if (p.expiryDate) {
        map.set(p.id, daysBetweenDates(todayISO, p.expiryDate));
      } else {
        map.set(p.id, null);
      }
    }
    return map;
  }, [workspace, todayISO]);

  // Quick KPI strip summary (computed fast from live workspace)
  const sceneStats = useMemo(() => {
    if (!workspace) {
      return { total: 0, healthy: 0, low: 0, out: 0, expiryRisk: 0, fastMovers: 0 };
    }
    let healthy = 0;
    let low = 0;
    let out = 0;
    for (const p of workspace.products) {
      if (p.currentStock <= 0) out++;
      else if (p.currentStock <= p.minStockLevel) low++;
      else healthy++;
    }
    const expiryRisk =
      expirySummary.expired.length +
      expirySummary.within7.length +
      expirySummary.within15.length;
    const fastMovers = forecasts.filter((f) => f.avgDailySales >= 2).length;
    return {
      total: workspace.products.length,
      healthy,
      low,
      out,
      expiryRisk,
      fastMovers,
    };
  }, [workspace, expirySummary, forecasts]);

  const selectedProduct = useMemo(() => {
    if (!workspace || selectedProductId === null) return null;
    return workspace.products.find((p) => p.id === selectedProductId) || null;
  }, [workspace, selectedProductId]);

  const selectedForecast = selectedProduct ? forecastMap.get(selectedProduct.id) || null : null;
  const selectedExpiryDays = selectedProduct
    ? productExpiryDaysMap.get(selectedProduct.id) ?? null
    : null;

  // Keyboard shortcut: 'H' toggles HUD dock cleanly
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'h' || e.key === 'H') {
        setControlsVisible((v) => !v);
      } else if (e.key === 'Escape') {
        setSelectedProductId(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Trigger instant overlay color refresh without rebuilding WebGL scene
  useEffect(() => {
    updateOverlayColorsRef.current(overlayMode);
    requestRenderRef.current();
  }, [overlayMode]);

  useEffect(() => {
    requestRenderRef.current();
  }, [explodeFactor, autoOrbit, selectedProductId]);

  const handleSelectPreset = useCallback((preset: CameraPreset) => {
    setActivePreset(preset.id);
    applyPresetRef.current(preset);
  }, []);

  // Main WebGL / Three.js scene lifecycle
  useEffect(() => {
    const container = mountRef.current;
    if (!container || !workspace) return;

    const isSoftwareGl = detectSoftwareGl();
    const width = Math.max(container.clientWidth, 320);
    const height = Math.max(container.clientHeight, 320);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
      alpha: false,
    });
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = !isSoftwareGl;
    if (!isSoftwareGl) {
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy() || 1);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xebf1ec);
    scene.fog = new THREE.FogExp2(0xebf1ec, 0.014);

    // Studio IBL environment (always generated, even on software GL)
    const pmrem = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envTarget = pmrem.fromScene(roomEnv, 0.04);
    scene.environment = envTarget.texture;
    roomEnv.dispose();
    pmrem.dispose();

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
    camera.position.set(12.5, 9.6, 13.2);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.07;
    controls.maxPolarAngle = Math.PI * 0.475;
    controls.minPolarAngle = 0.08;
    controls.minDistance = 4.2;
    controls.maxDistance = 28;
    controls.target.set(0, 1.15, 0);
    controls.update();

    // Lighting: warm daylight key + cool sky/ground hemisphere + subtle fill
    const hemiLight = new THREE.HemisphereLight(0xf3faf5, 0xc7d6cc, 0.78);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff6e8, 1.65);
    keyLight.position.set(11, 17, 10);
    if (!isSoftwareGl) {
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.camera.near = 2;
      keyLight.shadow.camera.far = 42;
      const d = 12.5;
      keyLight.shadow.camera.left = -d;
      keyLight.shadow.camera.right = d;
      keyLight.shadow.camera.top = d;
      keyLight.shadow.camera.bottom = -d;
      keyLight.shadow.bias = -0.0005;
      keyLight.shadow.normalBias = 0.025;
    }
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xd9f2e4, 0.45);
    rimLight.position.set(-10, 8, -9);
    scene.add(rimLight);

    // Track disposable resources
    const texturesToDispose: THREE.Texture[] = [];
    const geometriesToDispose: THREE.BufferGeometry[] = [];
    const materialsToDispose: THREE.Material[] = [];

    const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
      geometriesToDispose.push(g);
      return g;
    };
    const trackMat = <T extends THREE.Material>(m: T): T => {
      materialsToDispose.push(m);
      return m;
    };
    const trackTex = <T extends THREE.Texture>(t: T): T => {
      texturesToDispose.push(t);
      return t;
    };

    // Procedural Textures
    const floorTex = trackTex(createFloorTileTexture(maxAnisotropy));
    const woodTex = trackTex(createWoodShelfTexture(maxAnisotropy));
    const fasciaTex = trackTex(
      createShopFasciaTexture(workspace.shop.name, workspace.shop.city, maxAnisotropy)
    );
    const posTex = trackTex(
      createPosScreenTexture(workspace.shop.name, workspace.products.length, maxAnisotropy)
    );

    // Architectural Store Platform & Floor
    const floorGroup = new THREE.Group();
    const baseSlabGeo = trackGeo(new THREE.BoxGeometry(17.4, 0.36, 13.6));
    const baseSlabMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0x0d2818, roughness: 0.55, metalness: 0.15 })
    );
    const baseSlab = new THREE.Mesh(baseSlabGeo, baseSlabMat);
    baseSlab.position.set(0, -0.19, 0.4);
    baseSlab.receiveShadow = true;
    floorGroup.add(baseSlab);

    const floorGeo = trackGeo(new THREE.PlaneGeometry(17.0, 13.2));
    const floorMat = trackMat(
      new THREE.MeshStandardMaterial({
        map: floorTex,
        roughness: 0.78,
        metalness: 0.04,
      })
    );
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.set(0, 0, 0.4);
    floorMesh.receiveShadow = true;
    floorGroup.add(floorMesh);

    // Subtle aisle walkway guide lines on floor
    const walkwayMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.6, metalness: 0.05 })
    );
    const frontWalkGeo = trackGeo(new THREE.PlaneGeometry(15.2, 0.08));
    const frontWalk = new THREE.Mesh(frontWalkGeo, walkwayMat);
    frontWalk.rotation.x = -Math.PI / 2;
    frontWalk.position.set(0, 0.005, 2.2);
    floorGroup.add(frontWalk);

    // Architectural Back Feature Wall with Shop Fascia
    const wallMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0xf7faf7, roughness: 0.82, metalness: 0.02 })
    );
    const copingMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0x0d2818, roughness: 0.38, metalness: 0.45 })
    );

    const backWallGeo = trackGeo(new THREE.BoxGeometry(17.0, 3.85, 0.24));
    const backWall = new THREE.Mesh(backWallGeo, wallMat);
    backWall.position.set(0, 1.925, -6.1);
    backWall.receiveShadow = true;
    floorGroup.add(backWall);

    const backCopingGeo = trackGeo(new THREE.BoxGeometry(17.16, 0.14, 0.34));
    const backCoping = new THREE.Mesh(backCopingGeo, copingMat);
    backCoping.position.set(0, 3.88, -6.1);
    floorGroup.add(backCoping);

    // Shop Fascia Signboard mounted on back wall
    const fasciaGeo = trackGeo(new THREE.BoxGeometry(8.8, 1.28, 0.1));
    const fasciaMat = trackMat(
      new THREE.MeshStandardMaterial({ map: fasciaTex, roughness: 0.36, metalness: 0.12 })
    );
    const fasciaBoard = new THREE.Mesh(fasciaGeo, fasciaMat);
    fasciaBoard.position.set(0, 3.0, -5.94);
    floorGroup.add(fasciaBoard);

    // Low side architectural knee-walls so the room feels grounded yet stays wide open for viewing
    const sideWallGeo = trackGeo(new THREE.BoxGeometry(0.2, 1.05, 13.0));
    const leftWall = new THREE.Mesh(sideWallGeo, wallMat);
    leftWall.position.set(-8.4, 0.525, 0.4);
    leftWall.receiveShadow = true;
    floorGroup.add(leftWall);

    const sideTrimGeo = trackGeo(new THREE.BoxGeometry(0.26, 0.08, 13.05));
    const leftTrim = new THREE.Mesh(sideTrimGeo, copingMat);
    leftTrim.position.set(-8.4, 1.08, 0.4);
    floorGroup.add(leftTrim);

    // Subtle entrance mat on front-left
    const matGeo = trackGeo(new THREE.BoxGeometry(3.2, 0.03, 1.35));
    const matMaterial = trackMat(
      new THREE.MeshStandardMaterial({ color: 0x16532d, roughness: 0.92, metalness: 0 })
    );
    const entranceMat = new THREE.Mesh(matGeo, matMaterial);
    entranceMat.position.set(-4.2, 0.015, 5.8);
    entranceMat.receiveShadow = true;
    floorGroup.add(entranceMat);

    scene.add(floorGroup);

    // Build Multi-Part Checkout & Billing Counter (Front-Right)
    const counterGroup = new THREE.Group();
    counterGroup.position.set(5.2, 0, 4.4);

    const counterBodyMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0x133822, roughness: 0.46, metalness: 0.12 })
    );
    const graniteMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0xf0f4f1, roughness: 0.22, metalness: 0.08 })
    );
    const metalMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0x2a3b31, roughness: 0.32, metalness: 0.72 })
    );
    const steelMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0xd0dad3, roughness: 0.25, metalness: 0.78 })
    );

    const counterMain = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(4.1, 0.94, 1.15)), counterBodyMat);
    counterMain.position.set(0, 0.47, 0);
    counterMain.castShadow = true;
    counterMain.receiveShadow = true;
    counterGroup.add(counterMain);

    const counterTop = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(4.24, 0.08, 1.28)), graniteMat);
    counterTop.position.set(0, 0.98, 0);
    counterTop.castShadow = true;
    counterTop.receiveShadow = true;
    counterGroup.add(counterTop);

    // Counter L-return wing
    const wingBody = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.05, 0.94, 1.8)), counterBodyMat);
    wingBody.position.set(1.52, 0.47, -1.42);
    wingBody.castShadow = true;
    counterGroup.add(wingBody);
    const wingTop = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.16, 0.08, 1.88)), graniteMat);
    wingTop.position.set(1.52, 0.98, -1.42);
    counterGroup.add(wingTop);

    // POS Terminal Stand + Screen
    const posStand = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.06, 0.11, 0.34, 12)), metalMat);
    posStand.position.set(-0.65, 1.19, -0.05);
    counterGroup.add(posStand);

    const posBezel = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.76, 0.5, 0.06)), metalMat);
    posBezel.position.set(-0.65, 1.48, -0.05);
    posBezel.rotation.x = -0.18;
    posBezel.rotation.y = 0.24;
    posBezel.castShadow = true;
    counterGroup.add(posBezel);

    const posScreenMat = trackMat(
      new THREE.MeshStandardMaterial({
        map: posTex,
        emissive: 0x15803d,
        emissiveMap: posTex,
        emissiveIntensity: 0.45,
        roughness: 0.2,
        metalness: 0.1,
      })
    );
    const posScreen = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(0.68, 0.42)), posScreenMat);
    posScreen.position.set(-0.65, 1.48, -0.015);
    posScreen.rotation.x = -0.18;
    posScreen.rotation.y = 0.24;
    counterGroup.add(posScreen);

    // Digital Weighing Scale on counter
    const scaleBase = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.56, 0.12, 0.48)), metalMat);
    scaleBase.position.set(0.75, 1.08, 0.05);
    scaleBase.castShadow = true;
    counterGroup.add(scaleBase);

    const scalePlatter = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.5, 0.04, 0.42)), steelMat);
    scalePlatter.position.set(0.75, 1.16, 0.05);
    counterGroup.add(scalePlatter);

    // Cash Drawer unit
    const cashDrawer = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.68, 0.14, 0.56)), metalMat);
    cashDrawer.position.set(-1.42, 1.09, -0.04);
    cashDrawer.castShadow = true;
    counterGroup.add(cashDrawer);

    scene.add(counterGroup);

    // Shared geometries for shelves & procedural products
    const sharedProductGeos = {
      sackBody: trackGeo(new THREE.BoxGeometry(0.32, 0.1, 0.26)),
      sackFold: trackGeo(new THREE.BoxGeometry(0.24, 0.025, 0.08)),
      bottleBody: trackGeo(new THREE.CylinderGeometry(0.085, 0.095, 0.26, 12)),
      bottleNeck: trackGeo(new THREE.CylinderGeometry(0.036, 0.078, 0.06, 10)),
      bottleCap: trackGeo(new THREE.CylinderGeometry(0.038, 0.038, 0.04, 10)),
      boxPack: trackGeo(new THREE.BoxGeometry(0.24, 0.27, 0.14)),
      boxLabel: trackGeo(new THREE.BoxGeometry(0.18, 0.1, 0.01)),
      dairyBody: trackGeo(new THREE.BoxGeometry(0.2, 0.24, 0.15)),
      dairyTop: trackGeo(new THREE.CylinderGeometry(0.02, 0.125, 0.07, 4)),
      ghostBox: trackGeo(new THREE.BoxGeometry(0.32, 0.28, 0.28)),
      hitbox: trackGeo(new THREE.BoxGeometry(0.46, 0.42, 0.62)),
    };

    const uprightGeo = trackGeo(new THREE.BoxGeometry(0.08, 2.38, 0.08));
    const backPanelGeo = trackGeo(new THREE.BoxGeometry(0.06, 2.15, 5.2));
    const shelfDeckGeo = trackGeo(new THREE.BoxGeometry(1.18, 0.06, 5.26));
    const priceRailGeo = trackGeo(new THREE.BoxGeometry(0.03, 0.075, 5.28));
    const plinthGeo = trackGeo(new THREE.BoxGeometry(1.12, 0.18, 5.18));
    const signPanelGeo = trackGeo(new THREE.BoxGeometry(0.08, 0.44, 2.3));
    const bracketGeo = trackGeo(new THREE.BoxGeometry(0.06, 0.34, 0.06));

    const steelUprightMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0x163824, roughness: 0.34, metalness: 0.66 })
    );
    const backPanelMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0xf4f7f4, roughness: 0.74, metalness: 0.04 })
    );
    const shelfWoodMat = trackMat(
      new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.66, metalness: 0.04 })
    );
    const priceRailMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0xcbd5cf, roughness: 0.28, metalness: 0.76 })
    );

    // Group products into the 4 aisles
    const productsByAisle: Product[][] = [[], [], [], []];
    workspace.products.forEach((p) => {
      const aIdx = getAisleIndexForCategory(p.category);
      productsByAisle[aIdx].push(p);
    });

    const aisleGroups: THREE.Group[] = [];
    const slotRecords: SlotVisualRecord[] = [];
    const clickableMeshes: THREE.Mesh[] = [];

    const shelfHeights = [0.22, 0.96, 1.68];

    AISLE_CONFIGS.forEach((cfg, aisleIdx) => {
      const rackGroup = new THREE.Group();
      rackGroup.position.set(cfg.basePos[0], cfg.basePos[1], cfg.basePos[2]);

      // Plinth base
      const plinth = new THREE.Mesh(plinthGeo, steelUprightMat);
      plinth.position.set(0, 0.09, 0);
      plinth.castShadow = true;
      plinth.receiveShadow = true;
      rackGroup.add(plinth);

      // 4 corner uprights + 2 center uprights
      const zPosts = [-2.58, 0, 2.58];
      const xPosts = [-0.54, 0.54];
      for (const zp of zPosts) {
        for (const xp of xPosts) {
          const post = new THREE.Mesh(uprightGeo, steelUprightMat);
          post.position.set(xp, 1.19, zp);
          post.castShadow = true;
          rackGroup.add(post);
        }
      }

      // Center perforated divider panel
      const backPanel = new THREE.Mesh(backPanelGeo, backPanelMat);
      backPanel.position.set(0, 1.24, 0);
      backPanel.receiveShadow = true;
      rackGroup.add(backPanel);

      // 3 Timber Shelf Decks + Front/Back Aluminum Price Rails
      shelfHeights.forEach((sy) => {
        const deck = new THREE.Mesh(shelfDeckGeo, shelfWoodMat);
        deck.position.set(0, sy, 0);
        deck.castShadow = true;
        deck.receiveShadow = true;
        rackGroup.add(deck);

        const railL = new THREE.Mesh(priceRailGeo, priceRailMat);
        railL.position.set(-0.59, sy - 0.005, 0);
        rackGroup.add(railL);

        const railR = new THREE.Mesh(priceRailGeo, priceRailMat);
        railR.position.set(0.59, sy - 0.005, 0);
        rackGroup.add(railR);
      });

      // Overhead Aisle Header Signboard (double-sided visual via box + 2 planes)
      const signTex = trackTex(
        createSignboardTexture(cfg.title, cfg.subtitle, cfg.accentHex, maxAnisotropy)
      );
      const signFaceMat = trackMat(
        new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.42, metalness: 0.1 })
      );

      const b1 = new THREE.Mesh(bracketGeo, steelUprightMat);
      b1.position.set(0, 2.52, -0.82);
      const b2 = new THREE.Mesh(bracketGeo, steelUprightMat);
      b2.position.set(0, 2.52, 0.82);
      rackGroup.add(b1, b2);

      const signBacking = new THREE.Mesh(signPanelGeo, steelUprightMat);
      signBacking.position.set(0, 2.74, 0);
      rackGroup.add(signBacking);

      const faceGeo = trackGeo(new THREE.PlaneGeometry(2.24, 0.4));
      const signFaceRight = new THREE.Mesh(faceGeo, signFaceMat);
      signFaceRight.position.set(0.045, 2.74, 0);
      signFaceRight.rotation.y = Math.PI / 2;
      rackGroup.add(signFaceRight);

      const signFaceLeft = new THREE.Mesh(faceGeo, signFaceMat);
      signFaceLeft.position.set(-0.045, 2.74, 0);
      signFaceLeft.rotation.y = -Math.PI / 2;
      rackGroup.add(signFaceLeft);

      // Populate live products onto both sides of the gondola across the 3 shelf tiers
      const aisleProds = productsByAisle[aisleIdx];
      const slotsPerSidePerTier = 6;
      aisleProds.forEach((prod, idx) => {
        const tier = idx % shelfHeights.length;
        const side = Math.floor(idx / shelfHeights.length) % 2; // 0 = right (+x), 1 = left (-x)
        const col = Math.floor(idx / (shelfHeights.length * 2)) % slotsPerSidePerTier;

        const yPos = shelfHeights[tier] + 0.03;
        const xPos = side === 0 ? 0.31 : -0.31;
        const zPos = -2.1 + col * 0.84;

        const fc = forecastMap.get(prod.id);
        const expiryDaysLeft = productExpiryDaysMap.get(prod.id) ?? null;
        const velocityAvg = fc?.avgDailySales ?? 0;
        const isSlow = fc?.slowMovingFlag ?? false;
        const isDead = fc?.deadStockFlag ?? false;

        const colorHex = computeStatusColorHex(
          overlayModeRef.current,
          prod,
          expiryDaysLeft,
          velocityAvg,
          isSlow,
          isDead
        );

        const built = buildProductMeshGroup(prod, colorHex, sharedProductGeos);
        built.group.position.set(xPos, yPos, zPos);
        if (side === 1) {
          built.group.rotation.y = Math.PI;
        }
        rackGroup.add(built.group);

        built.materials.forEach((m) => materialsToDispose.push(m));
        if (built.wireMaterial) materialsToDispose.push(built.wireMaterial);
        if (built.hitbox.material instanceof THREE.Material) {
          materialsToDispose.push(built.hitbox.material);
        }

        clickableMeshes.push(built.hitbox);
        slotRecords.push({
          product: prod,
          aisleIndex: aisleIdx,
          rootGroup: built.group,
          clickHitbox: built.hitbox,
          materials: built.materials,
          wireMaterial: built.wireMaterial,
          worldAnchor: new THREE.Vector3(),
          expiryDaysLeft,
          velocityAvg,
          isSlow,
          isDead,
        });
      });

      aisleGroups.push(rackGroup);
      scene.add(rackGroup);
    });

    // Selection & Hover Ring indicator (moves smoothly onto hovered/selected shelf slot)
    const ringGeo = trackGeo(new THREE.RingGeometry(0.24, 0.31, 24));
    const ringMat = trackMat(
      new THREE.MeshBasicMaterial({
        color: 0x0d2818,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.9,
      })
    );
    const selectionRing = new THREE.Mesh(ringGeo, ringMat);
    selectionRing.rotation.x = -Math.PI / 2;
    selectionRing.visible = false;
    scene.add(selectionRing);

    // Pre-allocated scratch vectors/colors for zero-GC animation loop
    const _desiredCamPos = new THREE.Vector3();
    const _desiredTarget = new THREE.Vector3();
    const _tempVec = new THREE.Vector3();
    const _tempColor = new THREE.Color();
    const _pointer = new THREE.Vector2();
    const raycaster = new THREE.Raycaster();

    let isTransitioningCamera = false;
    let currentExplode = 0;
    let hoveredProductId: number | null = null;
    let rafId: number | null = null;
    let softwareTimerId: number | null = null;
    let lastTime = performance.now();
    let disposed = false;

    const updateOverlayColors = (mode: OverlayMode) => {
      for (const rec of slotRecords) {
        const hex = computeStatusColorHex(
          mode,
          rec.product,
          rec.expiryDaysLeft,
          rec.velocityAvg,
          rec.isSlow,
          rec.isDead
        );
        _tempColor.setHex(hex);
        for (const mat of rec.materials) {
          mat.color.copy(_tempColor);
          if (selectedIdRef.current === rec.product.id) {
            mat.emissive.copy(_tempColor);
            mat.emissiveIntensity = 0.28;
          } else {
            mat.emissive.setHex(0x000000);
            mat.emissiveIntensity = 0;
          }
        }
        if (rec.wireMaterial) {
          rec.wireMaterial.color.copy(_tempColor);
        }
      }
    };
    updateOverlayColorsRef.current = updateOverlayColors;

    const applyPreset = (preset: CameraPreset) => {
      _desiredCamPos.set(...preset.position);
      _desiredTarget.set(...preset.target);
      isTransitioningCamera = true;
      requestRender();
    };
    applyPresetRef.current = applyPreset;

    const focusProduct = (productId: number) => {
      const rec = slotRecords.find((r) => r.product.id === productId);
      if (!rec) return;
      rec.rootGroup.getWorldPosition(_tempVec);
      _desiredTarget.copy(_tempVec).add(new THREE.Vector3(0, 0.18, 0));
      const sideSign = _tempVec.x >= 0 ? 1 : -1;
      _desiredCamPos.set(_tempVec.x + sideSign * 3.1, _tempVec.y + 1.65, _tempVec.z + 2.8);
      isTransitioningCamera = true;
      requestRender();
    };
    focusProductRef.current = focusProduct;

    const scheduleNextFrame = () => {
      if (disposed || rafId !== null || softwareTimerId !== null) return;
      if (isSoftwareGl) {
        const gl = renderer.getContext() as WebGL2RenderingContext;
        if (typeof gl.fenceSync === 'function') {
          const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
          gl.flush();
          if (sync) gl.deleteSync(sync);
        }
        softwareTimerId = window.setTimeout(() => {
          softwareTimerId = null;
          rafId = requestAnimationFrame(renderFrame);
        }, 80);
      } else {
        rafId = requestAnimationFrame(renderFrame);
      }
    };

    const requestRender = () => {
      if (disposed) return;
      scheduleNextFrame();
    };
    requestRenderRef.current = requestRender;

    const renderFrame = (now: number) => {
      rafId = null;
      if (disposed) return;

      const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;
      let needsAnotherFrame = false;

      // Smoothly damp exploded aisle spacing
      const targetExplode = explodeRef.current;
      if (Math.abs(currentExplode - targetExplode) > 0.002) {
        currentExplode = THREE.MathUtils.damp(currentExplode, targetExplode, 7, dt);
        aisleGroups.forEach((grp, idx) => {
          const cfg = AISLE_CONFIGS[idx];
          grp.position.set(
            cfg.basePos[0] + cfg.explodeDir[0] * currentExplode,
            cfg.basePos[1],
            cfg.basePos[2] + cfg.explodeDir[2] * currentExplode
          );
        });
        needsAnotherFrame = true;
      }

      // Smooth camera transition to preset or inspected product
      if (isTransitioningCamera) {
        camera.position.x = THREE.MathUtils.damp(camera.position.x, _desiredCamPos.x, 6.5, dt);
        camera.position.y = THREE.MathUtils.damp(camera.position.y, _desiredCamPos.y, 6.5, dt);
        camera.position.z = THREE.MathUtils.damp(camera.position.z, _desiredCamPos.z, 6.5, dt);

        controls.target.x = THREE.MathUtils.damp(controls.target.x, _desiredTarget.x, 6.5, dt);
        controls.target.y = THREE.MathUtils.damp(controls.target.y, _desiredTarget.y, 6.5, dt);
        controls.target.z = THREE.MathUtils.damp(controls.target.z, _desiredTarget.z, 6.5, dt);

        if (
          camera.position.distanceToSquared(_desiredCamPos) < 0.0016 &&
          controls.target.distanceToSquared(_desiredTarget) < 0.0016
        ) {
          camera.position.copy(_desiredCamPos);
          controls.target.copy(_desiredTarget);
          isTransitioningCamera = false;
        } else {
          needsAnotherFrame = true;
        }
      }

      // Optional smooth auto-orbit (disabled on software GL for crisp responsiveness)
      controls.autoRotate = !isSoftwareGl && autoOrbitRef.current && !isTransitioningCamera;
      controls.autoRotateSpeed = 0.9;
      const controlsMoved = controls.update();
      if (controlsMoved || controls.autoRotate) {
        needsAnotherFrame = true;
      }

      // Position selection/hover ring cleanly
      const activeRingId = selectedIdRef.current ?? hoveredProductId;
      if (activeRingId !== null) {
        const rec = slotRecords.find((r) => r.product.id === activeRingId);
        if (rec) {
          rec.rootGroup.getWorldPosition(_tempVec);
          selectionRing.position.set(_tempVec.x, _tempVec.y + 0.012, _tempVec.z);
          selectionRing.visible = true;
          ringMat.color.setHex(selectedIdRef.current === activeRingId ? 0x0d2818 : 0x15803d);
        } else {
          selectionRing.visible = false;
        }
      } else {
        selectionRing.visible = false;
      }

      // Highlight selected product emissive subtly
      for (const rec of slotRecords) {
        const isSelected = selectedIdRef.current === rec.product.id;
        const isHovered = hoveredProductId === rec.product.id;
        for (const mat of rec.materials) {
          if (isSelected) {
            mat.emissive.copy(mat.color);
            mat.emissiveIntensity = 0.26;
          } else if (isHovered) {
            mat.emissive.copy(mat.color);
            mat.emissiveIntensity = 0.14;
          } else if (mat.emissiveIntensity !== 0) {
            mat.emissive.setHex(0x000000);
            mat.emissiveIntensity = 0;
          }
        }
      }

      renderer.render(scene, camera);

      if (needsAnotherFrame) {
        scheduleNextFrame();
      }
    };

    // Cancel camera preset transition immediately if user drags/zooms manually
    const onControlStart = () => {
      isTransitioningCamera = false;
      if (autoOrbitRef.current) setAutoOrbit(false);
    };
    const onControlChange = () => {
      requestRender();
    };
    controls.addEventListener('start', onControlStart);
    controls.addEventListener('change', onControlChange);

    // Throttled Pointer Hover + Click-to-Inspect Raycasting
    let lastHoverTime = 0;
    let pointerDownPos = { x: 0, y: 0 };

    const pickProduct = (clientX: number, clientY: number): number | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      _pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      _pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(_pointer, camera);
      const hits = raycaster.intersectObjects(clickableMeshes, false);
      if (hits.length > 0) {
        const pid = hits[0].object.userData.productId;
        return typeof pid === 'number' ? pid : null;
      }
      return null;
    };

    const onPointerMove = (e: PointerEvent) => {
      const now = performance.now();
      if (now - lastHoverTime < 45) return;
      lastHoverTime = now;
      const pid = pickProduct(e.clientX, e.clientY);
      if (pid !== hoveredProductId) {
        hoveredProductId = pid;
        renderer.domElement.style.cursor = pid !== null ? 'pointer' : 'grab';
        if (pid !== null) {
          const found = workspace.products.find((p) => p.id === pid);
          setHoveredProductName(found ? `${found.name} (${found.currentStock} ${found.unit})` : null);
        } else {
          setHoveredProductName(null);
        }
        requestRender();
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
    };

    const onPointerUp = (e: PointerEvent) => {
      const dx = e.clientX - pointerDownPos.x;
      const dy = e.clientY - pointerDownPos.y;
      if (dx * dx + dy * dy > 36) return; // Dragged camera, not a click
      const pid = pickProduct(e.clientX, e.clientY);
      if (pid !== null) {
        setSelectedProductId(pid);
        setControlsVisible(true);
        focusProduct(pid);
      }
    };

    renderer.domElement.style.cursor = 'grab';
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    // WebGL Context Loss & Restoration handling
    const onContextLost = (e: Event) => {
      e.preventDefault();
      setContextLost(true);
    };
    const onContextRestored = () => {
      setContextLost(false);
      requestRender();
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);

    // Responsive ResizeObserver
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const w = Math.max(entry.contentRect.width, 280);
      const h = Math.max(entry.contentRect.height, 280);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      requestRender();
    });
    resizeObserver.observe(container);

    // Initial render
    requestRender();

    return () => {
      disposed = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (softwareTimerId !== null) clearTimeout(softwareTimerId);
      resizeObserver.disconnect();
      controls.removeEventListener('start', onControlStart);
      controls.removeEventListener('change', onControlChange);
      controls.dispose();

      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);

      envTarget.dispose();
      texturesToDispose.forEach((t) => t.dispose());
      geometriesToDispose.forEach((g) => g.dispose());
      materialsToDispose.forEach((m) => m.dispose());
      renderer.dispose();
    };
  }, [workspace, forecastMap, productExpiryDaysMap]);

  if (!workspace) return null;

  return (
    <div className="relative w-full h-[calc(100vh-8.2rem)] min-h-[540px] rounded-2xl overflow-hidden border border-[#DCE6DF] bg-[#EBF1EC] select-none">
      {/* Full-Bleed WebGL Canvas Container */}
      <div ref={mountRef} className="w-full h-full" />

      {/* Context Lost Recovery Notice */}
      {contextLost && (
        <div className="absolute inset-0 bg-[#EBF1EC]/95 flex items-center justify-center z-30 p-6">
          <div className="bg-white border border-[#DCE6DF] rounded-xl p-6 max-w-sm text-center space-y-2">
            <p className="font-display text-base font-bold text-[#0D2818]">3D Graphics Context Paused</p>
            <p className="text-xs text-[#54695B]">
              Your browser temporarily paused WebGL graphics. Reload the view or click any camera preset once restored.
            </p>
          </div>
        </div>
      )}

      {/* Minimal Top-Left Corner Identity (pointer-events-none, zero center obstruction) */}
      <div className="pointer-events-none absolute top-4 left-4 z-10 max-w-xs">
        <p className="font-display text-sm font-bold text-[#0D2818]">
          {workspace.shop.name} · 3D Digital Twin
        </p>
        <p className="text-[11px] text-[#3F5346]">
          Drag to orbit · Scroll to zoom · Click any shelf item to inspect
        </p>
        {hoveredProductName && (
          <div className="mt-2 inline-block px-2.5 py-1 rounded-md bg-[#0D2818] text-white text-[11px] font-medium shadow-xs">
            {hoveredProductName}
          </div>
        )}
      </div>

      {/* Top-Right Compact Legend + Show/Hide Controls Toggle */}
      <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
        <div className="hidden md:flex items-center gap-3 px-3 py-1.5 rounded-lg bg-white/95 border border-[#DCE6DF] text-[11px] font-medium text-[#111D15]">
          {overlayMode === 'stock' && (
            <>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-[#15803D]" />
                Healthy ({sceneStats.healthy})
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-[#D97706]" />
                Low ({sceneStats.low})
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs border border-[#DC2626] bg-red-50" />
                Out ({sceneStats.out})
              </span>
            </>
          )}
          {overlayMode === 'expiry' && (
            <>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-[#B91C1C]" />
                Expired
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-[#EA580C]" />
                &le;15d Risk ({sceneStats.expiryRisk})
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-[#15803D]" />
                Safe
              </span>
            </>
          )}
          {overlayMode === 'velocity' && (
            <>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-[#059669]" />
                Fast ({sceneStats.fastMovers})
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-[#B45309]" />
                Slow
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-[#64748B]" />
                Dead Stock
              </span>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => setControlsVisible((v) => !v)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/95 hover:bg-white border border-[#DCE6DF] text-xs font-semibold text-[#0D2818] cursor-pointer shadow-xs"
          title="Toggle 3D Controls (H)"
        >
          {controlsVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          <span>{controlsVisible ? 'Hide Controls' : 'Show Controls'}</span>
        </button>
      </div>

      {/* Collapsible Bottom Control Dock (Zero Center Occlusion, Solid High-Contrast Surface) */}
      {controlsVisible && (
        <div
          className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 w-[calc(100%-1.5rem)] max-w-4xl bg-white/96 border border-[#C6D5CA] rounded-xl shadow-lg overflow-hidden"
        >
          {/* Selected SKU Inspector Drawer (Integrated cleanly into the bottom dock) */}
          {selectedProduct && (
            <div className="px-4 py-3 bg-[#F5F9F6] border-b border-[#DCE6DF] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-display text-sm font-bold text-[#0D2818] truncate">
                    {selectedProduct.name}
                  </span>
                  <span className="font-mono text-[11px] text-[#54695B] shrink-0">
                    {selectedProduct.sku} · {selectedProduct.category}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#3F5346]">
                  <span className="font-mono tabular-nums">
                    Stock:{' '}
                    <strong
                      className={
                        selectedProduct.currentStock <= 0
                          ? 'text-[#B91C1C]'
                          : selectedProduct.currentStock <= selectedProduct.minStockLevel
                          ? 'text-[#B45309]'
                          : 'text-[#15803D]'
                      }
                    >
                      {selectedProduct.currentStock} {selectedProduct.unit}
                    </strong>{' '}
                    (Min {selectedProduct.minStockLevel})
                  </span>
                  <span className="font-mono tabular-nums">
                    Buy ₹{selectedProduct.purchasePrice} · Sell ₹{selectedProduct.sellingPrice}
                  </span>
                  {selectedForecast && (
                    <span className="font-mono tabular-nums">
                      7d AI Demand: <strong>{selectedForecast.expectedDemand7d}</strong> ({selectedForecast.avgDailySales.toFixed(1)}/day)
                    </span>
                  )}
                  {selectedExpiryDays !== null && (
                    <span
                      className={`font-mono tabular-nums font-semibold ${
                        selectedExpiryDays < 0
                          ? 'text-[#B91C1C]'
                          : selectedExpiryDays <= 15
                          ? 'text-[#B45309]'
                          : 'text-[#15803D]'
                      }`}
                    >
                      {selectedExpiryDays < 0
                        ? `Expired ${Math.abs(selectedExpiryDays)}d ago`
                        : `Expiry in ${selectedExpiryDays}d`}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setActiveView('sales')}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-[#15803D] hover:bg-[#166534] rounded-md cursor-pointer"
                >
                  <Receipt className="w-3.5 h-3.5" />
                  Bill
                </button>
                <button
                  type="button"
                  onClick={() => setActiveView('inventory')}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[#0D2818] bg-white hover:bg-[#EBF1EC] border border-[#C6D5CA] rounded-md cursor-pointer"
                >
                  <Package className="w-3.5 h-3.5 text-[#15803D]" />
                  Edit
                </button>
                {selectedExpiryDays !== null && selectedExpiryDays <= 30 && (
                  <button
                    type="button"
                    onClick={() => setActiveView('expiry')}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[#B91C1C] bg-red-50 hover:bg-red-100 border border-red-200 rounded-md cursor-pointer"
                  >
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Batches
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedProductId(null)}
                  className="p-1.5 text-[#54695B] hover:text-[#0D2818] rounded-md cursor-pointer"
                  aria-label="Close product inspector"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Primary Controls Bar */}
          <div className="px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-3">
            {/* Heatmap Overlay Mode Switcher */}
            <div className="inline-flex items-center gap-1 p-1 bg-[#EBF1EC] rounded-lg">
              <button
                type="button"
                onClick={() => setOverlayMode('stock')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                  overlayMode === 'stock'
                    ? 'bg-[#0D2818] text-white'
                    : 'text-[#3F5346] hover:text-[#0D2818]'
                }`}
              >
                <Box className="w-3.5 h-3.5" />
                Stock Health
              </button>
              <button
                type="button"
                onClick={() => setOverlayMode('expiry')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                  overlayMode === 'expiry'
                    ? 'bg-[#0D2818] text-white'
                    : 'text-[#3F5346] hover:text-[#0D2818]'
                }`}
              >
                <Flame className="w-3.5 h-3.5" />
                Expiry Heatmap
              </button>
              <button
                type="button"
                onClick={() => setOverlayMode('velocity')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                  overlayMode === 'velocity'
                    ? 'bg-[#0D2818] text-white'
                    : 'text-[#3F5346] hover:text-[#0D2818]'
                }`}
              >
                <TrendingUp className="w-3.5 h-3.5" />
                Demand Speed
              </button>
            </div>

            {/* Camera Preset Switcher */}
            <div className="flex flex-wrap items-center gap-1">
              {CAMERA_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleSelectPreset(preset)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                    activePreset === preset.id
                      ? 'bg-[#15803D] text-white border-[#15803D]'
                      : 'bg-white text-[#3F5346] border-[#DCE6DF] hover:bg-[#F2F7F3]'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            {/* Exploded Aisle Slider & Orbit Toggle */}
            <div className="flex items-center gap-2.5">
              <label className="inline-flex items-center gap-2 text-xs text-[#3F5346]">
                <Layers className="w-3.5 h-3.5 text-[#15803D]" />
                <span className="hidden sm:inline font-medium">Aisle Spread</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.02}
                  value={explodeFactor}
                  onChange={(e) => setExplodeFactor(Number(e.target.value))}
                  className="w-20 accent-[#15803D] cursor-pointer"
                  aria-label="Aisle spacing spread"
                />
              </label>

              <button
                type="button"
                onClick={() => setAutoOrbit((v) => !v)}
                className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md border cursor-pointer ${
                  autoOrbit
                    ? 'bg-[#ECF6EF] text-[#15803D] border-[#15803D]'
                    : 'bg-white text-[#3F5346] border-[#DCE6DF] hover:bg-[#F2F7F3]'
                }`}
                title="Toggle smooth auto-orbit"
              >
                <RotateCw className="w-3.5 h-3.5" />
                Orbit
              </button>

              <button
                type="button"
                onClick={() => {
                  setExplodeFactor(0);
                  setSelectedProductId(null);
                  setAutoOrbit(false);
                  handleSelectPreset(CAMERA_PRESETS[0]);
                }}
                className="p-1.5 text-[#3F5346] hover:text-[#0D2818] hover:bg-[#F2F7F3] rounded-md border border-[#DCE6DF] cursor-pointer"
                title="Reset camera & layout"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Collapsed Dock Expand Handle */}
      {!controlsVisible && (
        <button
          type="button"
          onClick={() => setControlsVisible(true)}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-white/95 hover:bg-white border border-[#C6D5CA] text-xs font-semibold text-[#0D2818] shadow-sm cursor-pointer"
        >
          <SlidersHorizontal className="w-3.5 h-3.5 text-[#15803D]" />
          3D Controls
          <ChevronUp className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
