import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

interface RuralVillage3DHeroProps {
  onUnavailable?: () => void;
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

function createTempoVehicle(bodyColor: number): THREE.Group {
  const group = new THREE.Group();

  const chassis = new THREE.Mesh(
    new THREE.BoxGeometry(0.46, 0.24, 0.86),
    new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.45, metalness: 0.25 })
  );
  chassis.position.set(0, 0.22, -0.08);
  group.add(chassis);

  const cab = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.24, 0.34),
    new THREE.MeshStandardMaterial({ color: 0xf8faf8, roughness: 0.4, metalness: 0.15 })
  );
  cab.position.set(0, 0.22, 0.45);
  group.add(cab);

  const headlightMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
  const leftLight = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.04), headlightMat);
  leftLight.position.set(-0.13, 0.18, 0.63);
  const rightLight = leftLight.clone();
  rightLight.position.x = 0.13;
  group.add(leftLight, rightLight);

  const wheelGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.08, 10);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.9 });
  for (const [wx, wz] of [
    [-0.24, 0.36],
    [0.24, 0.36],
    [-0.24, -0.26],
    [0.24, -0.26],
  ]) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.position.set(wx, 0.09, wz);
    group.add(wheel);
  }

  return group;
}

export default function RuralVillage3DHero({ onUnavailable }: RuralVillage3DHeroProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [webglFailed, setWebglFailed] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const isSoftware = detectSoftwareGl();
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftware,
        alpha: false,
        powerPreference: 'high-performance',
      });
    } catch {
      setWebglFailed(true);
      onUnavailable?.();
      return;
    }

    const width = container.clientWidth || 600;
    const height = container.clientHeight || 430;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isSoftware ? 1 : 1.5));
    renderer.setSize(width, height);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x06140d);
    scene.fog = new THREE.FogExp2(0x06140d, 0.036);

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 120);
    camera.position.set(9.8, 7.6, 11.4);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.55;
    controls.enablePan = false;
    controls.minDistance = 7;
    controls.maxDistance = 19;
    controls.minPolarAngle = Math.PI / 6;
    controls.maxPolarAngle = Math.PI / 2.25;
    controls.target.set(0, 0.5, 0);

    // Lighting — atmospheric moonlight + warm village glow
    const hemiLight = new THREE.HemisphereLight(0x6ee7b7, 0x052e16, 0.9);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xd1fae5, 1.35);
    dirLight.position.set(10, 16, 8);
    scene.add(dirLight);

    const warmShopLight = new THREE.PointLight(0xf59e0b, 3.2, 8);
    warmShopLight.position.set(0, 1.8, 0.6);
    scene.add(warmShopLight);

    const apmcLight = new THREE.PointLight(0x38bdf8, 2.2, 9);
    apmcLight.position.set(-5.2, 2.2, -3.6);
    scene.add(apmcLight);

    // Contoured rural village terrain
    const terrainGeo = new THREE.PlaneGeometry(34, 34, 32, 32);
    terrainGeo.rotateX(-Math.PI / 2);
    const pos = terrainGeo.attributes.position;
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const dist = Math.hypot(x, z);
      const hill = dist > 7.2 ? Math.sin(x * 0.35) * Math.cos(z * 0.35) * 0.7 + (dist - 7.2) * 0.09 : 0;
      pos.setY(i, hill);
    }
    terrainGeo.computeVertexNormals();
    const terrainMat = new THREE.MeshStandardMaterial({
      color: 0x0b2619,
      roughness: 0.92,
      metalness: 0.05,
    });
    const terrain = new THREE.Mesh(terrainGeo, terrainMat);
    scene.add(terrain);

    // Subtle spatial grid ring
    const gridHelper = new THREE.GridHelper(24, 24, 0x10b981, 0x0e3422);
    gridHelper.position.y = 0.02;
    const gridMaterials = Array.isArray(gridHelper.material)
      ? gridHelper.material
      : [gridHelper.material];
    for (const mat of gridMaterials) {
      mat.transparent = true;
      mat.opacity = 0.24;
    }
    scene.add(gridHelper);

    // Central Kirana Storefront
    const kiranaGroup = new THREE.Group();
    const basePlatform = new THREE.Mesh(
      new THREE.CylinderGeometry(1.75, 1.9, 0.14, 24),
      new THREE.MeshStandardMaterial({ color: 0x113624, roughness: 0.7 })
    );
    basePlatform.position.y = 0.07;
    kiranaGroup.add(basePlatform);

    const shopBody = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 1.35, 1.75),
      new THREE.MeshStandardMaterial({ color: 0xe6f0e9, roughness: 0.65 })
    );
    shopBody.position.y = 0.8;
    kiranaGroup.add(shopBody);

    const shopRoof = new THREE.Mesh(
      new THREE.BoxGeometry(2.5, 0.22, 2.05),
      new THREE.MeshStandardMaterial({ color: 0x10b981, roughness: 0.45, metalness: 0.2 })
    );
    shopRoof.position.y = 1.58;
    kiranaGroup.add(shopRoof);

    const awning = new THREE.Mesh(
      new THREE.BoxGeometry(2.05, 0.12, 0.55),
      new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.5 })
    );
    awning.position.set(0, 1.22, 1.05);
    awning.rotation.x = 0.25;
    kiranaGroup.add(awning);

    const shopWindow = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 0.62, 0.08),
      new THREE.MeshBasicMaterial({ color: 0xfde68a })
    );
    shopWindow.position.set(0, 0.74, 0.88);
    kiranaGroup.add(shopWindow);

    scene.add(kiranaGroup);

    // Wholesale APMC Depot Hub (Northwest)
    const depotPos = new THREE.Vector3(-5.2, 0, -3.6);
    const depotGroup = new THREE.Group();
    depotGroup.position.copy(depotPos);
    const depotBody = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 1.45, 1.9),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.55, metalness: 0.3 })
    );
    depotBody.position.y = 0.725;
    const depotRoof = new THREE.Mesh(
      new THREE.BoxGeometry(2.75, 0.18, 2.05),
      new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.4, metalness: 0.35 })
    );
    depotRoof.position.y = 1.54;
    const depotBay = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.75, 0.08),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
    );
    depotBay.position.set(0, 0.45, 0.96);
    depotGroup.add(depotBody, depotRoof, depotBay);
    scene.add(depotGroup);

    // Neighboring Village Shop Nodes with Demand Pillars
    const villageConfigs = [
      { pos: new THREE.Vector3(4.8, 0, -3.2), color: 0x10b981, towerH: 1.9 },
      { pos: new THREE.Vector3(5.3, 0, 2.7), color: 0xf59e0b, towerH: 2.4 },
      { pos: new THREE.Vector3(-4.4, 0, 3.8), color: 0xef4444, towerH: 2.8 },
      { pos: new THREE.Vector3(0.4, 0, -5.5), color: 0x34d399, towerH: 1.5 },
    ];

    const pulseRings: THREE.Mesh[] = [];
    for (const v of villageConfigs) {
      const vg = new THREE.Group();
      vg.position.copy(v.pos);

      const house = new THREE.Mesh(
        new THREE.BoxGeometry(1.25, 0.85, 1.15),
        new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.7 })
      );
      house.position.y = 0.425;
      vg.add(house);

      const roof = new THREE.Mesh(
        new THREE.ConeGeometry(0.98, 0.55, 4),
        new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.6 })
      );
      roof.position.y = 1.12;
      roof.rotation.y = Math.PI / 4;
      vg.add(roof);

      const win = new THREE.Mesh(
        new THREE.BoxGeometry(0.45, 0.32, 0.06),
        new THREE.MeshBasicMaterial({ color: 0xfef3c7 })
      );
      win.position.set(0, 0.45, 0.58);
      vg.add(win);

      // Telemetry demand pillar beside village store
      const pillar = new THREE.Mesh(
        new THREE.BoxGeometry(0.28, v.towerH, 0.28),
        new THREE.MeshStandardMaterial({
          color: v.color,
          emissive: v.color,
          emissiveIntensity: 0.45,
          roughness: 0.3,
        })
      );
      pillar.position.set(0.95, v.towerH / 2, 0);
      vg.add(pillar);

      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.9, 1.06, 24),
        new THREE.MeshBasicMaterial({
          color: v.color,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.55,
        })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.05;
      vg.add(ring);
      pulseRings.push(ring);

      scene.add(vg);
    }

    // Group Order Trade Arcs from APMC Depot to Kirana + Villages
    const arcTargets = [new THREE.Vector3(0, 1.2, 0), ...villageConfigs.map((v) => v.pos.clone().setY(1.0))];
    for (const target of arcTargets) {
      const mid = depotPos.clone().add(target).multiplyScalar(0.5);
      mid.y = 3.1 + Math.random() * 0.8;
      const curve = new THREE.QuadraticBezierCurve3(
        depotPos.clone().setY(1.4),
        mid,
        target
      );
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 24, 0.045, 6, false),
        new THREE.MeshBasicMaterial({
          color: 0x34d399,
          transparent: true,
          opacity: 0.52,
        })
      );
      scene.add(tube);
    }

    // Rural Road Spline + 2 Animated Cargo Tempos
    const roadCurve = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(-4.5, 0.06, -2.5),
        new THREE.Vector3(-1.8, 0.06, -0.6),
        new THREE.Vector3(1.6, 0.06, -1.8),
        new THREE.Vector3(4.2, 0.06, -2.1),
        new THREE.Vector3(4.6, 0.06, 1.9),
        new THREE.Vector3(0.4, 0.06, 2.6),
        new THREE.Vector3(-3.4, 0.06, 2.9),
        new THREE.Vector3(-5.0, 0.06, 0.4),
      ],
      true
    );

    const roadMesh = new THREE.Mesh(
      new THREE.TubeGeometry(roadCurve, 72, 0.14, 6, true),
      new THREE.MeshStandardMaterial({ color: 0x1e3a2b, roughness: 0.85 })
    );
    roadMesh.scale.y = 0.25;
    scene.add(roadMesh);

    const tempoA = createTempoVehicle(0x10b981);
    const tempoB = createTempoVehicle(0xf59e0b);
    scene.add(tempoA, tempoB);

    // Stylized Low-Poly Village Trees around perimeter
    const treeCoords = [
      [-6.8, 1.5],
      [-2.5, -5.8],
      [3.1, -6.2],
      [6.9, -0.4],
      [3.5, 5.4],
      [-1.8, 6.0],
      [-6.6, -5.4],
      [6.6, 4.9],
    ];
    const trunkGeo = new THREE.CylinderGeometry(0.08, 0.11, 0.55, 6);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x451a03, roughness: 0.95 });
    const foliageGeo = new THREE.ConeGeometry(0.48, 1.2, 7);
    const foliageMat = new THREE.MeshStandardMaterial({ color: 0x14532d, roughness: 0.8 });
    for (const [tx, tz] of treeCoords) {
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.set(tx, 0.28, tz);
      const foliage = new THREE.Mesh(foliageGeo, foliageMat);
      foliage.position.set(tx, 1.0, tz);
      scene.add(trunk, foliage);
    }

    // ResizeObserver for crisp responsive viewport
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

      const tA = (elapsed * 0.055) % 1;
      const pA = roadCurve.getPointAt(tA);
      const lookA = roadCurve.getPointAt((tA + 0.01) % 1);
      tempoA.position.set(pA.x, 0.06, pA.z);
      tempoA.lookAt(lookA.x, 0.06, lookA.z);

      const tB = (elapsed * 0.055 + 0.5) % 1;
      const pB = roadCurve.getPointAt(tB);
      const lookB = roadCurve.getPointAt((tB + 0.01) % 1);
      tempoB.position.set(pB.x, 0.06, pB.z);
      tempoB.lookAt(lookB.x, 0.06, lookB.z);

      // Gentle scale breathe on village telemetry rings
      pulseRings.forEach((ring, idx) => {
        const s = 1 + 0.12 * Math.sin(elapsed * 2 + idx * 1.4);
        ring.scale.set(s, s, 1);
      });

      controls.update();
      renderer.render(scene, camera);
    };

    animate();

    return () => {
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
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
  }, [onUnavailable]);

  if (webglFailed) return null;

  return (
    <div className="relative w-full h-full min-h-[340px] lg:min-h-[430px] bg-[#06140D]">
      <div ref={containerRef} className="w-full h-full cursor-grab active:cursor-grabbing" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 p-3.5 bg-gradient-to-t from-[#06140D]/90 via-[#06140D]/45 to-transparent flex flex-wrap items-center justify-between gap-2 text-[11px] text-emerald-100/85">
        <span className="font-medium">
          Interactive 3D Village Supply Network · Drag to orbit, scroll to zoom
        </span>
        <span className="font-mono text-[10px] text-[#6EE7B7]">
          Kirana Hub · APMC Wholesale · 2-Opt Routes
        </span>
      </div>
    </div>
  );
}
