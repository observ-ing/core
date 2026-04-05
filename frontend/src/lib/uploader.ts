/**
 * Occurrence Uploader
 *
 * Handles the complete flow for uploading occurrences:
 * 1. Capture/select photo
 * 2. Extract EXIF data (date/location)
 * 3. Upload blob to PDS
 * 4. Write bio.lexicons.temp.occurrence record to the user's repo
 */

import type { AtpAgent, BlobRef } from "@atproto/api";

const OCCURRENCE_COLLECTION = "bio.lexicons.temp.occurrence";
const MEDIA_COLLECTION = "bio.lexicons.temp.media";

/**
 * The subset of AtpAgent required by OccurrenceUploader.
 * Defined structurally so tests can provide narrow mocks.
 */
export interface UploaderAgent {
  session?: { did: string } | undefined;
  com: {
    atproto: {
      repo: {
        createRecord: AtpAgent["com"]["atproto"]["repo"]["createRecord"];
      };
    };
  };
  uploadBlob: AtpAgent["uploadBlob"];
}

interface UploadConfig {
  pdsUrl: string;
}

interface OccurrenceData {
  eventDate: string;
  location: {
    decimalLatitude: number;
    decimalLongitude: number;
    coordinateUncertaintyInMeters?: number;
  };
  images: File[];
}

interface UploadResult {
  uri: string;
  cid: string;
}

interface ExifData {
  dateTime?: Date;
  latitude?: number;
  longitude?: number;
}

export class OccurrenceUploader {
  private agent: UploaderAgent;
  private config: UploadConfig;

  constructor(agent: UploaderAgent, config: Partial<UploadConfig> = {}) {
    this.agent = agent;
    this.config = {
      pdsUrl: config.pdsUrl || "https://bsky.social",
    };
  }

  /**
   * Upload a complete occurrence
   */
  async upload(data: OccurrenceData): Promise<UploadResult> {
    // Validate data
    this.validateOccurrence(data);

    // Upload images as blobs and create media records
    const blobRefs = await this.uploadImages(data.images);
    const mediaRefs = await this.createMediaRecords(blobRefs);

    // Create the occurrence record (flat coordinates per bio.lexicons.temp.occurrence)
    const record: Record<string, unknown> = {
      $type: OCCURRENCE_COLLECTION,
      decimalLatitude: String(data.location.decimalLatitude),
      decimalLongitude: String(data.location.decimalLongitude),
      eventDate: data.eventDate,
      associatedMedia: mediaRefs,
    };
    if (data.location.coordinateUncertaintyInMeters != null) {
      record["coordinateUncertaintyInMeters"] = data.location.coordinateUncertaintyInMeters;
    }

    if (!this.agent.session) {
      throw new Error("Not logged in");
    }

    // Write to repo
    const response = await this.agent.com.atproto.repo.createRecord({
      repo: this.agent.session.did,
      collection: OCCURRENCE_COLLECTION,
      record,
    });

    return {
      uri: response.data.uri,
      cid: response.data.cid,
    };
  }

  /**
   * Upload images to the PDS as blobs
   */
  private async uploadImages(files: File[]): Promise<BlobRef[]> {
    const blobRefs: BlobRef[] = [];

    // Sequential uploads required — PDS rate limits
    for (const file of files) {
      // eslint-disable-next-line no-await-in-loop
      const arrayBuffer = await file.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      // eslint-disable-next-line no-await-in-loop
      const response = await this.agent.uploadBlob(uint8Array, {
        encoding: file.type,
      });

      blobRefs.push(response.data.blob);
    }

    return blobRefs;
  }

  /**
   * Create bio.lexicons.temp.media records and return strong refs
   */
  private async createMediaRecords(blobRefs: BlobRef[]): Promise<{ uri: string; cid: string }[]> {
    if (!this.agent.session) {
      throw new Error("Not logged in");
    }

    const refs: { uri: string; cid: string }[] = [];
    for (const blob of blobRefs) {
      // eslint-disable-next-line no-await-in-loop
      const response = await this.agent.com.atproto.repo.createRecord({
        repo: this.agent.session.did,
        collection: MEDIA_COLLECTION,
        record: {
          $type: MEDIA_COLLECTION,
          image: blob,
        },
      });
      refs.push({ uri: response.data.uri, cid: response.data.cid });
    }
    return refs;
  }

  /**
   * Validate occurrence data before upload
   */
  private validateOccurrence(data: OccurrenceData): void {
    if (!data.eventDate) {
      throw new Error("Event date is required");
    }

    const date = new Date(data.eventDate);
    if (isNaN(date.getTime())) {
      throw new Error("Invalid event date format");
    }

    if (date > new Date()) {
      throw new Error("Event date cannot be in the future");
    }

    if (!data.location) {
      throw new Error("Location is required");
    }

    const { decimalLatitude, decimalLongitude } = data.location;
    if (decimalLatitude < -90 || decimalLatitude > 90) {
      throw new Error("Latitude must be between -90 and 90");
    }

    if (decimalLongitude < -180 || decimalLongitude > 180) {
      throw new Error("Longitude must be between -180 and 180");
    }

    if (data.images.length === 0) {
      throw new Error("At least one photo is required");
    }

    // Validate image types
    const validTypes = ["image/jpeg", "image/png", "image/webp"];
    for (const file of data.images) {
      if (!validTypes.includes(file.type)) {
        throw new Error(`Invalid image type: ${file.type}`);
      }
      if (file.size > 10 * 1024 * 1024) {
        throw new Error("Image file too large (max 10MB)");
      }
    }
  }

  /**
   * Extract EXIF data from an image file
   */
  async extractExif(file: File): Promise<ExifData> {
    // This is a simplified version - in production, use exifr or similar
    const exifData: ExifData = {};

    try {
      const arrayBuffer = await file.arrayBuffer();
      const dataView = new DataView(arrayBuffer);

      // Check for JPEG
      if (dataView.getUint16(0) !== 0xffd8) {
        return exifData;
      }

      // Find EXIF header
      let offset = 2;
      while (offset < dataView.byteLength) {
        const marker = dataView.getUint16(offset);

        if (marker === 0xffe1) {
          // EXIF marker found
          const exifOffset = offset + 4;

          // Check for "Exif\0\0"
          const exifHeader =
            String.fromCharCode(
              dataView.getUint8(exifOffset),
              dataView.getUint8(exifOffset + 1),
              dataView.getUint8(exifOffset + 2),
              dataView.getUint8(exifOffset + 3),
            ) +
            String.fromCharCode(
              dataView.getUint8(exifOffset + 4),
              dataView.getUint8(exifOffset + 5),
            );

          if (exifHeader === "Exif\0\0") {
            // Parse TIFF header and IFDs
            // This is simplified - full parsing would handle all EXIF tags
            break;
          }
        }

        // Move to next marker
        const length = dataView.getUint16(offset + 2);
        offset += 2 + length;
      }

      // If EXIF not found or incomplete, try to get from file metadata
      if (!exifData.dateTime && file.lastModified) {
        exifData.dateTime = new Date(file.lastModified);
      }
    } catch (error) {
      console.error("EXIF extraction error:", error);
    }

    return exifData;
  }

  /**
   * Compress an image for upload
   */
  async compressImage(file: File, maxWidth = 2048, quality = 0.85): Promise<File> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      img.onload = () => {
        let { width, height } = img;

        // Scale down if necessary
        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;
        ctx?.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(new File([blob], file.name, { type: "image/jpeg" }));
            } else {
              reject(new Error("Failed to compress image"));
            }
          },
          "image/jpeg",
          quality,
        );
      };

      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = URL.createObjectURL(file);
    });
  }
}

export type { OccurrenceData, UploadResult, ExifData };
