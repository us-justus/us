"use client";

import { useEffect, useRef } from "react";
import { usePrelaunchHome } from "@/components/layout/prelaunch-home-context";
import type { BufferGeometry } from "three";

/** A small, page-local heart field for the completed pre-launch confirmation. */
export function PrelaunchHeartField() {
  const layerRef = useRef<HTMLDivElement>(null);
  const active = usePrelaunchHome();

  useEffect(() => {
    if (!active) return;
    const layer = layerRef.current;
    if (!layer) return;

    let cancelled = false;
    let dispose: (() => void) | undefined;

    void import("three").then((THREE) => {
      if (cancelled || !layerRef.current) return;

      const canvas = layer.querySelector("canvas");
      if (!canvas) return;

      const renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: false,
        powerPreference: "low-power",
      });
      renderer.setClearColor(0x000000, 0);

      const scene = new THREE.Scene();
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20);
      camera.position.z = 10;
      const styles = getComputedStyle(document.documentElement);
      const colors = ["--accent-deep", "--accent", "--ambient-heart"].map(
        (token) => new THREE.Color(styles.getPropertyValue(token).trim()),
      );
      const geometries: BufferGeometry[] = [];
      const placements = [
        { x: -38, y: 151, size: 13, phase: 0.2 },
        { x: 34, y: 144, size: 15, phase: 2.1 },
        { x: -35, y: 108, size: 12, phase: 4.2 },
        { x: 39, y: 115, size: 12, phase: 5.6 },
      ];
      const hearts = placements.map(({ x, y, size, phase }, index) => {
        const bottom = new THREE.Vector3(0, -0.46, 0);
        const curves = [
          new THREE.CubicBezierCurve3(bottom, new THREE.Vector3(-0.25, -0.23, 0), new THREE.Vector3(-0.55, -0.03, 0), new THREE.Vector3(-0.48, 0.2, 0)),
          new THREE.CubicBezierCurve3(new THREE.Vector3(-0.48, 0.2, 0), new THREE.Vector3(-0.44, 0.48, 0), new THREE.Vector3(-0.12, 0.45, 0), new THREE.Vector3(0, 0.19, 0)),
          new THREE.CubicBezierCurve3(new THREE.Vector3(0, 0.19, 0), new THREE.Vector3(0.12, 0.45, 0), new THREE.Vector3(0.44, 0.48, 0), new THREE.Vector3(0.48, 0.2, 0)),
          new THREE.CubicBezierCurve3(new THREE.Vector3(0.48, 0.2, 0), new THREE.Vector3(0.55, -0.03, 0), new THREE.Vector3(0.25, -0.23, 0), bottom),
        ];
        const points = curves.flatMap((curve, index) =>
          curve.getPoints(9).slice(index === 0 ? 0 : 1),
        );
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        geometries.push(geometry);
        const material = new THREE.LineBasicMaterial({
          color: colors[index % colors.length],
          transparent: true,
          opacity: 0.3,
          depthWrite: false,
        });
        const group = new THREE.Group();
        group.add(new THREE.Line(geometry, material));
        scene.add(group);
        return { group, material, x, y, size, phase };
      });

      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
      let width = 1;
      let height = 1;
      let elapsed = 0;
      let previous = 0;
      let frame = 0;
      let visible = document.visibilityState === "visible";

      const renderStatic = () => {
        hearts.forEach((heart) => {
          heart.group.visible = true;
          heart.group.position.set(heart.x, heart.y, 0);
          heart.group.scale.setScalar(heart.size);
          heart.material.opacity = 0.26;
        });
        renderer.render(scene, camera);
      };

      const resize = () => {
        width = Math.max(1, layer.clientWidth);
        height = Math.max(1, layer.clientHeight);
        camera.left = -width / 2;
        camera.right = width / 2;
        camera.top = height / 2;
        camera.bottom = -height / 2;
        camera.updateProjectionMatrix();
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
        renderer.setSize(width, height, false);
        if (reduced.matches) renderStatic();
      };

      const animate = (now: number) => {
        frame = 0;
        if (!visible || reduced.matches) return;
        const delta = previous ? Math.min((now - previous) / 1000, 0.05) : 0;
        previous = now;
        elapsed += delta;
        hearts.forEach((heart) => {
          const phase = elapsed * 0.42 + heart.phase;
          heart.group.position.set(
            heart.x + Math.sin(phase) * 2.2,
            heart.y + Math.sin(phase * 0.7) * 3.2,
            0,
          );
          heart.group.rotation.z = Math.sin(phase * 0.55) * 0.025;
          heart.group.scale.setScalar(heart.size * (1 + Math.sin(phase) * 0.025));
        });
        renderer.render(scene, camera);
        frame = requestAnimationFrame(animate);
      };

      const start = () => {
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

      resize();
      start();
      const observer = new ResizeObserver(resize);
      observer.observe(layer);
      document.addEventListener("visibilitychange", onVisibility);
      reduced.addEventListener("change", start);

      dispose = () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        document.removeEventListener("visibilitychange", onVisibility);
        reduced.removeEventListener("change", start);
        scene.clear();
        geometries.forEach((geometry) => geometry.dispose());
        hearts.forEach((heart) => heart.material.dispose());
        renderer.dispose();
        renderer.forceContextLoss();
      };
    }).catch(() => {
      // WebGL is optional decoration; the confirmation remains complete without it.
    });

    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [active]);

  if (!active) return null;

  return (
    <div ref={layerRef} aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      <canvas className="h-full w-full" />
    </div>
  );
}
