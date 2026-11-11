import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  openUploadModal,
  gotoUploadStep,
  revealCoordinateInputs,
  searchTaxa,
} from "./helpers/navigation";
import { mockTaxaSearchRoute } from "./helpers/mock-taxa";
import { exifJpeg } from "./helpers/exif-jpeg";
import { AtpAgent } from "@atproto/api";

async function waitForOccurrenceIndexed(
  request: APIRequestContext,
  uri: string,
  timeoutMs = 30_000,
) {
  const encoded = encodeURIComponent(uri);
  const deadline = Date.now() + timeoutMs;
  let lastStatus: number | null = null;
  while (Date.now() < deadline) {
    const resp = await request.get(`/api/occurrences/${encoded}`);
    lastStatus = resp.status();
    if (lastStatus === 200) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `occurrence ${uri} was not indexed within ${timeoutMs}ms (last status ${lastStatus})`,
  );
}

/**
 * End-to-end CRUD test against a real PDS on a throwaway local ATProto
 * network (@atproto/dev-env), so test records never reach the public firehose.
 *
 * Runs via `npm run test:e2e:devenv` (playwright.devenv.config.ts), which boots
 * the network and the stack and logs in through devenv-auth.setup.ts. Creates
 * real records on the test account's PDS and cleans them up at the end; the
 * create → firehose → tap-ingester → DB round-trip must complete within
 * `waitForOccurrenceIndexed`'s budget. The account is fresh each run, so the
 * `/repos/add` backfill ahead of the live commit is trivially small.
 */
test.describe("E2E CRUD flow", () => {
  // Each test polls the ingester for up to 30s (sometimes twice) on top of
  // PDS writes and page loads, so the 30s default test timeout is too tight.
  test.describe.configure({ timeout: 150_000 });

  let occurrenceUri: string | null = null;

  test("create, identify, and delete an occurrence", async ({ page, request }) => {
    // Step 1: verify signed in by checking the avatar/menu button, which is
    // always visible on `/` unlike `@handle`, which only appears in the
    // closed account-menu popover or on the user's observation cards.
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible({
      timeout: 10_000,
    });

    // Step 2: create occurrence
    await test.step("create occurrence", async () => {
      await mockTaxaSearchRoute(page);
      await openUploadModal(page);
      await gotoUploadStep(page, "Identify");

      const speciesInput = page.getByLabel(/Taxon/i);
      await searchTaxa(speciesInput, "Quercus agrifolia");
      const option = page.locator(".MuiAutocomplete-option").first();
      await expect(option).toBeVisible();
      await option.click();

      await revealCoordinateInputs(page);
      const latInput = page.getByLabel("Latitude");
      await latInput.scrollIntoViewIfNeeded();
      await latInput.fill("37.7749");
      await page.getByLabel("Longitude").fill("-122.4194");

      // Submission is now non-blocking: the modal closes as soon as the PDS
      // write returns and the ingester poll runs in the background behind the
      // TopBar indicator — the app no longer waits for indexing or navigates to
      // the new observation. So capture the create response for the at-uri,
      // assert the modal closed in place, then drive to the detail page once
      // the ingester has indexed it (where the rest of the flow operates).
      const createResp = page.waitForResponse(
        (resp) => resp.request().method() === "POST" && resp.url().includes("/api/occurrences"),
        { timeout: 30_000 },
      );
      await page.getByRole("button", { name: /Submit/i }).click();
      const resp = await createResp;
      expect(resp.ok()).toBeTruthy();
      occurrenceUri = (await resp.json()).uri as string;

      // Modal closes immediately and we stay put (no redirect to /observation).
      await expect(page.getByRole("dialog")).not.toBeVisible({
        timeout: 10_000,
      });

      const match = occurrenceUri.match(/^at:\/\/([^/]+)\/[^/]+\/([^/]+)$/);
      expect(match).toBeTruthy();
      const [, did, rkey] = match!;
      await waitForOccurrenceIndexed(request, occurrenceUri);
      await page.goto(`/observation/${did}/${rkey}`);
    });

    // Step 3: add identification.
    //
    // The `Agree` button only renders once the occurrence row exists in
    // appview's Postgres — i.e. after the firehose → ingester → DB write
    // round-trip completes. Waiting on a button that depends on that
    // pipeline conflates "ingester wrote" with "DOM rerendered," and the
    // single 10s `toBeVisible` was racy under CI load (issue #467).
    //
    // Split the wait: poll the appview API until the occurrence is
    // indexed (generous budget — that's where the real wait lives), then
    // assert button visibility with a tight DOM-only timeout. Next time
    // this flakes, the failure mode tells us which half is slow.
    await test.step("add identification", async () => {
      await waitForOccurrenceIndexed(request, occurrenceUri!);
      const agreeBtn = page.getByRole("button", { name: "Agree" });
      await expect(agreeBtn).toBeVisible({ timeout: 5_000 });
      const idDone = page.waitForResponse(
        (resp) => resp.request().method() === "POST" && resp.url().includes("/api/identifications"),
        { timeout: 15_000 },
      );
      await agreeBtn.click();
      await idDone;
    });

    // Step 4: edit occurrence (PUT /api/occurrences — added in #231)
    await test.step("update occurrence", async () => {
      const moreButton = page.getByLabel("More options").first();
      await expect(moreButton).toBeVisible({ timeout: 10_000 });
      await moreButton.click();
      await page.getByRole("menuitem", { name: "Edit" }).click();
      await expect(page.getByText("Edit Observation")).toBeVisible({
        timeout: 5000,
      });

      // Nudge the latitude to trigger a real edit. The `notes` field was
      // removed from the occurrence schema, and lat/lng are always present
      // on existing records — so this exercises the PUT round-trip without
      // depending on optional fields.
      await revealCoordinateInputs(page);
      const latInput = page.getByLabel("Latitude");
      await latInput.scrollIntoViewIfNeeded();
      await latInput.fill("37.8000");

      const updateDone = page.waitForResponse(
        (resp) => resp.request().method() === "PUT" && resp.url().includes("/api/occurrences"),
        { timeout: 15_000 },
      );
      await page.getByRole("button", { name: "Save Changes" }).click();
      const resp = await updateDone;
      expect(resp.status()).toBe(200);
      await expect(page.getByText("Edit Observation")).not.toBeVisible();
    });

    // Step 5: delete occurrence
    await test.step("delete occurrence", async () => {
      const moreButton = page.getByLabel("More options").first();
      await expect(moreButton).toBeVisible({ timeout: 10_000 });
      await moreButton.click();
      await page.getByRole("menuitem", { name: "Delete" }).click();
      await expect(page.getByText("Delete Observation?")).toBeVisible();

      const deleteDone = page.waitForResponse(
        (resp) => resp.request().method() === "DELETE" && resp.url().includes("/api/occurrences/"),
        { timeout: 15_000 },
      );
      await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
      await deleteDone;
      await page.waitForURL("/", { timeout: 15_000 });
      occurrenceUri = null;
    });
  });

  test("create an observation with a date range and see it rendered as a range", async ({
    page,
    request,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible({
      timeout: 10_000,
    });

    await mockTaxaSearchRoute(page);
    await openUploadModal(page);
    await gotoUploadStep(page, "Identify");

    const speciesInput = page.getByLabel(/Taxon/i);
    await searchTaxa(speciesInput, "Quercus agrifolia");
    const option = page.locator(".MuiAutocomplete-option").first();
    await expect(option).toBeVisible();
    await option.click();

    await revealCoordinateInputs(page);
    const latInput = page.getByLabel("Latitude");
    await latInput.scrollIntoViewIfNeeded();
    await latInput.fill("37.7749");
    await page.getByLabel("Longitude").fill("-122.4194");

    // Set a start date and an end date so the eventDate is written as a
    // `YYYY-MM-DD/YYYY-MM-DD` interval. The start field is labelled
    // "Observation date" until an end date is present. The date inputs live
    // in the Date & details step.
    await gotoUploadStep(page, "Date & details");
    await page.getByLabel("Observation date").fill("2024-05-21T08:00");
    await page.getByLabel("End date (optional)").fill("2024-05-23");

    const createResp = page.waitForResponse(
      (resp) => resp.request().method() === "POST" && resp.url().includes("/api/occurrences"),
      { timeout: 30_000 },
    );
    await page.getByRole("button", { name: /Submit/i }).click();
    const resp = await createResp;
    expect(resp.ok()).toBeTruthy();
    occurrenceUri = (await resp.json()).uri as string;

    const match = occurrenceUri.match(/^at:\/\/([^/]+)\/[^/]+\/([^/]+)$/);
    expect(match).toBeTruthy();
    const [, did, rkey] = match!;
    await waitForOccurrenceIndexed(request, occurrenceUri);
    await page.goto(`/observation/${did}/${rkey}`);

    // The detail view renders the interval as "<start> – <end>" (en dash),
    // not a single instant — proving the range survived create → ingest →
    // display end to end.
    await expect(page.getByText(/May 21, 2024\s*–\s*May 23, 2024/)).toBeVisible({
      timeout: 10_000,
    });
  });

  // Regression test for #1025: an edit used to rebuild the PDS record from the
  // form, dropping fields observ.ing doesn't model (cuanto.bio's eventID),
  // resetting createdAt, and losing the photos the user kept. Reads the record
  // back from the PDS, since the appview's own view shows none of the three.
  test("editing an occurrence keeps unmodeled fields, createdAt, and photos", async ({
    page,
    request,
  }) => {
    const pdsUrl = process.env.DEVENV_PDS_URL;
    const handle = process.env.DEVENV_HANDLE;
    const password = process.env.DEVENV_PASSWORD;
    if (!pdsUrl || !handle || !password) {
      throw new Error("DEVENV_PDS_URL, DEVENV_HANDLE and DEVENV_PASSWORD must be set");
    }
    const agent = new AtpAgent({ service: pdsUrl });
    await agent.login({ identifier: handle, password });

    // Load the app first so page.request carries the session cookie.
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible({
      timeout: 10_000,
    });

    const photo = exifJpeg({
      dateTimeOriginal: "2024:05:21 08:00:00",
      offsetTimeOriginal: "-07:00",
      latitude: 37.7749,
      longitude: -122.4194,
      accuracyMeters: 10,
    });
    const created = await page.request.post("/api/occurrences", {
      data: {
        latitude: 37.7749,
        longitude: -122.4194,
        eventDate: "2024-05-21",
        images: [{ data: photo.toString("base64"), mimeType: "image/jpeg" }],
      },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    occurrenceUri = (await created.json()).uri as string;
    const match = occurrenceUri.match(/^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/);
    expect(match).toBeTruthy();
    const [, repo, collection, rkey] = match!;
    await waitForOccurrenceIndexed(request, occurrenceUri);

    // Add what another app would have written: a Darwin Core term the
    // lexicon doesn't define, and a createdAt that isn't the edit time.
    const original = await agent.com.atproto.repo.getRecord({ repo, collection, rkey });
    const originalRecord = original.data.value as Record<string, unknown>;
    expect(originalRecord.media).toHaveLength(1);
    const createdAt = "2024-05-21T15:00:00.000Z";
    await agent.com.atproto.repo.putRecord({
      repo,
      collection,
      rkey,
      record: { ...originalRecord, eventID: "cuanto-event-42", createdAt },
      swapRecord: original.data.cid,
    });

    // Move the point and keep the photo, as the edit form does.
    const detail = await page.request.get(`/api/occurrences/${encodeURIComponent(occurrenceUri)}`);
    expect(detail.ok()).toBeTruthy();
    const images = (await detail.json()).occurrence.images as { url: string }[];
    expect(images).toHaveLength(1);
    const edited = await page.request.put("/api/occurrences", {
      data: {
        uri: occurrenceUri,
        latitude: 37.8,
        longitude: -122.4194,
        eventDate: "2024-05-21",
        retainedBlobCids: images.map((img) => img.url.split("/").at(-1)),
      },
    });
    expect(edited.status(), await edited.text()).toBe(200);

    const after = await agent.com.atproto.repo.getRecord({ repo, collection, rkey });
    const record = after.data.value as Record<string, unknown>;
    expect(record.decimalLatitude).toBe("37.8");
    expect(record.eventID).toBe("cuanto-event-42");
    expect(record.createdAt).toBe(createdAt);
    expect(record.media).toEqual(originalRecord.media);
  });

  test.afterEach(async ({ page }) => {
    // Clean up if the test failed before the delete step
    if (occurrenceUri) {
      await page.request
        .delete(`http://127.0.0.1:3000/api/occurrences/${encodeURIComponent(occurrenceUri)}`)
        .catch(() => {});
      occurrenceUri = null;
    }
  });
});
