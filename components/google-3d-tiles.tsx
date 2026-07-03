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
      }),
    );
    t.errorTarget = 8;
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
    if (frame.current % 30 === 0) {
      const ray = new THREE.Raycaster(new THREE.Vector3(0, 4000, 0), new THREE.Vector3(0, -1, 0));
      const hits = ray.intersectObject(tiles.group, true);
      if (hits.length > 0) {
        const dy = hits[0].point.y;
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
