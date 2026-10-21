/**
 * The slice of the Google Maps JavaScript API the Movements map uses (brief ruling 13,
 * Session 6). Typed by hand rather than through @types/google.maps so the client bundle
 * carries no package and the surface stays the one the map actually calls: a Map, one
 * OverlayView (the pin layer is React, drawn into the overlay pane), one Polyline (the
 * route line, ruling 22 / flag 7) and the bounds to fit. The script itself is loaded by
 * lib/maps/googleMaps.ts with `loading=async`, so every class comes from importLibrary.
 */
declare namespace google.maps {
  interface LatLngLiteral { lat: number; lng: number }
  class LatLng {
    constructor(lat: number, lng: number);
    lat(): number;
    lng(): number;
  }
  class LatLngBounds {
    constructor();
    extend(point: LatLngLiteral | LatLng): LatLngBounds;
    isEmpty(): boolean;
  }
  class Point {
    constructor(x: number, y: number);
    x: number;
    y: number;
  }
  interface MapOptions {
    center?: LatLngLiteral;
    zoom?: number;
    mapTypeControl?: boolean;
    streetViewControl?: boolean;
    fullscreenControl?: boolean;
    clickableIcons?: boolean;
    gestureHandling?: "cooperative" | "greedy" | "none" | "auto";
    backgroundColor?: string;
    colorScheme?: "LIGHT" | "DARK" | "FOLLOW_SYSTEM";
  }
  interface Padding { top: number; right: number; bottom: number; left: number }
  class Map {
    constructor(el: HTMLElement, opts?: MapOptions);
    fitBounds(bounds: LatLngBounds, padding?: number | Padding): void;
    getZoom(): number | undefined;
    setZoom(zoom: number): void;
    setCenter(center: LatLngLiteral): void;
  }
  interface MapPanes {
    overlayLayer: HTMLElement;
    overlayMouseTarget: HTMLElement;
    floatPane: HTMLElement;
  }
  interface MapCanvasProjection {
    fromLatLngToDivPixel(point: LatLngLiteral | LatLng): Point | null;
  }
  class OverlayView {
    setMap(map: Map | null): void;
    getPanes(): MapPanes | null;
    getProjection(): MapCanvasProjection;
    onAdd(): void;
    draw(): void;
    onRemove(): void;
    static preventMapHitsAndGesturesFrom(element: HTMLElement): void;
  }
  interface IconSequence { icon: { path: string; strokeOpacity?: number; strokeWeight?: number; scale?: number; strokeColor?: string }; offset?: string; repeat?: string }
  interface PolylineOptions {
    path?: LatLngLiteral[];
    map?: Map | null;
    strokeColor?: string;
    strokeOpacity?: number;
    strokeWeight?: number;
    icons?: IconSequence[];
    geodesic?: boolean;
    clickable?: boolean;
  }
  class Polyline {
    constructor(opts?: PolylineOptions);
    setMap(map: Map | null): void;
    setOptions(opts: PolylineOptions): void;
  }
  interface MapsEventListener { remove(): void }
  namespace event {
    function addListener(instance: object, eventName: string, handler: () => void): MapsEventListener;
    function clearInstanceListeners(instance: object): void;
  }
  /** importLibrary("maps"): the map, the overlay and the line. */
  interface MapsLibrary {
    Map: typeof Map;
    OverlayView: typeof OverlayView;
    Polyline: typeof Polyline;
  }
  /** importLibrary("core"): bounds, points and events live here, not in "maps". */
  interface CoreLibrary {
    LatLng: typeof LatLng;
    LatLngBounds: typeof LatLngBounds;
    Point: typeof Point;
    event: typeof event;
  }
  function importLibrary(name: "maps"): Promise<MapsLibrary>;
  function importLibrary(name: "core"): Promise<CoreLibrary>;
}

interface Window {
  google?: { maps?: { importLibrary?: typeof google.maps.importLibrary } };
}
