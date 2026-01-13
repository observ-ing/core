/**
 * BioSky Frontend
 *
 * Map-based interface for exploring and contributing biodiversity observations.
 */

import maplibregl from "maplibre-gl";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000";

interface Observation {
  uri: string;
  cid: string;
  observer: {
    did: string;
    handle?: string;
    displayName?: string;
    avatar?: string;
  };
  scientificName: string;
  communityId?: string;
  eventDate: string;
  location: {
    latitude: number;
    longitude: number;
    uncertaintyMeters?: number;
  };
  verbatimLocality?: string;
  notes?: string;
  images: string[];
  createdAt: string;
}

interface User {
  did: string;
  handle: string;
}

class BioSkyApp {
  private map: maplibregl.Map | null = null;
  private currentUser: User | null = null;
  private currentLocation: { lat: number; lng: number } | null = null;

  async init(): Promise<void> {
    await this.initMap();
    this.setupEventListeners();
    await this.checkAuth();
    this.loadObservationsInView();
  }

  private async initMap(): Promise<void> {
    this.map = new maplibregl.Map({
      container: "map",
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: [
              "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
              "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
              "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
            ],
            tileSize: 256,
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          },
        },
        layers: [
          {
            id: "osm",
            type: "raster",
            source: "osm",
          },
        ],
      },
      center: [-122.4194, 37.7749], // San Francisco default
      zoom: 10,
    });

    // Add navigation controls
    this.map.addControl(new maplibregl.NavigationControl(), "bottom-right");

    // Wait for map to load
    await new Promise<void>((resolve) => {
      this.map!.on("load", () => resolve());
    });

    // Add observations source and layer
    this.map.addSource("observations", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
      cluster: true,
      clusterMaxZoom: 14,
      clusterRadius: 50,
    });

    // Cluster circles
    this.map.addLayer({
      id: "clusters",
      type: "circle",
      source: "observations",
      filter: ["has", "point_count"],
      paint: {
        "circle-color": "#22c55e",
        "circle-radius": [
          "step",
          ["get", "point_count"],
          20,
          10,
          25,
          50,
          30,
          100,
          35,
        ],
        "circle-stroke-width": 2,
        "circle-stroke-color": "#0a0a0a",
      },
    });

    // Cluster count labels
    this.map.addLayer({
      id: "cluster-count",
      type: "symbol",
      source: "observations",
      filter: ["has", "point_count"],
      layout: {
        "text-field": "{point_count_abbreviated}",
        "text-font": ["Open Sans Bold"],
        "text-size": 12,
      },
      paint: {
        "text-color": "#0a0a0a",
      },
    });

    // Individual observation markers
    this.map.addLayer({
      id: "observation-points",
      type: "circle",
      source: "observations",
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": "#22c55e",
        "circle-radius": 8,
        "circle-stroke-width": 2,
        "circle-stroke-color": "#0a0a0a",
      },
    });

    // Click handlers
    this.map.on("click", "clusters", (e) => {
      const features = this.map!.queryRenderedFeatures(e.point, {
        layers: ["clusters"],
      });
      const clusterId = features[0].properties?.cluster_id;
      const source = this.map!.getSource("observations") as maplibregl.GeoJSONSource;
      source.getClusterExpansionZoom(clusterId, (err, zoom) => {
        if (err) return;
        const geometry = features[0].geometry;
        if (geometry.type === "Point") {
          this.map!.easeTo({
            center: geometry.coordinates as [number, number],
            zoom: zoom!,
          });
        }
      });
    });

    this.map.on("click", "observation-points", async (e) => {
      const feature = e.features?.[0];
      if (!feature) return;

      const props = feature.properties;
      const geometry = feature.geometry;
      if (geometry.type !== "Point") return;

      // Fetch full observation data
      const observation = await this.fetchObservation(props?.uri);
      if (!observation) return;

      this.showObservationPopup(observation, geometry.coordinates as [number, number]);
    });

    // Cursor changes
    this.map.on("mouseenter", "clusters", () => {
      this.map!.getCanvas().style.cursor = "pointer";
    });
    this.map.on("mouseleave", "clusters", () => {
      this.map!.getCanvas().style.cursor = "";
    });
    this.map.on("mouseenter", "observation-points", () => {
      this.map!.getCanvas().style.cursor = "pointer";
    });
    this.map.on("mouseleave", "observation-points", () => {
      this.map!.getCanvas().style.cursor = "";
    });

    // Reload on move
    this.map.on("moveend", () => {
      this.loadObservationsInView();
    });
  }

  private setupEventListeners(): void {
    // Login button
    document.getElementById("login-btn")?.addEventListener("click", () => {
      const handle = prompt("Enter your handle (e.g., user.bsky.social):");
      if (handle) {
        window.location.href = `${API_BASE}/oauth/login?handle=${encodeURIComponent(handle)}`;
      }
    });

    // Logout button
    document.getElementById("logout-btn")?.addEventListener("click", async () => {
      await fetch(`${API_BASE}/oauth/logout`, {
        method: "POST",
        credentials: "include",
      });
      this.currentUser = null;
      this.updateAuthUI();
    });

    // Locate button
    document.getElementById("locate-btn")?.addEventListener("click", () => {
      this.locateUser();
    });

    // Upload button
    document.getElementById("upload-btn")?.addEventListener("click", () => {
      this.showUploadModal();
    });

    // Cancel upload
    document.getElementById("cancel-upload")?.addEventListener("click", () => {
      this.hideUploadModal();
    });

    // Close modal on overlay click
    document.getElementById("upload-modal")?.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) {
        this.hideUploadModal();
      }
    });

    // Species autocomplete
    const speciesInput = document.getElementById("species-input") as HTMLInputElement;
    let debounceTimer: number;
    speciesInput?.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        this.searchTaxa(speciesInput.value);
      }, 300);
    });

    // Form submission
    document.getElementById("observation-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      await this.submitObservation();
    });

    // Photo input - extract EXIF
    document.getElementById("photo-input")?.addEventListener("change", (e) => {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      if (file) {
        this.extractExif(file);
      }
    });
  }

  private async checkAuth(): Promise<void> {
    try {
      const response = await fetch(`${API_BASE}/oauth/me`, {
        credentials: "include",
      });
      if (response.ok) {
        this.currentUser = await response.json();
      }
    } catch (error) {
      console.error("Auth check failed:", error);
    }
    this.updateAuthUI();
  }

  private updateAuthUI(): void {
    const loginBtn = document.getElementById("login-btn");
    const logoutBtn = document.getElementById("logout-btn");
    const userHandle = document.getElementById("user-handle");

    if (this.currentUser) {
      loginBtn?.classList.add("hidden");
      logoutBtn?.classList.remove("hidden");
      if (userHandle) {
        userHandle.textContent = `@${this.currentUser.handle}`;
      }
    } else {
      loginBtn?.classList.remove("hidden");
      logoutBtn?.classList.add("hidden");
      if (userHandle) {
        userHandle.textContent = "";
      }
    }
  }

  private async loadObservationsInView(): Promise<void> {
    if (!this.map) return;

    const bounds = this.map.getBounds();
    const params = new URLSearchParams({
      minLat: bounds.getSouth().toString(),
      minLng: bounds.getWest().toString(),
      maxLat: bounds.getNorth().toString(),
      maxLng: bounds.getEast().toString(),
    });

    try {
      const response = await fetch(`${API_BASE}/api/observations/geojson?${params}`);
      if (!response.ok) return;

      const geojson = await response.json();
      const source = this.map.getSource("observations") as maplibregl.GeoJSONSource;
      source.setData(geojson);
    } catch (error) {
      console.error("Failed to load observations:", error);
    }
  }

  private async fetchObservation(uri: string): Promise<Observation | null> {
    try {
      const response = await fetch(
        `${API_BASE}/api/observations/${encodeURIComponent(uri)}`
      );
      if (!response.ok) return null;
      const data = await response.json();
      return data.observation;
    } catch (error) {
      console.error("Failed to fetch observation:", error);
      return null;
    }
  }

  private showObservationPopup(
    observation: Observation,
    coords: [number, number]
  ): void {
    const popup = new maplibregl.Popup({ maxWidth: "300px" })
      .setLngLat(coords)
      .setHTML(
        `
        <div class="observation-popup">
          ${observation.images[0] ? `<img src="${API_BASE}${observation.images[0]}" alt="${observation.scientificName}" />` : ""}
          <h3>${observation.scientificName}</h3>
          <div class="observer">
            by @${observation.observer.handle || observation.observer.did.slice(0, 20)}
          </div>
          <div class="meta">
            ${new Date(observation.eventDate).toLocaleDateString()}
            ${observation.verbatimLocality ? ` &bull; ${observation.verbatimLocality}` : ""}
          </div>
        </div>
      `
      )
      .addTo(this.map!);
  }

  private locateUser(): void {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        this.currentLocation = { lat: latitude, lng: longitude };

        this.map?.flyTo({
          center: [longitude, latitude],
          zoom: 14,
        });

        // Add user location marker
        new maplibregl.Marker({ color: "#3b82f6" })
          .setLngLat([longitude, latitude])
          .addTo(this.map!);
      },
      (error) => {
        console.error("Geolocation error:", error);
        alert("Could not get your location");
      }
    );
  }

  private showUploadModal(): void {
    if (!this.currentUser) {
      alert("Please log in to submit observations");
      return;
    }

    // Get current map center as default location
    const center = this.map?.getCenter();
    if (center) {
      const latInput = document.getElementById("lat-input") as HTMLInputElement;
      const lngInput = document.getElementById("lng-input") as HTMLInputElement;
      const locationDisplay = document.getElementById("location-display") as HTMLInputElement;

      latInput.value = center.lat.toFixed(6);
      lngInput.value = center.lng.toFixed(6);
      locationDisplay.value = `${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}`;
    }

    document.getElementById("upload-modal")?.classList.remove("hidden");
  }

  private hideUploadModal(): void {
    document.getElementById("upload-modal")?.classList.add("hidden");
    (document.getElementById("observation-form") as HTMLFormElement)?.reset();
  }

  private async searchTaxa(query: string): Promise<void> {
    if (query.length < 2) return;

    try {
      const response = await fetch(
        `${API_BASE}/api/taxa/search?q=${encodeURIComponent(query)}`
      );
      if (!response.ok) return;

      const { results } = await response.json();
      this.showTaxaSuggestions(results);
    } catch (error) {
      console.error("Taxa search failed:", error);
    }
  }

  private showTaxaSuggestions(
    taxa: Array<{ scientificName: string; commonName?: string }>
  ): void {
    const container = document.getElementById("species-suggestions");
    if (!container) return;

    container.innerHTML = taxa
      .slice(0, 5)
      .map(
        (t) => `
        <div class="suggestion" data-name="${t.scientificName}">
          <strong>${t.scientificName}</strong>
          ${t.commonName ? `<span>${t.commonName}</span>` : ""}
        </div>
      `
      )
      .join("");

    container.querySelectorAll(".suggestion").forEach((el) => {
      el.addEventListener("click", () => {
        const input = document.getElementById("species-input") as HTMLInputElement;
        input.value = el.getAttribute("data-name") || "";
        container.innerHTML = "";
      });
    });
  }

  private async extractExif(file: File): Promise<void> {
    // In a full implementation, we'd use exifr or similar library
    // For now, use current location or map center
    if (this.currentLocation) {
      const latInput = document.getElementById("lat-input") as HTMLInputElement;
      const lngInput = document.getElementById("lng-input") as HTMLInputElement;
      const locationDisplay = document.getElementById("location-display") as HTMLInputElement;

      latInput.value = this.currentLocation.lat.toFixed(6);
      lngInput.value = this.currentLocation.lng.toFixed(6);
      locationDisplay.value = `${this.currentLocation.lat.toFixed(4)}, ${this.currentLocation.lng.toFixed(4)}`;
    }
  }

  private async submitObservation(): Promise<void> {
    const speciesInput = document.getElementById("species-input") as HTMLInputElement;
    const notesInput = document.getElementById("notes-input") as HTMLTextAreaElement;
    const latInput = document.getElementById("lat-input") as HTMLInputElement;
    const lngInput = document.getElementById("lng-input") as HTMLInputElement;
    const photoInput = document.getElementById("photo-input") as HTMLInputElement;

    if (!speciesInput.value || !latInput.value || !lngInput.value) {
      alert("Please fill in species and location");
      return;
    }

    // In a full implementation, we'd:
    // 1. Upload the photo to the user's PDS
    // 2. Create the observation record with the blob reference
    // 3. Write the record to the user's repo

    alert("Observation submitted! (Demo mode - not actually saved)");
    this.hideUploadModal();
    this.loadObservationsInView();
  }
}

// Initialize app
const app = new BioSkyApp();
app.init().catch(console.error);
