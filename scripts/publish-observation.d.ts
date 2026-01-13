/**
 * Script to publish a net.inat.observation record to a PDS
 *
 * Usage:
 *   PDS_URL=http://localhost:2583 \
 *   HANDLE=test.local \
 *   PASSWORD=password \
 *   tsx scripts/publish-observation.ts
 *
 * Or with Bluesky:
 *   PDS_URL=https://bsky.social \
 *   HANDLE=yourhandle.bsky.social \
 *   PASSWORD=your-app-password \
 *   tsx scripts/publish-observation.ts
 */
import { AtpAgent } from "@atproto/api";
import type { ObservationInput } from "../src/generated/types.js";
interface PublishResult {
    uri: string;
    cid: string;
}
declare function createAgent(): Promise<AtpAgent>;
declare function publishObservation(agent: AtpAgent, observation: ObservationInput): Promise<PublishResult>;
export { createAgent, publishObservation };
//# sourceMappingURL=publish-observation.d.ts.map