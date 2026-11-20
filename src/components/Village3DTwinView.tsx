import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Compass, Layers, MapPin, Route, Store, Truck, X } from 'lucide-react';
import { useShop } from '../context/ShopContext.tsx';
import type { ActiveView } from '../types/dukaaniq.ts';

type NetworkOverlay = 'all' | 'demand' | 'group_orders' | 'delivery';
type CameraPreset = 'overview' | 'shop' | 'apmc' | 'top';

interface SelectedNodeInfo {
  kind: 'shop' | 'village' | 'distributor';
  title: string;
  subtitle: string;
  severity?: string;
  metrics: Array<{ label: string; value: string }>;
  note: string;
  actionLabel: string;
  actionView: ActiveView;
}

function detectSoftwareGl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return true;
    const debugInfo = (gl as WebGLRenderingContext).getExtension('WEBGL_debug_renderer_info');
    if (!debugInfo) return false;
    const renderer = String(
      (gl as WebGLRenderingContext).getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || ''
    ).toLowerCase();
    return renderer.includes('swiftshader') || renderer.includes('llvmpipe') || renderer.includes('software');
  } catch {
    return true;
  }
}

function projectLatLng(
  lat: number,
  lng: number,
  originLat: number,
  originLng: number
): { x: number; z: number } {
  // Scale regional village deltas (~0.01 to 0.25 deg) onto a readable 3D valley (-11..11)
  const dx = (lng - originLng) * 52;
  const dz = -(lat - originLat) * 52;
  return {
    x: Math.max(-11.5, Math.min(11.5, dx)),
    z: Math.max(-11.5, Math.min(11.5, dz)),
  };
}

function severityColor(sev: string): number {
  if (sev === 'high') return 0xdc2626;
  if (sev === 'moderate') return 0xd97706;
  return 0x15803d;
}

function createMiniTempo(colorHex: number): THREE.Group {
  const g = new THREE.Group();
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(0.44, 0.26, 0.78),
    new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.45 })
  );
  box.position.set(0, 0.2, -0.08);
  const cab = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.24, 0.3),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 })
  );
  cab.position.set(0, 0.2, 0.42);
  g.add(box, cab);
  return g;
}

export default function Village3DTwinView() {
  const { workspace, setActiveView } = useShop();
  const mountRef = useRef<HTMLDivElement | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);

  const [overlay, setOverlay] = useState<NetworkOverlay>('all');
  const [preset, setPreset] = useState<CameraPreset>('overview');
  const [selected, setSelected] = useState<SelectedNodeInfo | null>(null);
  const [webglError, setWebglError] = useState(false);

  const originLat = workspace?.shop.latitude ?? 12.2958;
  const originLng = workspace?.shop.longitude ?? 76.6394;

  // Aggregate unique distributor hubs from live distributorOffers
  const distributorHubs = useMemo(() => {
    if (!workspace) return [];
    const map = new Map<
      string,
      {
        name: string;
        city: string;
        lat: number;
        lng: number;
        offerCount: number;
        totalUnits: number;
        verified: boolean;
      }
    >();
    for (const offer of workspace.distributorOffers || []) {
      const existing = map.get(offer.distributorName);
      if (existing) {
        existing.offerCount += 1;
        existing.totalUnits += offer.availableQty;
      } else {
        map.set(offer.distributorName, {
          name: offer.distributorName,
          city: offer.distributorCity,
          lat: offer.latitude ?? originLat + 0.06,
          lng: offer.longitude ?? originLng - 0.07,
          offerCount: 1,
          totalUnits: offer.availableQty,
          verified: offer.verified,
        });
      }
    }
    return Array.from(map.values());
  }, [workspace, originLat, originLng]);

  const applyCameraPreset = (nextPreset: CameraPreset) => {
    setPreset(nextPreset);
    const cam = cameraRef.current;
    const ctrl = controlsRef.current;
    if (!cam || !ctrl) return;

    if (nextPreset === 'overview') {
      cam.position.set(13.5, 11.5, 14.5);
      ctrl.target.set(0, 0.6, 0);
    } else if (nextPreset === 'shop') {
      cam.position.set(4.5, 4.2, 5.2);
      ctrl.target.set(0, 0.8, 0);
    } else if (nextPreset === 'apmc') {
      const firstHub = distributorHubs[0];
      const p = firstHub
        ? projectLatLng(firstHub.lat, firstHub.lng, originLat, originLng)
        : { x: -4.5, z: -3.5 };
      cam.position.set(p.x + 5.5, 5.5, p.z + 6.2);
      ctrl.target.set(p.x, 0.8, p.z);
    } else if (nextPreset === 'top') {
      cam.position.set(0.1, 22, 0.1);
      ctrl.target.set(0, 0, 0);
    }
    ctrl.update();
  };

  useEffect(() => {
    if (!workspace || !mountRef.current) return;
    const container = mountRef.current;
    const isSoftware = detectSoftwareGl();

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftware,
        powerPreference: 'high-performance',
      });
    } catch {
      setWebglError(true);
      return;
    }

    const width = container.clientWidth || 900;
    const height = container.clientHeight || 560;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isSoftware ? 1 : 1.5));
    renderer.setSize(width, height);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.04;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeaf2ec);
    scene.fog = new THREE.Fog(0xeaf2ec, 24, 52);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 140);
    camera.position.set(13.5, 11.5, 14.5);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 5;
    controls.maxDistance = 30;
    controls.maxPolarAngle = Math.PI / 2.15;
    controls.target.set(0, 0.6, 0);
    controlsRef.current = controls;

    // Daylight crisp spatial lighting
    const hemi = new THREE.HemisphereLight(0xffffff, 0xb7dfc1, 1.05);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfffbeb, 1.1);
    sun.position.set(14, 22, 12);
    scene.add(sun);

    // Valley floor & topographic grid
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(42, 42),
      new THREE.MeshStandardMaterial({ color: 0xdce8df, roughness: 0.92 })
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    const grid = new THREE.GridHelper(32, 32, 0x94b89f, 0xc3d7c9);
    grid.position.y = 0.02;
    scene.add(grid);

    const clickables: Array<{ mesh: THREE.Object3D; info: SelectedNodeInfo }> = [];

    // 1. Central Active Kirana Shop Hub
    const shopGroup = new THREE.Group();
    const shopPad = new THREE.Mesh(
      new THREE.CylinderGeometry(1.4, 1.55, 0.16, 20),
      new THREE.MeshStandardMaterial({ color: 0x0d2818, roughness: 0.7 })
    );
    shopPad.position.y = 0.08;
    const shopBody = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 1.15, 1.45),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55 })
    );
    shopBody.position.y = 0.72;
    const shopRoof = new THREE.Mesh(
      new THREE.BoxGeometry(2.05, 0.22, 1.7),
      new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.4 })
    );
    shopRoof.position.y = 1.4;
    shopGroup.add(shopPad, shopBody, shopRoof);
    scene.add(shopGroup);

    const shopInfo: SelectedNodeInfo = {
      kind: 'shop',
      title: workspace.shop.name,
      subtitle: `${workspace.shop.city}, ${workspace.shop.state} · Your Active Store`,
      metrics: [
        { label: 'Active Products', value: String(workspace.products.length) },
        { label: 'Open Group Pools', value: String((workspace.groupOrders || []).length) },
        { label: 'Delivery Runs', value: String((workspace.deliveryRuns || []).length) },
      ],
      note: 'Center anchor of your rural supply network. Click neighboring village clusters or wholesale hubs to inspect regional signals.',
      actionLabel: 'Open 3D Store Interior',
      actionView: 'store3d',
    };
    clickables.push({ mesh: shopBody, info: shopInfo }, { mesh: shopRoof, info: shopInfo });

    // 2. Village Demand Clusters (Opted-in signals)
    const villagePositions = new Map<string, THREE.Vector3>();
    const signals = (workspace.villageDemandSignals || []).filter((s) => s.isOptedIn);

    signals.forEach((sig, index) => {
      let projected = projectLatLng(sig.latitude, sig.longitude, originLat, originLng);
      // Avoid exact overlap with center shop
      if (Math.hypot(projected.x, projected.z) < 2.2) {
        const angle = (index / Math.max(1, signals.length)) * Math.PI * 2 + 0.5;
        projected = { x: Math.cos(angle) * 4.2, z: Math.sin(angle) * 4.2 };
      }
      const posVec = new THREE.Vector3(projected.x, 0, projected.z);
      villagePositions.set(sig.villageName.toLowerCase(), posVec);

      const vg = new THREE.Group();
      vg.position.copy(posVec);

      const pad = new THREE.Mesh(
        new THREE.CylinderGeometry(1.05, 1.15, 0.1, 16),
        new THREE.MeshStandardMaterial({ color: 0xc5d9cb, roughness: 0.85 })
      );
      pad.position.y = 0.05;
      vg.add(pad);

      const cottage = new THREE.Mesh(
        new THREE.BoxGeometry(1.0, 0.72, 0.9),
        new THREE.MeshStandardMaterial({ color: 0xf8faf8, roughness: 0.65 })
      );
      cottage.position.set(-0.22, 0.44, 0);
      vg.add(cottage);

      const roof = new THREE.Mesh(
        new THREE.ConeGeometry(0.76, 0.42, 4),
        new THREE.MeshStandardMaterial({ color: 0x0d2818, roughness: 0.65 })
      );
      roof.position.set(-0.22, 1.0, 0);
      roof.rotation.y = Math.PI / 4;
      vg.add(roof);

      const towerHeight = Math.max(0.8, Math.min(4.2, sig.estimatedWeeklyUnits / 65));
      const color = severityColor(sig.shortageSeverity);
      const showTower = overlay === 'all' || overlay === 'demand';
      const tower = new THREE.Mesh(
        new THREE.BoxGeometry(0.42, showTower ? towerHeight : 0.45, 0.42),
        new THREE.MeshStandardMaterial({
          color,
          roughness: 0.35,
          metalness: 0.15,
        })
      );
      tower.position.set(0.55, (showTower ? towerHeight : 0.45) / 2 + 0.08, 0);
      vg.add(tower);

      scene.add(vg);

      const nodeInfo: SelectedNodeInfo = {
        kind: 'village',
        title: `${sig.villageName} Village Cluster`,
        subtitle: `${sig.district} · ${sig.isDemoData ? 'Demo Cluster Signal' : 'Opted-In Live Signal'}`,
        severity: sig.shortageSeverity,
        metrics: [
          { label: 'Connected Shops', value: String(sig.connectedShopsCount) },
          { label: 'Est. Weekly Demand', value: `${sig.estimatedWeeklyUnits} units` },
          { label: 'Top Needed Item', value: sig.topProduct },
        ],
        note: `Top category: ${sig.topCategory}. Only aggregated village-level counts are shared; private shop records remain isolated.`,
        actionLabel: 'Inspect on Village Map',
        actionView: 'village_map',
      };
      clickables.push({ mesh: cottage, info: nodeInfo }, { mesh: tower, info: nodeInfo });
    });

    // 3. Wholesale Distributor Hubs
    const hubPositions = new Map<string, THREE.Vector3>();
    distributorHubs.forEach((hub, idx) => {
      let projected = projectLatLng(hub.lat, hub.lng, originLat, originLng);
      if (Math.hypot(projected.x, projected.z) < 2.6) {
        const angle = idx * 1.9 + 2.2;
        projected = { x: Math.cos(angle) * 6.4, z: Math.sin(angle) * 6.4 };
      }
      const posVec = new THREE.Vector3(projected.x, 0, projected.z);
      hubPositions.set(hub.name, posVec);

      const hg = new THREE.Group();
      hg.position.copy(posVec);

      const warehouse = new THREE.Mesh(
        new THREE.BoxGeometry(2.1, 1.25, 1.55),
        new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.5 })
      );
      warehouse.position.y = 0.625;
      const roof = new THREE.Mesh(
        new THREE.BoxGeometry(2.25, 0.18, 1.7),
        new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.4 })
      );
      roof.position.y = 1.34;
      hg.add(warehouse, roof);
      scene.add(hg);

      const hubInfo: SelectedNodeInfo = {
        kind: 'distributor',
        title: hub.name,
        subtitle: `${hub.city} · ${hub.verified ? 'Verified Wholesale Hub' : 'Partner Distributor'}`,
        metrics: [
          { label: 'Bulk Catalog Offers', value: String(hub.offerCount) },
          { label: 'Available Units', value: hub.totalUnits.toLocaleString('en-IN') },
        ],
        note: 'Connects directly with rural group purchasing pools and dispatches multi-stop shared delivery runs.',
        actionLabel: 'Open Distributor Portal',
        actionView: 'distributor',
      };
      clickables.push({ mesh: warehouse, info: hubInfo }, { mesh: roof, info: hubInfo });
    });

    // 4. Elevated Trade Arcs for Active Group Orders
    if (overlay === 'all' || overlay === 'group_orders') {
      for (const pool of workspace.groupOrders || []) {
        if (pool.status === 'cancelled') continue;
        const sourcePos =
          hubPositions.get(pool.distributorName) ||
          Array.from(hubPositions.values())[0] ||
          new THREE.Vector3(-5.5, 0, -4.5);

        const targetVillages = pool.members
          .map((m) => villagePositions.get(m.village.toLowerCase()))
          .filter((v): v is THREE.Vector3 => Boolean(v));
        const targets = targetVillages.length > 0 ? targetVillages : [new THREE.Vector3(0, 0, 0)];

        for (const t of targets) {
          const mid = sourcePos.clone().add(t).multiplyScalar(0.5);
          mid.y = 3.2;
          const curve = new THREE.QuadraticBezierCurve3(
            sourcePos.clone().setY(1.3),
            mid,
            t.clone().setY(1.0)
          );
          const arcColor = pool.distributorAccepted
            ? 0x15803d
            : pool.ownerApproved
            ? 0x0284c7
            : 0xd97706;
          const tube = new THREE.Mesh(
            new THREE.TubeGeometry(curve, 24, 0.06, 6, false),
            new THREE.MeshBasicMaterial({
              color: arcColor,
              transparent: true,
              opacity: 0.75,
            })
          );
          scene.add(tube);
        }
      }
    }

    // 5. Delivery Route Ribbons + Animated Cargo Tempos
    const animatedTempos: Array<{
      vehicle: THREE.Group;
      curve: THREE.CatmullRomCurve3;
      speed: number;
      offset: number;
    }> = [];

    if (overlay === 'all' || overlay === 'delivery') {
      (workspace.deliveryRuns || []).forEach((run, runIdx) => {
        if (run.status === 'cancelled' || run.stops.length === 0) return;
        const originP = projectLatLng(run.originLat, run.originLng, originLat, originLng);
        const pts: THREE.Vector3[] = [new THREE.Vector3(originP.x, 0.14, originP.z)];
        const sortedStops = [...run.stops].sort((a, b) => a.sequenceOrder - b.sequenceOrder);
        for (const stop of sortedStops) {
          const sp = projectLatLng(stop.latitude, stop.longitude, originLat, originLng);
          pts.push(new THREE.Vector3(sp.x, 0.14, sp.z));
        }
        if (pts.length < 2) return;

        const curve = new THREE.CatmullRomCurve3(pts, false);
        const routeColor = runIdx % 2 === 0 ? 0x15803d : 0x0284c7;
        const ribbon = new THREE.Mesh(
          new THREE.TubeGeometry(curve, 48, 0.09, 6, false),
          new THREE.MeshStandardMaterial({ color: routeColor, roughness: 0.5 })
        );
        ribbon.scale.y = 0.35;
        scene.add(ribbon);

        const vehicle = createMiniTempo(routeColor);
        scene.add(vehicle);
        animatedTempos.push({
          vehicle,
          curve,
          speed: 0.08 + runIdx * 0.015,
          offset: runIdx * 0.35,
        });
      });
    }

    // Pointer Raycaster for clicking any 3D hub
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerDownPos = { x: 0, y: 0 };

    const onPointerDown = (e: PointerEvent) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
    };

    const onPointerUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y) > 6) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(
        clickables.map((c) => c.mesh),
        false
      );
      if (hits.length > 0) {
        const hitObj = hits[0].object;
        const found = clickables.find((c) => c.mesh === hitObj);
        if (found) setSelected(found.info);
      }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.max(1, Math.floor(entry.contentRect.width));
        const h = Math.max(1, Math.floor(entry.contentRect.height));
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      }
    });
    resizeObserver.observe(container);

    const clock = new THREE.Clock();
    let frameId = 0;

    const animate = () => {
      frameId = requestAnimationFrame(animate);
      const elapsed = clock.getElapsedTime();

      for (const item of animatedTempos) {
        const t = (elapsed * item.speed + item.offset) % 1;
        const posPt = item.curve.getPointAt(t);
        const lookPt = item.curve.getPointAt(Math.min(0.999, t + 0.02));
        item.vehicle.position.set(posPt.x, 0.14, posPt.z);
        item.vehicle.lookAt(lookPt.x, 0.14, lookPt.z);
      }

      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      controls.dispose();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry?.dispose();
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => m.dispose());
          } else {
            obj.material?.dispose();
          }
        }
      });
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [workspace, distributorHubs, overlay, originLat, originLng]);

  if (!workspace) return null;

  const activeSignalsCount = (workspace.villageDemandSignals || []).filter((s) => s.isOptedIn).length;
  const activePoolsCount = (workspace.groupOrders || []).filter((g) => g.status !== 'cancelled').length;
  const activeRunsCount = (workspace.deliveryRuns || []).filter((r) => r.status !== 'cancelled').length;

  return (
    <div className="space-y-4">
      {/* Compact Spatial Controls Header */}
      <div className="bg-white border border-[#DCE6DF] rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: 'all', label: 'Full Network' },
              { id: 'demand', label: `Demand Towers (${activeSignalsCount})` },
              { id: 'group_orders', label: `Group Trade Arcs (${activePoolsCount})` },
              { id: 'delivery', label: `Delivery Routes (${activeRunsCount})` },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setOverlay(item.id)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap cursor-pointer ${
                overlay === item.id
                  ? 'bg-[#0D2818] text-white border-[#0D2818]'
                  : 'bg-[#F5F9F6] text-[#3F5346] border-[#DCE6DF] hover:bg-[#EBF1EC]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Compass className="w-4 h-4 text-[#15803D] mr-1" />
          {(
            [
              { id: 'overview', label: 'District Overview' },
              { id: 'shop', label: 'Your Shop' },
              { id: 'apmc', label: 'Wholesale Hub' },
              { id: 'top', label: 'Top-Down' },
            ] as const
          ).map((cam) => (
            <button
              key={cam.id}
              type="button"
              onClick={() => applyCameraPreset(cam.id)}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap cursor-pointer ${
                preset === cam.id
                  ? 'bg-[#15803D] text-white border-[#15803D]'
                  : 'bg-white text-[#3F5346] border-[#C6D5CA] hover:bg-[#F2F7F3]'
              }`}
            >
              {cam.label}
            </button>
          ))}
        </div>
      </div>

      {/* 3D Interactive Canvas + Inspection HUD */}
      <div className="relative w-full h-[calc(100vh-14.5rem)] min-h-[500px] bg-[#EAF2EC] border border-[#DCE6DF] rounded-2xl overflow-hidden">
        {webglError ? (
          <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center">
            <p className="font-display text-lg font-bold text-[#0D2818]">
              WebGL 3D View Unavailable on This Device
            </p>
            <p className="mt-2 text-sm text-[#4D6154] max-w-md">
              Use the interactive 2D Leaflet Village Demand Map and Delivery Logistics routes instead.
            </p>
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={() => setActiveView('village_map')}
                className="px-4 py-2 text-xs font-semibold text-white bg-[#15803D] rounded-lg cursor-pointer"
              >
                Open Village Map
              </button>
              <button
                type="button"
                onClick={() => setActiveView('logistics')}
                className="px-4 py-2 text-xs font-semibold text-[#0D2818] bg-white border border-[#C6D5CA] rounded-lg cursor-pointer"
              >
                Open Delivery Routes
              </button>
            </div>
          </div>
        ) : (
          <div ref={mountRef} className="w-full h-full cursor-grab active:cursor-grabbing" />
        )}

        {/* Bottom-Left Compact Spatial Legend */}
        <div className="pointer-events-none absolute bottom-4 left-4 bg-white/92 backdrop-blur-xs border border-[#DCE6DF] rounded-xl px-3.5 py-2.5 text-[11px] text-[#0D2818] space-y-1 shadow-xs">
          <p className="font-semibold">3D Village Supply Legend (Click any hub to inspect)</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[#4D6154]">
            <span>Green Roof: Your Kirana</span>
            <span>·</span>
            <span>Blue Warehouse: APMC Wholesale</span>
            <span>·</span>
            <span>Red/Amber/Green Towers: Village Shortage Demand</span>
          </div>
        </div>

        {/* Floating Selection Inspector HUD */}
        {selected && (
          <div className="absolute top-4 right-4 w-80 max-w-[calc(100%-2rem)] bg-white/96 backdrop-blur-xs border border-[#DCE6DF] rounded-xl p-4 shadow-lg space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[#15803D]">
                  {selected.kind === 'shop' ? (
                    <Store className="w-4 h-4 shrink-0" />
                  ) : selected.kind === 'distributor' ? (
                    <Truck className="w-4 h-4 shrink-0 text-[#0284C7]" />
                  ) : (
                    <MapPin className="w-4 h-4 shrink-0" />
                  )}
                  <h3 className="font-display text-sm font-bold text-[#0D2818] truncate">
                    {selected.title}
                  </h3>
                </div>
                <p className="text-[11px] text-[#54695B] mt-0.5">{selected.subtitle}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label="Close inspector"
                className="p-1 text-[#54695B] hover:text-[#0D2818] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {selected.metrics.map((m) => (
                <div
                  key={m.label}
                  className="bg-[#F5F9F6] border border-[#E2EAE4] rounded-lg px-2.5 py-2"
                >
                  <p className="text-[10px] text-[#54695B]">{m.label}</p>
                  <p className="font-mono text-xs font-bold text-[#0D2818] tabular-nums truncate mt-0.5">
                    {m.value}
                  </p>
                </div>
              ))}
            </div>

            <p className="text-xs text-[#4D6154] leading-relaxed">{selected.note}</p>

            <button
              type="button"
              onClick={() => setActiveView(selected.actionView)}
              className="w-full py-2 text-xs font-semibold text-white bg-[#15803D] hover:bg-[#166534] rounded-lg transition-colors cursor-pointer"
            >
              {selected.actionLabel}
            </button>
          </div>
        )}
      </div>

      {/* Quick Deep-Links Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <button
          type="button"
          onClick={() => setActiveView('village_map')}
          className="bg-white border border-[#DCE6DF] hover:border-[#15803D] rounded-xl p-3.5 text-left flex items-center gap-3 transition-colors cursor-pointer"
        >
          <MapPin className="w-5 h-5 text-[#15803D] shrink-0" />
          <div>
            <p className="text-xs font-bold text-[#0D2818]">2D OpenStreetMap Demand Map</p>
            <p className="text-[11px] text-[#54695B]">Manage privacy opt-in &amp; village pins</p>
          </div>
        </button>
        <button
          type="button"
          onClick={() => setActiveView('group_buying')}
          className="bg-white border border-[#DCE6DF] hover:border-[#15803D] rounded-xl p-3.5 text-left flex items-center gap-3 transition-colors cursor-pointer"
        >
          <Layers className="w-5 h-5 text-[#15803D] shrink-0" />
          <div>
            <p className="text-xs font-bold text-[#0D2818]">Smart Group Purchasing ({activePoolsCount})</p>
            <p className="text-[11px] text-[#54695B]">Join or approve collective bulk pools</p>
          </div>
        </button>
        <button
          type="button"
          onClick={() => setActiveView('logistics')}
          className="bg-white border border-[#DCE6DF] hover:border-[#15803D] rounded-xl p-3.5 text-left flex items-center gap-3 transition-colors cursor-pointer"
        >
          <Route className="w-5 h-5 text-[#15803D] shrink-0" />
          <div>
            <p className="text-xs font-bold text-[#0D2818]">AI Delivery Routes ({activeRunsCount})</p>
            <p className="text-[11px] text-[#54695B]">Plan 2-Opt multi-stop cargo runs</p>
          </div>
        </button>
      </div>
    </div>
  );
}
