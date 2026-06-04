//! Canonical AT Protocol collection NSIDs ingested by observ.ing.
//!
//! Each constant is derived from the generated lexicon record type's
//! [`Collection::NSID`], so it cannot drift from the schema — renaming a
//! collection in the lexicons regenerates `observing-lexicons` and these
//! constants follow automatically.
//!
//! They are used both as Tap collection-filters and as dispatch keys when
//! routing firehose records to per-collection handlers.

use jacquard_common::types::collection::Collection;
use observing_lexicons::bio_lexicons::temp::v0_1::{
    identification::IdentificationRecord, occurrence::OccurrenceRecord,
};
use observing_lexicons::ing_observ::temp::{
    comment::CommentRecord, interaction::InteractionRecord, like::LikeRecord,
};

/// `bio.lexicons.temp.v0-1.occurrence`
pub const OCCURRENCE_COLLECTION: &str = OccurrenceRecord::NSID;
/// `bio.lexicons.temp.v0-1.identification`
pub const IDENTIFICATION_COLLECTION: &str = IdentificationRecord::NSID;
/// `ing.observ.temp.comment`
pub const COMMENT_COLLECTION: &str = CommentRecord::NSID;
/// `ing.observ.temp.interaction`
pub const INTERACTION_COLLECTION: &str = InteractionRecord::NSID;
/// `ing.observ.temp.like`
pub const LIKE_COLLECTION: &str = LikeRecord::NSID;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nsids_match_lexicon_schemas() {
        assert_eq!(OCCURRENCE_COLLECTION, "bio.lexicons.temp.v0-1.occurrence");
        assert_eq!(
            IDENTIFICATION_COLLECTION,
            "bio.lexicons.temp.v0-1.identification"
        );
        assert_eq!(COMMENT_COLLECTION, "ing.observ.temp.comment");
        assert_eq!(INTERACTION_COLLECTION, "ing.observ.temp.interaction");
        assert_eq!(LIKE_COLLECTION, "ing.observ.temp.like");
    }
}
