import { useEffect, useRef, useState } from "react";
import "./App.css";
import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";
import L from "leaflet";
import "leaflet-draw";
import shp from "shpjs";
import html2canvas from "html2canvas";

import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

function App() {
  const mapRef = useRef(null);
  const mapContainerRef = useRef(null);
  const drawnItemsRef = useRef(null);

  const dopLayerRef = useRef(null);
  const basemapLayersRef = useRef({});
  const currentBasemapRef = useRef(null);
  const searchMarkerRef = useRef(null);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [status, setStatus] = useState("Ready");
  const [coords, setCoords] = useState(null);
  const [opacity, setOpacity] = useState(0);
  const [selectedBasemap, setSelectedBasemap] = useState("osm");
  const [isUploadActive, setIsUploadActive] = useState(false);

  useEffect(() => {
    if (mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [51.5, 7.5],
      zoom: 9,
      zoomControl: false,
      fadeAnimation: true,
      zoomAnimation: true,
      markerZoomAnimation: true,
    });

    mapRef.current = map;

    const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{ opacity: 1 });
    const light = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",{ opacity: 0 });
    const dark = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",{ opacity: 0 });
    const topo = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",{ opacity: 0 });

    basemapLayersRef.current = { osm, light, dark, topo };

    osm.addTo(map);
    currentBasemapRef.current = osm;

    Object.values(basemapLayersRef.current).forEach((layer) => {
      const preloadZoom = 5;
      for (let x = 0; x < 4; x++) {
        for (let y = 0; y < 4; y++) {
          const url = layer.getTileUrl({ x, y, z: preloadZoom });
          const img = new Image();
          img.src = url;
        }
      }
    });

    dopLayerRef.current = L.tileLayer.wms(
      "https://www.wms.nrw.de/geobasis/wms_nw_dop?",
      {
        layers: "nw_dop_rgb",
        format: "image/jpeg",
        version: "1.3.0",
        transparent: false,
        opacity: 0,
      }
    );

    const drawn = new L.FeatureGroup();
    drawnItemsRef.current = drawn;
    map.addLayer(drawn);

    const drawControl = new L.Control.Draw({
      draw: {
        polygon: { showArea: true },
        rectangle: true,
        circle: true,
        marker: false,
        polyline: false,
      },
      edit: { featureGroup: drawn },
    });
    map.addControl(drawControl);

    map.on(L.Draw.Event.CREATED, (e) => {
      drawn.addLayer(e.layer);
      setStatus("AOI added");
    });

    map.on("mousemove", (e) => {
      setCoords({
        lat: e.latlng.lat.toFixed(6),
        lng: e.latlng.lng.toFixed(6),
      });
    });

    map.on("mouseout", () => setCoords(null));

    L.control.zoom({ position: "topleft" }).addTo(map);

    setStatus("Map ready");
  }, []);

  const handleOpacityChange = (value) => {
    const v = parseFloat(value);
    setOpacity(v);

    if (!dopLayerRef.current) return;

    if (!mapRef.current.hasLayer(dopLayerRef.current)) {
      dopLayerRef.current.addTo(mapRef.current);
    }

    dopLayerRef.current.setOpacity(v);
  };

  const handleBasemapChange = (key) => {
    const newLayer = basemapLayersRef.current[key];
    if (!newLayer || newLayer === currentBasemapRef.current) return;

    if (!mapRef.current.hasLayer(newLayer)) {
      newLayer.addTo(mapRef.current);
    }

    currentBasemapRef.current.setOpacity(0);
    newLayer.setOpacity(1);

    currentBasemapRef.current = newLayer;
    setSelectedBasemap(key);
    setStatus(`Basemap: ${key}`);
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setStatus("Searching…");

    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}`
      );
      const data = await res.json();

      if (!data.length) {
        setStatus("No results");
        return;
      }

      const { lat, lon, display_name } = data[0];

      mapRef.current.flyTo([+lat, +lon], 14, { duration: 2.2 });

      mapRef.current.fire("move");
      mapRef.current.once("moveend", () => {
        mapRef.current._onResize();
      });

      if (searchMarkerRef.current)
        mapRef.current.removeLayer(searchMarkerRef.current);

      searchMarkerRef.current = L.marker([+lat, +lon])
        .addTo(mapRef.current)
        .bindPopup(`<b>${display_name}</b>`)
        .openPopup();

      setStatus(display_name);
    } catch {
      setStatus("Search failed");
    }
  };

  const handleShapefileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setStatus("Loading shapefile…");
    setIsUploadActive(true);

    try {
      const buffer = await file.arrayBuffer();
      const geojson = await shp(buffer);

      const layer = L.geoJSON(geojson).addTo(mapRef.current);
      drawnItemsRef.current.addLayer(layer);
      mapRef.current.fitBounds(layer.getBounds());

      setStatus("Shapefile loaded");
    } catch {
      setStatus("Upload failed");
    } finally {
      setIsUploadActive(false);
      e.target.value = "";
    }
  };

  const exportGeoJSON = () => {
    const fc = drawnItemsRef.current.toGeoJSON();
    const blob = new Blob([JSON.stringify(fc, null, 2)], {
      type: "application/json",
    });

    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "aoi.geojson";
    a.click();
    setStatus("GeoJSON exported");
  };

  const downloadScreenshot = async () => {
    setStatus("Capturing screenshot...");

    const mapEl = mapContainerRef.current;
    const oldWC = mapEl.style.willChange;
    mapEl.style.willChange = "transform";

    try {
      const canvas = await html2canvas(mapContainerRef.current,{
        useCORS: true,
        scale: 1,
        backgroundColor: "#ffffff",
        removeContainer: true,
        imageTimeout: 0,
        onclone: (docClone) => {
          docClone.querySelectorAll("*").forEach((el) => {
            el.style.transition = "none";
            el.style.animation = "none";
            el.style.boxShadow = "none";
          });
        },
      });

      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = `map-screenshot-${Date.now()}.png`;
      a.click();

      setStatus("Screenshot saved");
    } catch {
      setStatus("Screenshot failed");
    }

    mapEl.style.willChange = oldWC;
  };

  return (
    <div className={`app-shell ${sidebarOpen ? "sidebar-open" : "sidebar-closed"}`}>
      <header className="topbar">
        <div className="brand">NRW AOI Studio</div>
        <span className="status-chip">{status}</span>
      </header>

      <div className="layout">
        <button
          className="sidebar-toggle-fixed"
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          {sidebarOpen ? "◀" : "▶"}
        </button>

        <aside className="sidebar">

          <div className="sidebar-section">
            <h3>🔍 Search Location</h3>
            <form className="search-box" onSubmit={handleSearch}>
              <input
                type="text"
                placeholder="Enter address..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <button className="search-btn">Search</button>
            </form>
          </div>

          <div className="sidebar-section">
            <h3>📁 Upload Shapefile</h3>
            <label className={`upload-area ${isUploadActive ? "active" : ""}`}>
              <div className="upload-icon">📤</div>
              <div className="upload-text">Drop your .zip file</div>
              <div className="upload-hint">or click to select</div>
              <input
                type="file"
                accept=".zip"
                onChange={handleShapefileUpload}
                disabled={isUploadActive}
              />
            </label>
          </div>

          <div className="sidebar-section">
            <h3>🗺️ Basemaps</h3>
            <div className="basemap-grid">
              {[
                { key: "osm", name: "OpenStreetMap" },
                { key: "light", name: "Light" },
                { key: "dark", name: "Dark" },
                { key: "topo", name: "Topographic" },
              ].map((b) => (
                <button
                  key={b.key}
                  className={`basemap-card ${selectedBasemap === b.key ? "active" : ""}`}
                  onClick={() => handleBasemapChange(b.key)}
                >
                  {b.name}
                </button>
              ))}
            </div>
          </div>

          <div className="sidebar-section">
            <h3>📤 Export</h3>

            <div className="export-buttons">
              <button className="export-btn" onClick={exportGeoJSON}>
                📄 Download GeoJSON
              </button>

              <button className="export-btn screenshot" onClick={downloadScreenshot}>
                📸 Capture Screenshot
              </button>
            </div>

          </div>
        </aside>

        <main className="map-wrapper">
          <div ref={mapContainerRef} id="map" />

          {coords && (
            <div className="coords-box">
              Lat: {coords.lat} | Lon: {coords.lng}
            </div>
          )}
        </main>

      </div>
    </div>
  );
}

export default App;
