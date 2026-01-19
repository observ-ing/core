/**
 * BioSky Frontend
 *
 * Feed-based interface for exploring and contributing biodiversity observations.
 */

import maplibregl from "maplibre-gl";

const API_BASE = import.meta.env.VITE_API_URL || "";

interface Observation {
  uri: string;
  cid: string;
  observer: {
    did: string;
    handle?: string;
    displayName?: string;
    avatar?: string;
  };
  scientificName?: string;
  communityId?: string;
  eventDate: string;
  location: {
    latitude: number;
    longitude: number;
    uncertaintyMeters?: number;
  };
  verbatimLocality?: string;
  occurrenceRemarks?: string;
  images: string[];
  createdAt: string;
}

interface User {
  did: string;
  handle: string;
}

type ViewMode = "feed" | "map";
type FeedTab = "home" | "explore";

class BioSkyApp {
  private map: maplibregl.Map | null = null;
  private currentUser: User | null = null;
  private currentLocation: { lat: number; lng: number } | null = null;
  private currentView: ViewMode = "feed";
  private currentTab: FeedTab = "home";
  private feedCursor: string | undefined = undefined;
  private isLoadingFeed = false;
  private mapInitialized = false;

  async init(): Promise<void> {
    this.setupEventListeners();
    await this.checkAuth();
    await this.loadFeed();
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
    // Login button - show modal
    document.getElementById("login-btn")?.addEventListener("click", () => {
      document.getElementById("login-modal")?.classList.remove("hidden");
      document.getElementById("handle-input")?.focus();
    });

    // Cancel login
    document.getElementById("cancel-login")?.addEventListener("click", () => {
      document.getElementById("login-modal")?.classList.add("hidden");
    });

    // Close login modal on overlay click
    document.getElementById("login-modal")?.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) {
        document.getElementById("login-modal")?.classList.add("hidden");
      }
    });

    // Login form submission
    document.getElementById("login-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const handleInput = document.getElementById("handle-input") as HTMLInputElement;
      const handle = handleInput.value.trim();
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

    // Bottom navigation
    document.querySelectorAll(".nav-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const view = btn.getAttribute("data-view") as ViewMode;
        if (view) this.switchView(view);
      });
    });

    // Feed tabs
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = btn.getAttribute("data-tab") as FeedTab;
        if (tab) this.switchTab(tab);
      });
    });

    // FAB upload button
    document.getElementById("fab-upload")?.addEventListener("click", () => {
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

    // Quick species buttons
    document.querySelectorAll(".quick-species button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const species = btn.getAttribute("data-species");
        const input = document.getElementById("species-input") as HTMLInputElement;
        if (species && input) {
          input.value = species;
        }
      });
    });

    // Infinite scroll for feed
    document.getElementById("feed-content")?.addEventListener("scroll", (e) => {
      const target = e.target as HTMLElement;
      if (target.scrollTop + target.clientHeight >= target.scrollHeight - 200) {
        this.loadMoreFeed();
      }
    });
  }

  private async switchView(view: ViewMode): Promise<void> {
    if (view === this.currentView) return;

    this.currentView = view;

    // Update nav button states
    document.querySelectorAll(".nav-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-view") === view);
    });

    // Toggle containers
    const feedContainer = document.getElementById("feed-container");
    const mapContainer = document.getElementById("map-container");

    if (view === "feed") {
      feedContainer?.classList.remove("hidden");
      mapContainer?.classList.add("hidden");
    } else {
      feedContainer?.classList.add("hidden");
      mapContainer?.classList.remove("hidden");

      // Initialize map on first switch
      if (!this.mapInitialized) {
        await this.initMap();
        this.mapInitialized = true;
        this.loadObservationsInView();
      }
    }
  }

  private async switchTab(tab: FeedTab): Promise<void> {
    if (tab === this.currentTab) return;

    this.currentTab = tab;

    // Update tab button states
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-tab") === tab);
    });

    // Reset feed and reload
    this.feedCursor = undefined;
    const feedList = document.getElementById("feed-list");
    if (feedList) feedList.innerHTML = "";

    await this.loadFeed();
  }

  private async loadFeed(): Promise<void> {
    if (this.isLoadingFeed) return;
    this.isLoadingFeed = true;

    const loading = document.getElementById("feed-loading");
    const empty = document.getElementById("feed-empty");
    const feedList = document.getElementById("feed-list");

    loading?.classList.remove("hidden");
    empty?.classList.add("hidden");

    try {
      const params = new URLSearchParams({ limit: "20" });
      if (this.feedCursor) {
        params.set("cursor", this.feedCursor);
      }

      const response = await fetch(`${API_BASE}/api/occurrences/feed?${params}`);
      if (!response.ok) throw new Error("Failed to load feed");

      const { occurrences, cursor } = await response.json();
      this.feedCursor = cursor;

      if (occurrences.length === 0 && !this.feedCursor) {
        empty?.classList.remove("hidden");
      } else {
        this.renderFeedItems(occurrences);
      }
    } catch (error) {
      console.error("Failed to load feed:", error);
    } finally {
      loading?.classList.add("hidden");
      this.isLoadingFeed = false;
    }
  }

  private async loadMoreFeed(): Promise<void> {
    if (!this.feedCursor || this.isLoadingFeed) return;
    await this.loadFeed();
  }

  private renderFeedItems(observations: Observation[]): void {
    const feedList = document.getElementById("feed-list");
    if (!feedList) return;

    for (const obs of observations) {
      const item = document.createElement("div");
      item.className = "feed-item";
      item.innerHTML = this.renderFeedItem(obs);
      feedList.appendChild(item);
    }
  }

  private renderFeedItem(obs: Observation): string {
    const displayName = obs.observer.displayName || obs.observer.handle || obs.observer.did.slice(0, 20);
    const handle = obs.observer.handle ? `@${obs.observer.handle}` : "";
    const timeAgo = this.formatTimeAgo(new Date(obs.createdAt));
    const species = obs.communityId || obs.scientificName || "Unknown species";
    const imageUrl = obs.images[0] ? `${API_BASE}${obs.images[0]}` : "";

    return `
      <div class="feed-avatar">
        ${obs.observer.avatar ? `<img src="${obs.observer.avatar}" alt="${displayName}" />` : ""}
      </div>
      <div class="feed-body">
        <div class="feed-header">
          <span class="feed-name">${this.escapeHtml(displayName)}</span>
          ${handle ? `<span class="feed-handle">${this.escapeHtml(handle)}</span>` : ""}
          <span class="feed-time">${timeAgo}</span>
        </div>
        <div class="feed-species">${this.escapeHtml(species)}</div>
        ${obs.occurrenceRemarks ? `<div class="feed-notes">${this.escapeHtml(obs.occurrenceRemarks)}</div>` : ""}
        ${obs.verbatimLocality ? `<div class="feed-location">${this.escapeHtml(obs.verbatimLocality)}</div>` : ""}
        ${imageUrl ? `<div class="feed-image"><img src="${imageUrl}" alt="${species}" loading="lazy" /></div>` : ""}
      </div>
    `;
  }

  private formatTimeAgo(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

    if (seconds < 60) return "now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;

    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  private escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
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
      const response = await fetch(`${API_BASE}/api/occurrences/geojson?${params}`);
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
        `${API_BASE}/api/occurrences/${encodeURIComponent(uri)}`
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
    // Update banner based on auth state
    const banner = document.getElementById("upload-banner");
    if (banner) {
      if (this.currentUser) {
        banner.className = "auth-banner";
        banner.textContent = `Posting as @${this.currentUser.handle}`;
      } else {
        banner.className = "demo-banner";
        banner.textContent = "Demo Mode - Login to post to AT Protocol";
      }
    }

    const latInput = document.getElementById("lat-input") as HTMLInputElement;
    const lngInput = document.getElementById("lng-input") as HTMLInputElement;
    const locationDisplay = document.getElementById("location-display") as HTMLInputElement;

    // Try to get location from map center or geolocation
    if (this.map) {
      const center = this.map.getCenter();
      latInput.value = center.lat.toFixed(6);
      lngInput.value = center.lng.toFixed(6);
      locationDisplay.value = `${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}`;
    } else if (this.currentLocation) {
      latInput.value = this.currentLocation.lat.toFixed(6);
      lngInput.value = this.currentLocation.lng.toFixed(6);
      locationDisplay.value = `${this.currentLocation.lat.toFixed(4)}, ${this.currentLocation.lng.toFixed(4)}`;
    } else {
      // Try to get user's location
      locationDisplay.value = "Getting location...";
      navigator.geolocation?.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          this.currentLocation = { lat: latitude, lng: longitude };
          latInput.value = latitude.toFixed(6);
          lngInput.value = longitude.toFixed(6);
          locationDisplay.value = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
        },
        () => {
          // Default to San Francisco if geolocation fails
          latInput.value = "37.7749";
          lngInput.value = "-122.4194";
          locationDisplay.value = "37.7749, -122.4194 (default)";
        }
      );
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

  private async submitObservation(): Promise<void> {
    const speciesInput = document.getElementById("species-input") as HTMLInputElement;
    const notesInput = document.getElementById("notes-input") as HTMLTextAreaElement;
    const latInput = document.getElementById("lat-input") as HTMLInputElement;
    const lngInput = document.getElementById("lng-input") as HTMLInputElement;
    const submitBtn = document.querySelector('#observation-form button[type="submit"]') as HTMLButtonElement;

    if (!latInput.value || !lngInput.value) {
      alert("Please provide a location");
      return;
    }

    // Disable button while submitting
    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting...";

    try {
      const response = await fetch(`${API_BASE}/api/occurrences`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          scientificName: speciesInput.value || "Unknown species",
          latitude: parseFloat(latInput.value),
          longitude: parseFloat(lngInput.value),
          notes: notesInput.value || undefined,
          eventDate: new Date().toISOString(),
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to submit");
      }

      const result = await response.json();

      // Show success feedback
      this.showSuccessMessage("Observation submitted successfully!");
      this.hideUploadModal();

      // Refresh the current view
      if (this.currentView === "feed") {
        // Reset and reload feed to show new observation
        this.feedCursor = undefined;
        const feedList = document.getElementById("feed-list");
        if (feedList) feedList.innerHTML = "";
        await this.loadFeed();
      } else if (this.map) {
        this.loadObservationsInView();
      }
    } catch (error) {
      console.error("Failed to submit observation:", error);
      alert(`Failed to submit: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit";
    }
  }

  private showSuccessMessage(message: string): void {
    // Create toast notification
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    document.body.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
      toast.classList.add("show");
    });

    // Remove after 3 seconds
    setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }
}

// Initialize app
const app = new BioSkyApp();
app.init().catch(console.error);
