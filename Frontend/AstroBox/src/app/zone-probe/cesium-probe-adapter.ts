import type * as Cesium from 'cesium';
import type { GeoPoint } from '../map.models';
import type { MapProbeAdapter } from './zone-probe.models';

/**
 * Probe adapter for an existing Cesium viewer (3D globe or 2D map).
 * The viewer's canvas fills the map stage, so canvas pixels are stage pixels.
 * Used by Verny (pick/project) and by the wind layer (fast projection).
 */
export function createCesiumProbeAdapter(
  cesium: typeof Cesium,
  viewer: Cesium.Viewer,
): MapProbeAdapter {
  const scratchWindow = new cesium.Cartesian2();
  const scratchPick = new cesium.Cartesian2();
  const scratchPosition = new cesium.Cartesian3();
  const ellipsoid = viewer.scene.globe.ellipsoid;
  const occluder = new cesium.EllipsoidalOccluder(ellipsoid, viewer.camera.positionWC);
  const lastView = new cesium.Matrix4();
  let lastFrustumWidth = 0;
  let version = 0;

  const isGlobe = (): boolean => viewer.scene.mode === cesium.SceneMode.SCENE3D;

  const projectInto = (
    longitude: number,
    latitude: number,
    out: { x: number; y: number },
  ): boolean => {
    const position = cesium.Cartesian3.fromDegrees(longitude, latitude, 0, ellipsoid, scratchPosition);
    if (isGlobe()) {
      // Points on the far side of the globe are hidden.
      occluder.cameraPosition = viewer.camera.positionWC;
      if (!occluder.isPointVisible(position)) {
        return false;
      }
    }
    const windowPosition = cesium.SceneTransforms.worldToWindowCoordinates(
      viewer.scene,
      position,
      scratchWindow,
    );
    if (!windowPosition) {
      return false;
    }
    out.x = windowPosition.x;
    out.y = windowPosition.y;
    return true;
  };

  return {
    pick(x: number, y: number): GeoPoint | undefined {
      if (viewer.isDestroyed()) {
        return undefined;
      }
      scratchPick.x = x;
      scratchPick.y = y;
      const cartesian = viewer.camera.pickEllipsoid(scratchPick, ellipsoid);
      if (!cartesian) {
        return undefined;
      }
      const cartographic = cesium.Cartographic.fromCartesian(cartesian);
      return {
        longitude: cesium.Math.toDegrees(cartographic.longitude),
        latitude: cesium.Math.toDegrees(cartographic.latitude),
      };
    },

    project(point: GeoPoint): { x: number; y: number } | undefined {
      if (viewer.isDestroyed()) {
        return undefined;
      }
      const out = { x: 0, y: 0 };
      return projectInto(point.longitude, point.latitude, out) ? out : undefined;
    },

    projectInto(longitude, latitude, out): boolean {
      return !viewer.isDestroyed() && projectInto(longitude, latitude, out);
    },

    onFrame(callback: () => void): () => void {
      if (viewer.isDestroyed()) {
        return () => undefined;
      }
      return viewer.scene.postRender.addEventListener(callback);
    },

    viewVersion(): number {
      if (viewer.isDestroyed()) {
        return version;
      }
      const camera = viewer.camera;
      const frustum = camera.frustum;
      const frustumWidth =
        frustum instanceof cesium.OrthographicOffCenterFrustum
          ? (frustum.right ?? 0) - (frustum.left ?? 0)
          : 0;
      if (
        !cesium.Matrix4.equalsEpsilon(camera.viewMatrix, lastView, 1e-6) ||
        frustumWidth !== lastFrustumWidth
      ) {
        cesium.Matrix4.clone(camera.viewMatrix, lastView);
        lastFrustumWidth = frustumWidth;
        version += 1;
      }
      return version;
    },

    metersPerPixel(): number {
      if (viewer.isDestroyed()) {
        return 1;
      }
      const camera = viewer.camera;
      const canvas = viewer.scene.canvas;
      const frustum = camera.frustum;
      if (frustum instanceof cesium.OrthographicOffCenterFrustum) {
        return ((frustum.right ?? 0) - (frustum.left ?? 0)) / Math.max(canvas.clientWidth, 1);
      }
      const fovy = frustum instanceof cesium.PerspectiveFrustum ? (frustum.fovy ?? 1) : 1;
      const height = Math.max(camera.positionCartographic.height, 1);
      return (2 * height * Math.tan(fovy / 2)) / Math.max(canvas.clientHeight, 1);
    },
  };
}
