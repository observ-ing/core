/**
 * Identification Component
 *
 * Handles the "Agree" / "Suggest ID" functionality that writes
 * org.rwell.test.identification records to the user's repo.
 */

import { AtpAgent } from "@atproto/api";

const IDENTIFICATION_COLLECTION = "org.rwell.test.identification";

interface IdentificationInput {
  /** URI of the occurrence being identified */
  occurrenceUri: string;
  /** CID of the occurrence being identified */
  occurrenceCid: string;
  /** Index of the subject within the occurrence (for multi-subject observations) */
  subjectIndex?: number;
  /** The proposed scientific name */
  taxonName: string;
  /** Taxonomic rank */
  taxonRank?: TaxonRank;
  /** Comment explaining the identification */
  comment?: string;
  /** Whether this is an agreement with existing ID */
  isAgreement?: boolean;
  /** Confidence level */
  confidence?: ConfidenceLevel;
}

type TaxonRank =
  | "kingdom"
  | "phylum"
  | "class"
  | "order"
  | "family"
  | "genus"
  | "species"
  | "subspecies"
  | "variety";

type ConfidenceLevel = "low" | "medium" | "high";

interface IdentificationResult {
  uri: string;
  cid: string;
}

export class IdentificationService {
  private agent: AtpAgent;

  constructor(agent: AtpAgent) {
    this.agent = agent;
  }

  /**
   * Submit an identification for an occurrence
   */
  async identify(input: IdentificationInput): Promise<IdentificationResult> {
    if (!this.agent.session) {
      throw new Error("Not logged in");
    }

    // Validate input
    this.validateInput(input);

    const record = {
      $type: IDENTIFICATION_COLLECTION,
      subject: {
        uri: input.occurrenceUri,
        cid: input.occurrenceCid,
      },
      subjectIndex: input.subjectIndex ?? 0,
      taxonName: input.taxonName,
      taxonRank: input.taxonRank || "species",
      comment: input.comment,
      isAgreement: input.isAgreement || false,
      confidence: input.confidence || "medium",
      createdAt: new Date().toISOString(),
    };

    const response = await this.agent.com.atproto.repo.createRecord({
      repo: this.agent.session.did,
      collection: IDENTIFICATION_COLLECTION,
      record,
    });

    return {
      uri: response.data.uri,
      cid: response.data.cid,
    };
  }

  /**
   * Agree with an existing identification
   */
  async agree(
    occurrenceUri: string,
    occurrenceCid: string,
    currentTaxonName: string,
    subjectIndex: number = 0
  ): Promise<IdentificationResult> {
    return this.identify({
      occurrenceUri,
      occurrenceCid,
      subjectIndex,
      taxonName: currentTaxonName,
      isAgreement: true,
      confidence: "high",
    });
  }

  /**
   * Suggest a different identification
   */
  async suggestId(
    occurrenceUri: string,
    occurrenceCid: string,
    taxonName: string,
    options: {
      subjectIndex?: number;
      taxonRank?: TaxonRank;
      comment?: string;
      confidence?: ConfidenceLevel;
    } = {}
  ): Promise<IdentificationResult> {
    return this.identify({
      occurrenceUri,
      occurrenceCid,
      subjectIndex: options.subjectIndex ?? 0,
      taxonName,
      taxonRank: options.taxonRank,
      comment: options.comment,
      isAgreement: false,
      confidence: options.confidence,
    });
  }

  /**
   * Withdraw a previous identification
   */
  async withdraw(identificationUri: string): Promise<void> {
    if (!this.agent.session) {
      throw new Error("Not logged in");
    }

    // Extract rkey from URI
    const parts = identificationUri.split("/");
    const rkey = parts[parts.length - 1];

    await this.agent.com.atproto.repo.deleteRecord({
      repo: this.agent.session.did,
      collection: IDENTIFICATION_COLLECTION,
      rkey,
    });
  }

  /**
   * Update an existing identification
   */
  async update(
    identificationUri: string,
    updates: Partial<Omit<IdentificationInput, "occurrenceUri" | "occurrenceCid">>
  ): Promise<IdentificationResult> {
    if (!this.agent.session) {
      throw new Error("Not logged in");
    }

    // Get the existing record
    const parts = identificationUri.split("/");
    const rkey = parts[parts.length - 1];

    const existing = await this.agent.com.atproto.repo.getRecord({
      repo: this.agent.session.did,
      collection: IDENTIFICATION_COLLECTION,
      rkey,
    });

    const existingRecord = existing.data.value as {
      $type: string;
      subject: { uri: string; cid: string };
      taxonName: string;
      taxonRank?: string;
      comment?: string;
      isAgreement?: boolean;
      confidence?: string;
      createdAt: string;
    };

    // Merge updates
    const updatedRecord = {
      ...existingRecord,
      taxonName: updates.taxonName || existingRecord.taxonName,
      taxonRank: updates.taxonRank || existingRecord.taxonRank,
      comment: updates.comment !== undefined ? updates.comment : existingRecord.comment,
      confidence: updates.confidence || existingRecord.confidence,
    };

    const response = await this.agent.com.atproto.repo.putRecord({
      repo: this.agent.session.did,
      collection: IDENTIFICATION_COLLECTION,
      rkey,
      record: updatedRecord,
    });

    return {
      uri: response.data.uri,
      cid: response.data.cid,
    };
  }

  /**
   * Get all identifications by the current user
   */
  async getMyIdentifications(
    limit = 50
  ): Promise<Array<{ uri: string; cid: string; value: unknown }>> {
    if (!this.agent.session) {
      throw new Error("Not logged in");
    }

    const response = await this.agent.com.atproto.repo.listRecords({
      repo: this.agent.session.did,
      collection: IDENTIFICATION_COLLECTION,
      limit,
    });

    return response.data.records;
  }

  private validateInput(input: IdentificationInput): void {
    if (!input.occurrenceUri) {
      throw new Error("Occurrence URI is required");
    }

    if (!input.occurrenceCid) {
      throw new Error("Occurrence CID is required");
    }

    if (!input.taxonName || input.taxonName.trim().length === 0) {
      throw new Error("Taxon name is required");
    }

    if (input.taxonName.length > 256) {
      throw new Error("Taxon name too long (max 256 characters)");
    }

    if (input.comment && input.comment.length > 3000) {
      throw new Error("Comment too long (max 3000 characters)");
    }

    // Validate URI format
    if (!input.occurrenceUri.startsWith("at://")) {
      throw new Error("Invalid occurrence URI format");
    }
  }
}

/**
 * UI Component for the Agree/Suggest ID interface
 */
export function createIdentificationUI(
  container: HTMLElement,
  occurrence: {
    uri: string;
    cid: string;
    scientificName: string;
    communityId?: string;
  },
  service: IdentificationService,
  onSuccess?: () => void,
  showToast?: (message: string, type: "success" | "error") => void
): void {
  container.innerHTML = `
    <div class="identification-panel">
      <div class="current-id">
        <span class="label">Community ID:</span>
        <span class="taxon">${occurrence.communityId || occurrence.scientificName}</span>
      </div>

      <div class="id-actions">
        <button class="btn btn-agree" data-action="agree">
          Agree
        </button>
        <button class="btn btn-suggest" data-action="suggest">
          Suggest Different ID
        </button>
      </div>

      <div class="suggest-form hidden">
        <div class="form-group">
          <label for="taxon-input">Scientific Name</label>
          <input type="text" id="taxon-input" placeholder="Enter species name..." />
          <div id="taxon-suggestions"></div>
        </div>
        <div class="form-group">
          <label for="comment-input">Comment (optional)</label>
          <textarea id="comment-input" rows="2"></textarea>
        </div>
        <div class="form-group">
          <label for="confidence-select">Confidence</label>
          <select id="confidence-select">
            <option value="high">High - I'm sure</option>
            <option value="medium" selected>Medium</option>
            <option value="low">Low - Best guess</option>
          </select>
        </div>
        <div class="form-actions">
          <button class="btn btn-cancel" data-action="cancel">Cancel</button>
          <button class="btn btn-submit" data-action="submit">Submit ID</button>
        </div>
      </div>
    </div>
  `;

  // Event handlers
  const agreeBtn = container.querySelector('[data-action="agree"]');
  const suggestBtn = container.querySelector('[data-action="suggest"]');
  const cancelBtn = container.querySelector('[data-action="cancel"]');
  const submitBtn = container.querySelector('[data-action="submit"]');
  const suggestForm = container.querySelector(".suggest-form");

  agreeBtn?.addEventListener("click", async () => {
    try {
      await service.agree(
        occurrence.uri,
        occurrence.cid,
        occurrence.communityId || occurrence.scientificName
      );
      showToast?.("Your agreement has been recorded!", "success");
      onSuccess?.();
    } catch (error) {
      showToast?.(`Error: ${(error as Error).message}`, "error");
    }
  });

  suggestBtn?.addEventListener("click", () => {
    suggestForm?.classList.remove("hidden");
  });

  cancelBtn?.addEventListener("click", () => {
    suggestForm?.classList.add("hidden");
  });

  submitBtn?.addEventListener("click", async () => {
    const taxonInput = container.querySelector("#taxon-input") as HTMLInputElement;
    const commentInput = container.querySelector("#comment-input") as HTMLTextAreaElement;
    const confidenceSelect = container.querySelector("#confidence-select") as HTMLSelectElement;

    if (!taxonInput.value.trim()) {
      showToast?.("Please enter a species name", "error");
      return;
    }

    try {
      await service.suggestId(occurrence.uri, occurrence.cid, taxonInput.value.trim(), {
        comment: commentInput.value.trim() || undefined,
        confidence: confidenceSelect.value as ConfidenceLevel,
      });
      showToast?.("Your identification has been submitted!", "success");
      suggestForm?.classList.add("hidden");
      onSuccess?.();
    } catch (error) {
      showToast?.(`Error: ${(error as Error).message}`, "error");
    }
  });
}

export type { IdentificationInput, IdentificationResult, TaxonRank, ConfidenceLevel };
