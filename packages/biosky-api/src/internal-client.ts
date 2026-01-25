/**
 * Internal client for calling appview's AT Protocol RPC endpoints
 *
 * Used by the API service to perform write operations that require
 * the OAuth agent (blob uploads, record creation, etc.)
 */

import { logger } from "./middleware/logging.js";

export interface InternalClientConfig {
  appviewUrl: string;
  internalSecret?: string | undefined;
}

export interface BlobResult {
  success: boolean;
  blob?: unknown;
  error?: string;
}

export interface RecordResult {
  success: boolean;
  uri?: string;
  cid?: string;
  error?: string;
}

export class InternalClient {
  private appviewUrl: string;
  private internalSecret?: string | undefined;

  constructor(config: InternalClientConfig) {
    this.appviewUrl = config.appviewUrl;
    this.internalSecret = config.internalSecret;
  }

  private async post<T>(endpoint: string, body: unknown): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.internalSecret) {
      headers["X-Internal-Secret"] = this.internalSecret;
    }

    const response = await fetch(`${this.appviewUrl}/internal/agent${endpoint}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Unknown error" }));
      throw new Error((error as { error?: string }).error || `HTTP ${response.status}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Upload a blob to user's PDS via appview
   */
  async uploadBlob(did: string, data: string, mimeType: string): Promise<BlobResult> {
    try {
      const result = await this.post<{ success: boolean; blob: unknown }>("/upload-blob", {
        did,
        data,
        mimeType,
      });
      return result;
    } catch (error) {
      logger.error({ err: error, did }, "Failed to upload blob via internal RPC");
      return { success: false, error: String(error) };
    }
  }

  /**
   * Create a record on user's PDS via appview
   */
  async createRecord(
    did: string,
    collection: string,
    record: unknown,
    rkey?: string
  ): Promise<RecordResult> {
    try {
      const result = await this.post<{ success: boolean; uri: string; cid: string }>(
        "/create-record",
        {
          did,
          collection,
          record,
          ...(rkey && { rkey }),
        }
      );
      return result;
    } catch (error) {
      logger.error({ err: error, did, collection }, "Failed to create record via internal RPC");
      return { success: false, error: String(error) };
    }
  }

  /**
   * Update a record on user's PDS via appview
   */
  async putRecord(
    did: string,
    collection: string,
    rkey: string,
    record: unknown
  ): Promise<RecordResult> {
    try {
      const result = await this.post<{ success: boolean; uri: string; cid: string }>(
        "/put-record",
        {
          did,
          collection,
          rkey,
          record,
        }
      );
      return result;
    } catch (error) {
      logger.error({ err: error, did, collection, rkey }, "Failed to update record via internal RPC");
      return { success: false, error: String(error) };
    }
  }

  /**
   * Delete a record from user's PDS via appview
   */
  async deleteRecord(did: string, collection: string, rkey: string): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await this.post<{ success: boolean }>("/delete-record", {
        did,
        collection,
        rkey,
      });
      return result;
    } catch (error) {
      logger.error({ err: error, did, collection, rkey }, "Failed to delete record via internal RPC");
      return { success: false, error: String(error) };
    }
  }
}
