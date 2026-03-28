use serde::Serialize;
use ts_rs::TS;

/// Response returned when an AT Protocol record is created.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings/")]
pub struct RecordCreatedResponse {
    pub success: bool,
    pub uri: String,
    pub cid: String,
}

/// Simple success/failure response with no additional payload.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "bindings/")]
pub struct SuccessResponse {
    pub success: bool,
}
