"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import type { BufferGeometry } from "three";

type Mood = { strength: number; count: number; speed: number };

function getMood(path: string): Mood {
  if (path === "/") return { strength: 1, count: 8, speed: 1 };
  if (path.startsWith("/onboarding")) return { strength: 0.27, count: 5, speed: 0.54 };
  if (path === "/discover") return { strength: 0.38, count: 6, speed: 0.62 };
  if (path === "/chat" || path.startsWith("/chat/") || path.startsWith("/settings")) {
    return { strength: 0.16, count: 4, speed: 0.42 };
  }
  if (
    ["/search", "/matches", "/notifications", "/profile"].includes(path) ||
    path.startsWith("/profile/") ||
    path.startsWith("/u/")
  ) {
    return { strength: 0.3, count: 5, speed: 0.52 };
  }
  return { strength: 0, count: 0, speed: 0 };
}

/** One decorative WebGL layer shared by every route in the persistent root layout. */
export function AmbientHeartField() {
  const pathname = usePathname();
  const active = getMood(pathname).count > 0;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const moodRef = useRef(getMood(pathname));
  const syncRef = useRef<() => void>(() => {});

  useEffect(() => {
    moodRef.current = getMood(pathname);
    syncRef.current();
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | undefined;

    if (!active) return;

    void import("three").then((THREE) => {
      if (cancelled || !canvasRef.current) return;

      const canvas = canvasRef.current;
      const renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: "low-power",
      });
      renderer.setClearColor(0x000000, 0);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 40);
      camera.position.z = 8;
      const heartColor = new THREE.Color(
        getComputedStyle(document.documentElement).getPropertyValue("--ambient-heart").trim(),
      );

      // Each heart is a single fine Bezier gesture. Small per-instance changes
      // to the lobes and point keep the field from reading as repeated icons.
      const heartGeometries: BufferGeometry[] = [];
      const placements = [
        [-0.76, 0.6], [0.77, 0.53], [-0.84, -0.12], [0.84, -0.2],
        [-0.69, -0.67], [0.69, -0.66], [-0.38, 0.82], [0.4, -0.83],
      ];
      const hearts = placements.map(([nx, ny], i) => {
        const seed = (i * 0.61803398875 + 0.17) % 1;
        const variation = seed - 0.5;
        const point = new THREE.Vector3(0, -0.89 + variation * 0.08, 0);
        const left = new THREE.CubicBezierCurve3(
          new THREE.Vector3(0, -0.89 + variation * 0.08, 0),
          new THREE.Vector3(-0.2 - variation * 0.07, -0.65, 0),
          new THREE.Vector3(-1.08, -0.05 + variation * 0.06, 0),
          new THREE.Vector3(-1.08 + variation * 0.07, 0.48, 0),
        );
        const leftLobe = new THREE.CubicBezierCurve3(
          left.getPoint(1), new THREE.Vector3(-1.08, 1.12 + variation * 0.08, 0),
          new THREE.Vector3(-0.28, 1.23 - variation * 0.05, 0), new THREE.Vector3(0, 0.68, 0),
        );
        const rightLobe = new THREE.CubicBezierCurve3(
          new THREE.Vector3(0, 0.68, 0), new THREE.Vector3(0.28, 1.23 + variation * 0.05, 0),
          new THREE.Vector3(1.08, 1.12 - variation * 0.08, 0), new THREE.Vector3(1.08 - variation * 0.07, 0.48, 0),
        );
        const right = new THREE.CubicBezierCurve3(
          rightLobe.getPoint(1), new THREE.Vector3(1.08, -0.05 - variation * 0.06, 0),
          new THREE.Vector3(0.2 + variation * 0.07, -0.65, 0), point,
        );
        const points = [...left.getPoints(10), ...leftLobe.getPoints(10).slice(1), ...rightLobe.getPoints(10).slice(1), ...right.getPoints(10).slice(1)];
        const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
        lineGeometry.setDrawRange(0, 0);
        heartGeometries.push(lineGeometry);
        const lineMaterial = new THREE.LineBasicMaterial({
          color: heartColor,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        });
        const group = new THREE.Group();
        group.add(new THREE.Line(lineGeometry, lineMaterial));
        scene.add(group);
        return {
          group,
          lineMaterial,
          nx,
          ny,
          baseX: 0,
          baseY: 0,
          z: -0.8 + seed * 1.1,
          seed,
          cycle: 14 + seed * 9,
          drawIn: 0.1 + seed * 0.07,
          scale: 0.064 + seed * 0.026,
          driftX: (seed - 0.5) * 0.055 + (i % 2 ? 0.018 : -0.018),
          driftY: (seed - 0.5) * 0.05,
          tilt: (seed - 0.5) * 0.12,
          alpha: 0.19 + seed * 0.075,
          lineGeometry,
          depthScale: (camera.position.z - (-0.8 + seed * 1.1)) / camera.position.z,
        };
      });

      const mobile = window.matchMedia("(max-width: 640px)");
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
      let width = window.innerWidth;
      let height = window.innerHeight;
      let elapsed = 0;
      let previous = 0;
      let frame = 0;
      let visible = document.visibilityState === "visible";
      let pointerX = 0;
      let pointerY = 0;
      let targetX = 0;
      let targetY = 0;

      const resize = () => {
        width = Math.max(1, window.innerWidth);
        height = Math.max(1, window.innerHeight);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile.matches ? 1.25 : 1.5));
        renderer.setSize(width, height, false);
        const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
        const visibleHeight = halfHeight * 2;
        const visibleWidth = visibleHeight * camera.aspect;
        hearts.forEach((heart) => {
          const depthScale = (camera.position.z - heart.z) / camera.position.z;
          heart.baseY = heart.ny * visibleHeight * 0.5 * depthScale;
          heart.baseX = heart.nx * visibleWidth * 0.5 * depthScale;
          heart.group.position.set(heart.baseX, heart.baseY, heart.z);
        });
        if (reduced.matches) renderStatic();
      };

      const renderStatic = () => {
        const { count, strength } = moodRef.current;
        hearts.forEach((heart, i) => {
          heart.group.visible = i < Math.min(2, count);
          heart.lineGeometry.setDrawRange(0, heart.lineGeometry.attributes.position.count);
          heart.lineMaterial.opacity = 0.092 * strength * heart.depthScale;
        });
        renderer.render(scene, camera);
      };

      const animate = (now: number) => {
        frame = 0;
        if (!visible || reduced.matches) return;
        const dt = previous ? Math.min((now - previous) / 1000, 0.05) : 0;
        previous = now;
        elapsed += dt;
        const { count, strength, speed } = moodRef.current;
        const activeCount = mobile.matches ? Math.min(5, count) : count;
        pointerX += (targetX - pointerX) * 0.025;
        pointerY += (targetY - pointerY) * 0.025;
        camera.position.x = pointerX * 8;
        camera.position.y = -pointerY * 8;
        camera.lookAt(0, 0, 0);

        hearts.forEach((heart, i) => {
          if (i >= activeCount) {
            heart.group.visible = false;
            return;
          }
          const t = ((elapsed / (heart.cycle / speed) + heart.seed * 0.72) % 1 + 1) % 1;
          const draw = Math.min(1, t / heart.drawIn);
          const fadeIn = Math.min(1, draw * 1.6);
          const fadeOut = Math.min(1, (1 - t) / 0.145);
          const pulseOne = Math.exp(-Math.pow((t - heart.drawIn - 0.055) / 0.025, 2));
          const pulseTwo = Math.exp(-Math.pow((t - heart.drawIn - 0.15) / 0.032, 2));
          const pulse = 1 + pulseOne * 0.045 + pulseTwo * 0.025;
          const opacity = fadeIn * fadeOut;
          heart.group.visible = opacity > 0.015;
          const age = Math.max(0, t - heart.drawIn);
          const parallax = mobile.matches ? 0.35 : 1;
          heart.group.position.x = heart.baseX + heart.driftX * age * parallax;
          heart.group.position.y = heart.baseY + heart.driftY * age * parallax;
          heart.group.rotation.z = heart.tilt;
          heart.group.scale.setScalar(heart.scale * (mobile.matches ? 0.9 : 1) * heart.depthScale * pulse);
          heart.lineGeometry.setDrawRange(0, Math.max(2, Math.floor(heart.lineGeometry.attributes.position.count * draw)));
          heart.lineMaterial.opacity = opacity * heart.alpha * strength * 1.32 * heart.depthScale;
        });
        renderer.render(scene, camera);
        frame = requestAnimationFrame(animate);
      };

      const start = () => {
        if (moodRef.current.count === 0) {
          cancelAnimationFrame(frame);
          frame = 0;
          hearts.forEach((heart) => { heart.group.visible = false; });
          renderer.render(scene, camera);
          return;
        }
        if (reduced.matches) {
          cancelAnimationFrame(frame);
          frame = 0;
          renderStatic();
        } else if (visible && !frame) {
          previous = 0;
          frame = requestAnimationFrame(animate);
        }
      };
      const onVisibility = () => {
        visible = document.visibilityState === "visible";
        if (!visible) {
          cancelAnimationFrame(frame);
          frame = 0;
        } else start();
      };
      const onPointer = (event: PointerEvent) => {
        if (mobile.matches) return;
        targetX = (event.clientX / width - 0.5) * 0.12;
        targetY = (event.clientY / height - 0.5) * 0.1;
      };

      resize();
      syncRef.current = start;
      start();
      const observer = new ResizeObserver(resize);
      observer.observe(document.documentElement);
      window.addEventListener("resize", resize, { passive: true });
      window.addEventListener("pointermove", onPointer, { passive: true });
      document.addEventListener("visibilitychange", onVisibility);
      reduced.addEventListener("change", start);
      mobile.addEventListener("change", resize);
      dispose = () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        window.removeEventListener("resize", resize);
        window.removeEventListener("pointermove", onPointer);
        document.removeEventListener("visibilitychange", onVisibility);
        reduced.removeEventListener("change", start);
        mobile.removeEventListener("change", resize);
        syncRef.current = () => {};
        scene.clear();
        heartGeometries.forEach((heartGeometry) => heartGeometry.dispose());
        hearts.forEach((heart) => {
          heart.lineMaterial.dispose();
        });
        renderer.dispose();
        renderer.forceContextLoss();
      };
    }).catch(() => {
      // WebGL is optional decoration; the page remains fully usable without it.
    });

    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [active]);

  return (
    <canvas
      key={active ? "field" : "empty"}
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[1] h-full w-full"
    />
  );
}
