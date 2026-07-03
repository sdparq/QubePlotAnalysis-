"use client";
import { useEffect, useRef, useState } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { TilesRenderer } from "3d-tiles-renderer";
import {
  GoogleCloudAuthPlugin,
  GLTFExtensionsPlugin,
  TilesFadePlugin,
  ReorientationPlugin,
} from "3d-tiles-renderer/plugins";

/** Ground-probe pattern (m): plot anchor plus four points ~40 m out. */
const SNAP_SAMPLE_OFFSETS: Array<[number, number]> = [
  [0, 0],
  [40, 0],
  [-40, 0],
  [0, 40],
  [0, -40],
];

export interface GoogleTilesProps {
  /** Google Maps Platform key with the Map Tiles API enabled. */
  apiKey: string;
  latitude: number;
  longitude: number;
  /** Reports the data attributions that must stay visible (Google TOS). */
  onAttributions?: (text: string) => void;
  /** First failed network/parse fetch — usually a bad or unauthorised key. */
  onError?: (message: string) => void;
  /** Fires once the ground around the plot has streamed in. */
  onReady?: () => void;
  /** Optional click-through for place-on-map modes. Only wired while a
   *  placement mode is active, so normal orbiting never pays raycast cost. */
  onClick?: (e: ThreeEvent<MouseEvent>) => void;
}

/**
 * Streams Google Photorealistic 3D Tiles around the project location and keeps
 * them registered to the scene origin: the plot's lat/lon sits at (0,0,0) with
 * +X east / -Z north (same convention as the OSM context layer), and the
 * terrain is continuously snapped so the ground reads y = 0.
 */
export default function GoogleTiles({
  apiKey, latitude, longitude, onAttributions, onError, onReady, onClick,
}: GoogleTilesProps) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const [tiles, setTiles] = useState<TilesRenderer | null>(null);
  const readyRef = useRef(false);
  const frame = useRef(0);
  const attributionsRef = useRef("");

  useEffect(() => {
    const t = new TilesRenderer();
    t.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: apiKey, autoRefreshToken: true }));
    const draco = new DRACOLoader();
    draco.setDecoderPath("https://www.gstatic.com/draco/v1/decoders/");
    t.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco }));
    t.registerPlugin(new TilesFadePlugin());
    t.registerPlugin(
      new ReorientationPlugin({
        lat: latitude * THREE.MathUtils.DEG2RAD,
        lon: longitude * THREE.MathUtils.DEG2RAD,
        height: 0,
        recenter: true,
        // The plugin's default frame is X=west / Z=north; the app convention
        // (shared with the OSM layer and the plot polygon) is X=east / Z=south.
        // A 180° azimuth spin brings both frames into agreement.
        azimuth: Math.PI,
      }),
    );
    t.errorTarget = 4;
    // Photorealistic tiles ship baked lighting in their textures. Swapping to
    // unlit materials shows them exactly as captured (Google Earth look) and
    // keeps the scene lights from washing them out.
    const handleModel = (e: { scene?: THREE.Object3D }) => {
      e.scene?.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mat = mesh.material as THREE.Material & { map?: THREE.Texture | null };
        if (mat && !(mat instanceof THREE.MeshBasicMaterial)) {
          const basic = new THREE.MeshBasicMaterial({ map: mat.map ?? null });
          mesh.material = basic;
          mat.dispose();
        }
      });
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    t.addEventListener("load-model" as any, handleModel as any);
    const handleError = (e: { error?: Error; url?: string | URL }) => {
      const msg = e?.error?.message ?? "tile request failed";
      onError?.(msg);
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    t.addEventListener("load-error" as any, handleError as any);
    setTiles(t);
    readyRef.current = false;
    return () => {
      t.dispose();
      draco.dispose();
      setTiles(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, latitude, longitude]);

  useEffect(() => {
    if (!tiles) return;
    tiles.setCamera(camera);
    tiles.setResolutionFromRenderer(camera, gl);
  }, [tiles, camera, gl]);

  useFrame(() => {
    if (!tiles) return;
    // Ortho zoom changes every frame while the user scrolls; keeping the
    // resolution in sync drives the LOD selection correctly.
    tiles.setResolutionFromRenderer(camera, gl);
    camera.updateMatrixWorld();
    tiles.update();

    frame.current++;

    // Terrain in Dubai sits ~30 m below the WGS84 ellipsoid, and higher LODs
    // refine the height as they stream in — keep nudging the tileset so the
    // ground under the plot stays at y = 0 where the massing volumes sit.
    // Sample several points around the plot and take the median, so a roof or
    // a parked structure right at the anchor point can't sink the whole city.
    if (frame.current % 30 === 0) {
      const down = new THREE.Vector3(0, -1, 0);
      const heights: number[] = [];
      for (const [ox, oz] of SNAP_SAMPLE_OFFSETS) {
        const ray = new THREE.Raycaster(new THREE.Vector3(ox, 4000, oz), down);
        const hits = ray.intersectObject(tiles.group, true);
        if (hits.length > 0) heights.push(hits[0].point.y);
      }
      if (heights.length > 0) {
        heights.sort((a, b) => a - b);
        const dy = heights[Math.floor(heights.length / 2)];
        if (Math.abs(dy) > 0.25) tiles.group.position.y -= dy;
        if (!readyRef.current) {
          readyRef.current = true;
          onReady?.();
        }
      }
    }

    if (frame.current % 60 === 0 && onAttributions) {
      try {
        const text = tiles
          .getAttributions([])
          .map((a: { value: string }) => a.value)
          .filter(Boolean)
          .join(" · ");
        if (text && text !== attributionsRef.current) {
          attributionsRef.current = text;
          onAttributions(text);
        }
      } catch {
        /* attributions are best-effort */
      }
    }
  });

  if (!tiles) return null;
  return <primitive object={tiles.group} onClick={onClick} />;
}
