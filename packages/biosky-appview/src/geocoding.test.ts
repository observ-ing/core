import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GeocodingService } from "./geocoding.js";

describe("GeocodingService", () => {
  let service: GeocodingService;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    service = new GeocodingService({ fetch: mockFetch as typeof fetch });
    service.clearCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("reverseGeocode", () => {
    it("returns Darwin Core location fields from Nominatim response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            display_name: "Golden Gate Park, San Francisco, California, USA",
            address: {
              leisure: "Golden Gate Park",
              city: "San Francisco",
              county: "San Francisco County",
              state: "California",
              country: "United States",
              country_code: "us",
            },
          }),
      });

      const result = await service.reverseGeocode(37.7694, -122.4862);

      expect(result).toEqual({
        continent: "North America",
        country: "United States",
        countryCode: "US",
        stateProvince: "California",
        county: "San Francisco County",
        municipality: "San Francisco",
      });

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(mockFetch.mock.calls[0]?.[0]).toContain("lat=37.7694");
      expect(mockFetch.mock.calls[0]?.[0]).toContain("lon=-122.4862");
    });

    it("maps European countries to Europe continent", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            display_name: "Paris, France",
            address: {
              city: "Paris",
              state: "Île-de-France",
              country: "France",
              country_code: "fr",
            },
          }),
      });

      const result = await service.reverseGeocode(48.8566, 2.3522);

      expect(result.continent).toBe("Europe");
      expect(result.countryCode).toBe("FR");
      expect(result.country).toBe("France");
    });

    it("maps Asian countries to Asia continent", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            display_name: "Tokyo, Japan",
            address: {
              city: "Tokyo",
              country: "Japan",
              country_code: "jp",
            },
          }),
      });

      const result = await service.reverseGeocode(35.6762, 139.6503);

      expect(result.continent).toBe("Asia");
      expect(result.countryCode).toBe("JP");
    });

    it("maps South American countries correctly", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            display_name: "Rio de Janeiro, Brazil",
            address: {
              city: "Rio de Janeiro",
              state: "Rio de Janeiro",
              country: "Brazil",
              country_code: "br",
            },
          }),
      });

      const result = await service.reverseGeocode(-22.9068, -43.1729);

      expect(result.continent).toBe("South America");
      expect(result.countryCode).toBe("BR");
    });

    it("includes locality from suburb, neighbourhood, and road", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            display_name: "123 Main St, Downtown, Seattle, WA, USA",
            address: {
              road: "Main Street",
              neighbourhood: "Downtown",
              suburb: "Central District",
              city: "Seattle",
              state: "Washington",
              country: "United States",
              country_code: "us",
            },
          }),
      });

      const result = await service.reverseGeocode(47.6062, -122.3321);

      expect(result.locality).toBe("Central District, Downtown, Main Street");
    });

    it("includes water body when present", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            display_name: "Lake Superior",
            address: {
              water: "Lake Superior",
              country: "United States",
              country_code: "us",
            },
          }),
      });

      const result = await service.reverseGeocode(47.5, -87.5);

      expect(result.waterBody).toBe("Lake Superior");
    });

    it("handles ocean water body", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            display_name: "Pacific Ocean",
            address: {
              ocean: "Pacific Ocean",
            },
          }),
      });

      const result = await service.reverseGeocode(0, -140);

      expect(result.waterBody).toBe("Pacific Ocean");
    });

    it("uses town when city is not available", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            display_name: "Small Town, Vermont, USA",
            address: {
              town: "Woodstock",
              state: "Vermont",
              country: "United States",
              country_code: "us",
            },
          }),
      });

      const result = await service.reverseGeocode(43.6243, -72.5185);

      expect(result.municipality).toBe("Woodstock");
    });

    it("uses village when city and town are not available", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            display_name: "Small Village, Wales",
            address: {
              village: "Llanfairpwllgwyngyll",
              county: "Anglesey",
              country: "United Kingdom",
              country_code: "gb",
            },
          }),
      });

      const result = await service.reverseGeocode(53.2214, -4.2033);

      expect(result.municipality).toBe("Llanfairpwllgwyngyll");
    });

    it("caches results for same coordinates", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            display_name: "Test Location",
            address: {
              country: "Test Country",
              country_code: "tc",
            },
          }),
      });

      // First call
      await service.reverseGeocode(40.0, -100.0);
      // Second call with same coordinates
      await service.reverseGeocode(40.0, -100.0);

      // Should only have called fetch once due to caching
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it("returns empty object when Nominatim returns error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            error: "Unable to geocode",
          }),
      });

      const result = await service.reverseGeocode(0, 0);

      expect(result).toEqual({});
    });

    it("throws on invalid coordinates", async () => {
      await expect(service.reverseGeocode(91, 0)).rejects.toThrow("Invalid coordinates");
      await expect(service.reverseGeocode(-91, 0)).rejects.toThrow("Invalid coordinates");
      await expect(service.reverseGeocode(0, 181)).rejects.toThrow("Invalid coordinates");
      await expect(service.reverseGeocode(0, -181)).rejects.toThrow("Invalid coordinates");
    });

    it("throws when API returns non-OK response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      await expect(service.reverseGeocode(40.0, -100.0)).rejects.toThrow(
        "Nominatim API error: 500 Internal Server Error"
      );
    });

    it("throws when fetch fails", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      await expect(service.reverseGeocode(40.0, -100.0)).rejects.toThrow("Network error");
    });

    it("includes correct User-Agent header", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            display_name: "Test",
            address: {},
          }),
      });

      await service.reverseGeocode(40.0, -100.0);

      expect(mockFetch.mock.calls[0]?.[1]?.headers?.["User-Agent"]).toContain("BioSky");
    });
  });

  describe("continent mapping", () => {
    const continentTests = [
      { code: "us", expected: "North America" },
      { code: "ca", expected: "North America" },
      { code: "mx", expected: "North America" },
      { code: "gb", expected: "Europe" },
      { code: "de", expected: "Europe" },
      { code: "fr", expected: "Europe" },
      { code: "jp", expected: "Asia" },
      { code: "cn", expected: "Asia" },
      { code: "in", expected: "Asia" },
      { code: "au", expected: "Oceania" },
      { code: "nz", expected: "Oceania" },
      { code: "br", expected: "South America" },
      { code: "ar", expected: "South America" },
      { code: "za", expected: "Africa" },
      { code: "eg", expected: "Africa" },
      { code: "ke", expected: "Africa" },
      { code: "aq", expected: "Antarctica" },
    ];

    for (const { code, expected } of continentTests) {
      it(`maps ${code.toUpperCase()} to ${expected}`, async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              display_name: "Test Location",
              address: {
                country: "Test Country",
                country_code: code,
              },
            }),
        });

        // Use different coordinates for each test to avoid cache
        const result = await service.reverseGeocode(
          Math.random() * 180 - 90,
          Math.random() * 360 - 180
        );

        expect(result.continent).toBe(expected);
      });
    }
  });
});
