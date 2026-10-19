//! Deterministic iNaturalist UUIDs for cross-posted records.
//!
//! iNaturalist upserts on a client-supplied UUID, so deriving it from the
//! occurrence means posting the same occurrence twice (a retry, a second
//! click, two workers) lands on one observation instead of making a duplicate.
//!
//! **This derivation is a wire contract.** Observations on iNaturalist carry
//! these UUIDs, so changing the namespace or the name format would orphan every
//! one of them. The golden-value tests below are the tripwire.

use uuid::Uuid;

/// Private namespace, so nothing else hashing the same names can collide.
const NAMESPACE: Uuid = Uuid::from_u128(0x23394630_f8ca_479a_bd04_38f6100d6602);

/// UUID of the iNaturalist observation for an occurrence.
///
/// Named by DID and record key rather than the full AT URI: the collection
/// NSID is provisional, and renaming it must not re-mint every UUID.
pub fn observation_uuid(did: &str, rkey: &str) -> Uuid {
    Uuid::new_v5(&NAMESPACE, format!("{did}/{rkey}").as_bytes())
}

/// UUID of the iNaturalist observation photo for one of an occurrence's blobs.
///
/// Scoped to the occurrence because blob CIDs are content-addressed: the same
/// photo on two occurrences must be two observation photos.
pub fn photo_uuid(did: &str, rkey: &str, blob_cid: &str) -> Uuid {
    Uuid::new_v5(&NAMESPACE, format!("{did}/{rkey}#{blob_cid}").as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    const DID: &str = "did:plc:abc123";
    const RKEY: &str = "3kfixedrkey22";

    #[test]
    fn observation_uuid_is_frozen() {
        assert_eq!(
            observation_uuid(DID, RKEY).to_string(),
            "d299fbc7-b190-514c-b7da-44d0f1bc5aab"
        );
    }

    #[test]
    fn photo_uuid_is_frozen() {
        assert_eq!(
            photo_uuid(DID, RKEY, "bafkreiphotoone").to_string(),
            "a5d9614a-e8fc-5014-88e7-edf4c513a582"
        );
    }

    #[test]
    fn the_same_blob_on_two_occurrences_gets_two_photo_uuids() {
        assert_ne!(
            photo_uuid(DID, RKEY, "bafkreiphotoone"),
            photo_uuid(DID, "3kotherrkey222", "bafkreiphotoone")
        );
    }

    #[test]
    fn a_photo_never_shares_its_observations_uuid() {
        assert_ne!(observation_uuid(DID, RKEY), photo_uuid(DID, RKEY, ""));
    }
}
