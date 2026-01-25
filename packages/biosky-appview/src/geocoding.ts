/**
 * Geocoding Service
 *
 * Provides reverse geocoding via Nominatim to populate
 * Darwin Core administrative geography fields.
 */

import pino from "pino";

const logger = pino({
  formatters: {
    level(label) {
      const severityMap: Record<string, string> = {
        trace: "DEBUG",
        debug: "DEBUG",
        info: "INFO",
        warn: "WARNING",
        error: "ERROR",
        fatal: "CRITICAL",
      };
      return { severity: severityMap[label] || "DEFAULT" };
    },
  },
});

/**
 * Darwin Core Location fields populated by geocoding
 */
export interface GeocodedLocation {
  continent?: string | undefined;
  country?: string | undefined;
  countryCode?: string | undefined;
  stateProvince?: string | undefined;
  county?: string | undefined;
  municipality?: string | undefined;
  locality?: string | undefined;
  waterBody?: string | undefined;
}

/**
 * Nominatim address response structure
 */
interface NominatimAddress {
  continent?: string;
  country?: string;
  country_code?: string;
  state?: string;
  county?: string;
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  suburb?: string;
  neighbourhood?: string;
  road?: string;
  water?: string;
  bay?: string;
  sea?: string;
  ocean?: string;
  lake?: string;
  river?: string;
  [key: string]: string | undefined;
}

interface NominatimResponse {
  display_name: string;
  address: NominatimAddress;
  error?: string;
}

/**
 * Map country codes to continents
 * Based on UN geoscheme
 */
const COUNTRY_TO_CONTINENT: Record<string, string> = {
  // Africa
  DZ: "Africa", AO: "Africa", BJ: "Africa", BW: "Africa", BF: "Africa",
  BI: "Africa", CV: "Africa", CM: "Africa", CF: "Africa", TD: "Africa",
  KM: "Africa", CG: "Africa", CD: "Africa", CI: "Africa", DJ: "Africa",
  EG: "Africa", GQ: "Africa", ER: "Africa", SZ: "Africa", ET: "Africa",
  GA: "Africa", GM: "Africa", GH: "Africa", GN: "Africa", GW: "Africa",
  KE: "Africa", LS: "Africa", LR: "Africa", LY: "Africa", MG: "Africa",
  MW: "Africa", ML: "Africa", MR: "Africa", MU: "Africa", MA: "Africa",
  MZ: "Africa", NA: "Africa", NE: "Africa", NG: "Africa", RW: "Africa",
  ST: "Africa", SN: "Africa", SC: "Africa", SL: "Africa", SO: "Africa",
  ZA: "Africa", SS: "Africa", SD: "Africa", TZ: "Africa", TG: "Africa",
  TN: "Africa", UG: "Africa", ZM: "Africa", ZW: "Africa", RE: "Africa",
  YT: "Africa", SH: "Africa", EH: "Africa",

  // Antarctica
  AQ: "Antarctica", BV: "Antarctica", GS: "Antarctica", HM: "Antarctica",

  // Asia
  AF: "Asia", AM: "Asia", AZ: "Asia", BH: "Asia", BD: "Asia",
  BT: "Asia", BN: "Asia", KH: "Asia", CN: "Asia", CY: "Asia",
  GE: "Asia", HK: "Asia", IN: "Asia", ID: "Asia", IR: "Asia",
  IQ: "Asia", IL: "Asia", JP: "Asia", JO: "Asia", KZ: "Asia",
  KW: "Asia", KG: "Asia", LA: "Asia", LB: "Asia", MO: "Asia",
  MY: "Asia", MV: "Asia", MN: "Asia", MM: "Asia", NP: "Asia",
  KP: "Asia", OM: "Asia", PK: "Asia", PS: "Asia", PH: "Asia",
  QA: "Asia", SA: "Asia", SG: "Asia", KR: "Asia", LK: "Asia",
  SY: "Asia", TW: "Asia", TJ: "Asia", TH: "Asia", TL: "Asia",
  TR: "Asia", TM: "Asia", AE: "Asia", UZ: "Asia", VN: "Asia",
  YE: "Asia",

  // Europe
  AL: "Europe", AD: "Europe", AT: "Europe", BY: "Europe", BE: "Europe",
  BA: "Europe", BG: "Europe", HR: "Europe", CZ: "Europe", DK: "Europe",
  EE: "Europe", FI: "Europe", FR: "Europe", DE: "Europe", GR: "Europe",
  HU: "Europe", IS: "Europe", IE: "Europe", IT: "Europe", XK: "Europe",
  LV: "Europe", LI: "Europe", LT: "Europe", LU: "Europe", MT: "Europe",
  MD: "Europe", MC: "Europe", ME: "Europe", NL: "Europe", MK: "Europe",
  NO: "Europe", PL: "Europe", PT: "Europe", RO: "Europe", RU: "Europe",
  SM: "Europe", RS: "Europe", SK: "Europe", SI: "Europe", ES: "Europe",
  SE: "Europe", CH: "Europe", UA: "Europe", GB: "Europe", VA: "Europe",
  AX: "Europe", FO: "Europe", GG: "Europe", IM: "Europe", JE: "Europe",
  GI: "Europe", SJ: "Europe",

  // North America
  AI: "North America", AG: "North America", AW: "North America", BS: "North America",
  BB: "North America", BZ: "North America", BM: "North America", BQ: "North America",
  VG: "North America", CA: "North America", KY: "North America", CR: "North America",
  CU: "North America", CW: "North America", DM: "North America", DO: "North America",
  SV: "North America", GL: "North America", GD: "North America", GP: "North America",
  GT: "North America", HT: "North America", HN: "North America", JM: "North America",
  MQ: "North America", MX: "North America", MS: "North America", NI: "North America",
  PA: "North America", PR: "North America", BL: "North America", KN: "North America",
  LC: "North America", MF: "North America", PM: "North America", VC: "North America",
  SX: "North America", TT: "North America", TC: "North America", US: "North America",
  VI: "North America",

  // Oceania
  AS: "Oceania", AU: "Oceania", CK: "Oceania", FJ: "Oceania", PF: "Oceania",
  GU: "Oceania", KI: "Oceania", MH: "Oceania", FM: "Oceania", NR: "Oceania",
  NC: "Oceania", NZ: "Oceania", NU: "Oceania", NF: "Oceania", MP: "Oceania",
  PW: "Oceania", PG: "Oceania", PN: "Oceania", WS: "Oceania", SB: "Oceania",
  TK: "Oceania", TO: "Oceania", TV: "Oceania", UM: "Oceania", VU: "Oceania",
  WF: "Oceania", CC: "Oceania", CX: "Oceania",

  // South America
  AR: "South America", BO: "South America", BR: "South America", CL: "South America",
  CO: "South America", EC: "South America", FK: "South America", GF: "South America",
  GY: "South America", PY: "South America", PE: "South America", SR: "South America",
  UY: "South America", VE: "South America",
};

// Simple in-memory cache with TTL
const geocodeCache = new Map<string, { result: GeocodedLocation; timestamp: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours - geocoding results rarely change

// Rate limiting - Nominatim allows 1 request per second
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1100; // 1.1 seconds to be safe

export class GeocodingService {
  private baseUrl: string;
  private userAgent: string;
  private fetchFn: typeof fetch;

  constructor(options: { baseUrl?: string; userAgent?: string; fetch?: typeof fetch } = {}) {
    this.baseUrl = options.baseUrl || "https://nominatim.openstreetmap.org";
    this.userAgent = options.userAgent || "BioSky/1.0 (https://github.com/frewsxcv/biosky)";
    this.fetchFn = options.fetch || fetch;
  }

  /**
   * Reverse geocode coordinates to get Darwin Core location fields
   */
  async reverseGeocode(latitude: number, longitude: number): Promise<GeocodedLocation> {
    // Validate coordinates
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      throw new Error(`Invalid coordinates: ${latitude}, ${longitude}`);
    }

    // Round to 6 decimal places for cache key (about 0.1m precision)
    const cacheKey = `${latitude.toFixed(6)},${longitude.toFixed(6)}`;

    // Check cache
    const cached = geocodeCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.result;
    }

    // Rate limiting
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
      await new Promise((resolve) => setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest));
    }
    lastRequestTime = Date.now();

    // Make request to Nominatim
    const url = new URL("/reverse", this.baseUrl);
    url.searchParams.set("lat", String(latitude));
    url.searchParams.set("lon", String(longitude));
    url.searchParams.set("format", "json");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("zoom", "18"); // High detail level

    try {
      const response = await this.fetchFn(url.toString(), {
        headers: {
          "User-Agent": this.userAgent,
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Nominatim API error: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as NominatimResponse;

      if (data.error) {
        // Location might be in ocean or uninhabited area
        logger.warn({ lat: latitude, lon: longitude, error: data.error }, "Nominatim returned error");
        return {};
      }

      const result = this.parseNominatimResponse(data);

      // Cache the result
      geocodeCache.set(cacheKey, { result, timestamp: Date.now() });

      logger.debug(
        { lat: latitude, lon: longitude, country: result.country },
        "Geocoded coordinates"
      );

      return result;
    } catch (error) {
      logger.error({ err: error, lat: latitude, lon: longitude }, "Geocoding failed");
      throw error;
    }
  }

  /**
   * Parse Nominatim response into Darwin Core location fields
   */
  private parseNominatimResponse(data: NominatimResponse): GeocodedLocation {
    const addr = data.address;
    const result: GeocodedLocation = {};

    // Country and country code
    if (addr.country) {
      result.country = addr.country;
    }
    if (addr.country_code) {
      result.countryCode = addr.country_code.toUpperCase();

      // Derive continent from country code
      const continent = COUNTRY_TO_CONTINENT[result.countryCode];
      if (continent) {
        result.continent = continent;
      }
    }

    // State/province
    if (addr.state) {
      result.stateProvince = addr.state;
    }

    // County
    if (addr.county) {
      result.county = addr.county;
    }

    // Municipality - try city, then town, then village
    result.municipality = addr.city || addr.town || addr.village || addr.municipality;

    // Locality - build from available detail
    const localityParts: string[] = [];
    if (addr.suburb) localityParts.push(addr.suburb);
    if (addr.neighbourhood) localityParts.push(addr.neighbourhood);
    if (addr.road) localityParts.push(addr.road);

    if (localityParts.length > 0) {
      result.locality = localityParts.join(", ");
    }

    // Water body - check various water-related fields
    result.waterBody = addr.water || addr.bay || addr.sea || addr.ocean || addr.lake || addr.river;

    return result;
  }

  /**
   * Clear the geocoding cache (useful for testing)
   */
  clearCache(): void {
    geocodeCache.clear();
  }
}
