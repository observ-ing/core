use std::collections::HashMap;
use std::sync::Arc;

use atproto_identity::Profile;
use axum::extract::{Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use crate::auth::AuthUser;
use crate::constants;
use crate::error::{AppError, ErrorResponse};
use crate::responses::{SuccessResponse, UnreadCountResponse};
use crate::state::AppState;

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct ListParams {
    /// Page size. Values above 50 are clamped.
    #[param(default = json!(constants::DEFAULT_NOTIFICATION_LIMIT))]
    limit: Option<i64>,
    /// `cursor` from the previous page.
    cursor: Option<String>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as = Notification)]
pub struct NotificationResponse {
    id: i64,
    /// DID of the user whose action triggered the notification.
    actor_did: String,
    /// `identification`, `comment`, or `like`.
    kind: String,
    /// AT URI of the viewer's occurrence that was acted on.
    subject_uri: String,
    /// AT URI of the identification, comment, or like record.
    #[serde(skip_serializing_if = "Option::is_none")]
    reference_uri: Option<String>,
    read: bool,
    created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    actor: Option<ActorProfile>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
struct ActorProfile {
    did: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    handle: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    avatar: Option<String>,
}

fn actor_from_profile(did: &str, profiles: &HashMap<String, Arc<Profile>>) -> Option<ActorProfile> {
    profiles.get(did).map(|p| ActorProfile {
        did: p.did.clone(),
        handle: Some(p.handle.clone()),
        display_name: p.display_name.clone(),
        avatar: p.avatar.clone(),
    })
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NotificationListResponse {
    notifications: Vec<NotificationResponse>,
    cursor: Option<String>,
}

/// List the viewer's notifications.
///
/// Newest first.
#[utoipa::path(
    get,
    path = "/api/notifications",
    operation_id = "list_notifications",
    tag = "notifications",
    params(ListParams),
    security(("session" = [])),
    responses(
        (status = 200, description = "A page of notifications", body = NotificationListResponse),
        (status = 401, description = "Not signed in", body = ErrorResponse),
    )
)]
pub async fn list(
    State(state): State<AppState>,
    user: AuthUser,
    Query(params): Query<ListParams>,
) -> Result<Json<NotificationListResponse>, AppError> {
    let limit = params
        .limit
        .unwrap_or(constants::DEFAULT_NOTIFICATION_LIMIT)
        .min(constants::MAX_NOTIFICATION_LIMIT);
    let cursor = params.cursor.and_then(|c| c.parse::<i64>().ok());

    let rows = observing_db::notifications::list(&state.pool, &user.did, limit, cursor).await?;

    // Resolve actor profiles
    let actor_dids: Vec<String> = rows.iter().map(|r| r.actor_did.clone()).collect();
    let profiles = state.resolver.get_profiles(&actor_dids).await;

    let notifications: Vec<NotificationResponse> = rows
        .iter()
        .map(|r| NotificationResponse {
            id: r.id,
            actor_did: r.actor_did.clone(),
            kind: r.kind.clone(),
            subject_uri: r.subject_uri.clone(),
            reference_uri: r.reference_uri.clone(),
            read: r.read,
            created_at: r.created_at.to_rfc3339(),
            actor: actor_from_profile(&r.actor_did, &profiles),
        })
        .collect();

    let next_cursor = rows.last().map(|r| r.id.to_string());

    Ok(Json(NotificationListResponse {
        notifications,
        cursor: next_cursor,
    }))
}

/// Count the viewer's unread notifications.
#[utoipa::path(
    get,
    path = "/api/notifications/unread-count",
    operation_id = "get_unread_notification_count",
    tag = "notifications",
    security(("session" = [])),
    responses(
        (status = 200, description = "The unread count", body = UnreadCountResponse),
        (status = 401, description = "Not signed in", body = ErrorResponse),
    )
)]
pub async fn unread_count(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<Json<UnreadCountResponse>, AppError> {
    let count = observing_db::notifications::unread_count(&state.pool, &user.did).await?;

    Ok(Json(UnreadCountResponse { count }))
}

#[derive(Deserialize, ToSchema)]
pub struct MarkReadBody {
    /// The notification to mark read. Omit to mark all of them read.
    id: Option<i64>,
}

/// Mark notifications read.
#[utoipa::path(
    post,
    path = "/api/notifications/read",
    operation_id = "mark_notifications_read",
    tag = "notifications",
    request_body = MarkReadBody,
    security(("session" = [])),
    responses(
        (status = 200, description = "The notifications were marked read", body = SuccessResponse),
        (status = 401, description = "Not signed in", body = ErrorResponse),
    )
)]
pub async fn mark_read(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<MarkReadBody>,
) -> Result<Json<SuccessResponse>, AppError> {
    if let Some(id) = body.id {
        observing_db::notifications::mark_read(&state.pool, &user.did, id).await?;
    } else {
        observing_db::notifications::mark_all_read(&state.pool, &user.did).await?;
    }

    Ok(Json(SuccessResponse { success: true }))
}
