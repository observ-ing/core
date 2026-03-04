use std::collections::HashMap;
use std::sync::Arc;

use atproto_identity::Profile;
use axum::extract::{Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::state::AppState;

#[derive(Deserialize)]
pub struct ListParams {
    limit: Option<i64>,
    cursor: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NotificationResponse {
    id: i64,
    actor_did: String,
    kind: String,
    subject_uri: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    reference_uri: Option<String>,
    read: bool,
    created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    actor: Option<ActorProfile>,
}

#[derive(Serialize)]
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

pub async fn list(
    State(state): State<AppState>,
    user: AuthUser,
    Query(params): Query<ListParams>,
) -> Result<Json<Value>, AppError> {
    let limit = params.limit.unwrap_or(20).min(50);
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

    Ok(Json(json!({
        "notifications": notifications,
        "cursor": next_cursor,
    })))
}

pub async fn unread_count(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<Json<Value>, AppError> {
    let count = observing_db::notifications::unread_count(&state.pool, &user.did).await?;

    Ok(Json(json!({ "count": count })))
}

#[derive(Deserialize)]
pub struct MarkReadBody {
    id: Option<i64>,
}

pub async fn mark_read(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<MarkReadBody>,
) -> Result<Json<Value>, AppError> {
    if let Some(id) = body.id {
        observing_db::notifications::mark_read(&state.pool, &user.did, id).await?;
    } else {
        observing_db::notifications::mark_all_read(&state.pool, &user.did).await?;
    }

    Ok(Json(json!({ "success": true })))
}
