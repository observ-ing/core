use std::str::FromStr;

use axum::extract::{FromRef, FromRequestParts};
use axum::http::header::AUTHORIZATION;
use axum::http::request::Parts;
use axum::http::HeaderMap;
use axum_extra::extract::CookieJar;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use jacquard_common::types::collection::Collection;
use jacquard_common::types::string::{AtUri, Cid};
use observing_lexicons::com_atproto::repo::strong_ref::StrongRef;
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::postgres::PgPool;

use crate::error::AppError;
use crate::state::{AgentType, OAuthClientType};

/// Name of the cookie holding the session token. Renamed from `session_did`
/// when that cookie (which held a bare DID) was retired, so no old cookie is
/// ever read as a token.
pub const SESSION_COOKIE: &str = "session";

/// The retired cookie that held the signed-in DID. Never read; only cleared.
pub const LEGACY_SESSION_COOKIE: &str = "session_did";

/// How long a sign-in lasts, for both the cookie and the server-side session.
pub const SESSION_MAX_AGE_SECS: i64 = 14 * 24 * 60 * 60;

/// Bytes of CSPRNG output in a session token (before base64url encoding).
const SESSION_TOKEN_BYTES: usize = 32;

/// User information extracted from session
#[derive(Debug, Clone)]
pub struct AuthUser {
    pub did: String,
}

/// Axum extractor that validates the session token (cookie or `Authorization:
/// Bearer`) and returns an [`AuthUser`].
///
/// Use this as a handler parameter to require authentication:
///
/// ```ignore
/// async fn my_handler(user: AuthUser, ...) -> Result<..., AppError> { ... }
/// ```
impl<S> FromRequestParts<S> for AuthUser
where
    PgPool: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let pool = PgPool::from_ref(state);
        require_auth(&pool, &parts.headers)
            .await
            .map_err(|_| AppError::Unauthorized)
    }
}

/// A new random session token: 32 bytes from the OS CSPRNG, base64url
/// encoded without padding.
pub fn new_session_token() -> String {
    let mut bytes = [0u8; SESSION_TOKEN_BYTES];
    getrandom::fill(&mut bytes).expect("OS random number generator failed");
    URL_SAFE_NO_PAD.encode(bytes)
}

/// SHA-256 of a session token: the only form of it the database stores.
pub fn hash_session_token(token: &str) -> [u8; 32] {
    Sha256::digest(token.as_bytes()).into()
}

/// Start a session for `did`, returning the token to hand to the client.
pub async fn create_session(pool: &PgPool, did: &str) -> Result<String, sqlx::Error> {
    let token = new_session_token();
    let expires_at = chrono::Utc::now() + chrono::Duration::seconds(SESSION_MAX_AGE_SECS);
    observing_db::app_sessions::create(pool, &hash_session_token(&token), did, expires_at).await?;
    // Opportunistic cleanup; a failure here doesn't affect the new session.
    if let Err(e) = observing_db::app_sessions::delete_expired(pool).await {
        tracing::warn!(error = %e, "Failed to delete expired sessions");
    }
    Ok(token)
}

/// End the session named by the request's token, if any. Returns the DID it
/// was signed in as when a session was deleted.
pub async fn end_session(
    pool: &PgPool,
    headers: &HeaderMap,
) -> Result<Option<String>, sqlx::Error> {
    let Some(token) = session_token(headers) else {
        return Ok(None);
    };
    observing_db::app_sessions::delete(pool, &hash_session_token(&token)).await
}

/// The session token a request presents: the `Authorization: Bearer` header
/// if there is one (native clients send no cookies), else the session cookie.
pub fn session_token(headers: &HeaderMap) -> Option<String> {
    if let Some(value) = headers.get(AUTHORIZATION) {
        let token = value
            .to_str()
            .ok()
            .and_then(|v| v.strip_prefix("Bearer "))
            .map(str::trim)
            .filter(|t| !t.is_empty());
        // An Authorization header that isn't a usable Bearer token is not
        // silently replaced by a cookie.
        return token.map(str::to_string);
    }
    CookieJar::from_headers(headers)
        .get(SESSION_COOKIE)
        .map(|c| c.value().to_string())
        .filter(|t| !t.is_empty())
}

/// The DID signed in by the request's session token, or `None` when there is
/// no token or it doesn't name a live session. Used for optional auth in read
/// endpoints.
pub async fn session_did(pool: &PgPool, headers: &HeaderMap) -> Option<String> {
    let token = session_token(headers)?;
    match observing_db::app_sessions::lookup(pool, &hash_session_token(&token)).await {
        Ok(did) => did,
        Err(e) => {
            tracing::warn!(error = %e, "Session lookup failed");
            None
        }
    }
}

/// Validate the request's session and return the signed-in user (used for
/// required auth in write endpoints). Also requires that the user's atproto
/// OAuth session still exists, since writes go to their PDS.
pub async fn require_auth(pool: &PgPool, headers: &HeaderMap) -> Result<AuthUser, ()> {
    let did = session_did(pool, headers).await.ok_or(())?;

    let oauth_session = observing_db::oauth::get_session(pool, &did)
        .await
        .ok()
        .flatten();
    if oauth_session.is_none() {
        return Err(());
    }

    Ok(AuthUser { did })
}

/// `Set-Cookie` value carrying a new session token.
///
/// SameSite=None lets the cookie be sent on cross-site requests, which is
/// required when the Capacitor mobile app (origin https://localhost) calls
/// the appview at observ.ing. Browsers require Secure for SameSite=None, so
/// both are set only when serving over HTTPS (`secure`). In local dev both
/// are omitted and the browser treats the cookie as default Lax, which is
/// fine for same-origin use.
pub fn session_cookie(token: &str, secure: bool) -> String {
    format!(
        "{SESSION_COOKIE}={token}; HttpOnly; Path=/; Max-Age={SESSION_MAX_AGE_SECS}{}",
        cookie_attrs(secure)
    )
}

/// `Set-Cookie` value that clears the cookie `name`.
pub fn clear_cookie(name: &str, secure: bool) -> String {
    format!(
        "{name}=; HttpOnly; Path=/; Max-Age=0{}",
        cookie_attrs(secure)
    )
}

fn cookie_attrs(secure: bool) -> &'static str {
    if secure {
        "; Secure; SameSite=None"
    } else {
        ""
    }
}

/// Build a `StrongRef` from raw URI and CID strings, returning a user-facing
/// error when either value fails to parse.
pub fn build_strong_ref(uri: &str, cid: &str) -> Result<StrongRef, AppError> {
    Ok(StrongRef::new()
        .uri(AtUri::from_str(uri).map_err(|_| AppError::BadRequest("Invalid AT URI".into()))?)
        .cid(Cid::from_str(cid).map_err(|_| AppError::BadRequest("Invalid CID".into()))?)
        .build())
}

/// Parse the `collection` and `rkey` segments of a parsed [`AtUri`] into the
/// strongly-typed atproto values needed for repo `deleteRecord` / `putRecord`
/// calls, wrapping parse failures in a consistent `AppError`.
pub fn parse_collection_and_rkey(
    at_uri: &AtUri,
) -> Result<
    (
        atrium_api::types::string::Nsid,
        atrium_api::types::string::RecordKey,
    ),
    AppError,
> {
    let collection = at_uri
        .collection()
        .ok_or_else(|| AppError::Internal("AT URI missing collection".into()))?
        .as_str()
        .parse()
        .map_err(|e| AppError::Internal(format!("Invalid collection: {e}")))?;
    let rkey = at_uri
        .rkey()
        .ok_or_else(|| AppError::Internal("AT URI missing rkey".into()))?
        .as_str()
        .parse()
        .map_err(|e| AppError::Internal(format!("Invalid rkey: {e}")))?;
    Ok((collection, rkey))
}

/// Restore an OAuth session and return an AT Protocol agent for the given DID.
pub async fn require_agent(
    oauth_client: &OAuthClientType,
    did: &str,
) -> Result<(AgentType, atrium_api::types::string::Did), AppError> {
    let did_parsed = atrium_api::types::string::Did::new(did.to_string())
        .map_err(|e| AppError::Internal(format!("Invalid DID: {e}")))?;
    let session = oauth_client.restore(&did_parsed).await.map_err(|e| {
        tracing::warn!(error = %e, "Failed to restore OAuth session");
        AppError::Unauthorized
    })?;
    let agent = atrium_api::agent::Agent::new(session);
    Ok((agent, did_parsed))
}

/// Serialize a lexicon record to a [`serde_json::Value`] with the `$type` field set.
pub fn serialize_at_record<T: Collection + serde::Serialize>(
    record: &T,
) -> Result<Value, AppError> {
    let mut value = serde_json::to_value(record).map_err(|e| AppError::Internal(e.to_string()))?;
    value["$type"] = serde_json::json!(T::NSID);
    Ok(value)
}

/// Create an AT Protocol record via the PDS agent.
///
/// Handles NSID parsing, record serialization, and maps authentication errors
/// to `AppError::Unauthorized` and other errors to `AppError::Internal`.
pub async fn create_at_record(
    agent: &AgentType,
    did: atrium_api::types::string::Did,
    nsid: &str,
    record_value: Value,
) -> Result<atrium_api::com::atproto::repo::create_record::Output, AppError> {
    create_at_record_with_rkey(agent, did, nsid, None, record_value).await
}

/// [`create_at_record`] with a caller-chosen record key. Used when a record's
/// URI must be known before it exists — e.g. so a remark written first can
/// name the occurrence that will reference it.
pub async fn create_at_record_with_rkey(
    agent: &AgentType,
    did: atrium_api::types::string::Did,
    nsid: &str,
    rkey: Option<&str>,
    record_value: Value,
) -> Result<atrium_api::com::atproto::repo::create_record::Output, AppError> {
    let rkey = rkey
        .map(|k| {
            k.parse()
                .map_err(|e| AppError::Internal(format!("Invalid rkey: {e}")))
        })
        .transpose()?;
    agent
        .api
        .com
        .atproto
        .repo
        .create_record(
            atrium_api::com::atproto::repo::create_record::InputData {
                collection: nsid
                    .parse()
                    .map_err(|e| AppError::Internal(format!("Invalid NSID: {e}")))?,
                record: serde_json::from_value(record_value)
                    .map_err(|e| AppError::Internal(format!("Failed to convert record: {e}")))?,
                repo: atrium_api::types::string::AtIdentifier::Did(did),
                rkey,
                swap_commit: None,
                validate: None,
            }
            .into(),
        )
        .await
        .map_err(|e| map_xrpc_error(e, "create"))
}

/// Fetch the record at `at_uri` via `getRecord`, with its CID.
pub async fn get_at_record(
    agent: &AgentType,
    did: atrium_api::types::string::Did,
    at_uri: &AtUri,
) -> Result<(Value, Option<atrium_api::types::string::Cid>), AppError> {
    let (collection, rkey) = parse_collection_and_rkey(at_uri)?;
    let output = agent
        .api
        .com
        .atproto
        .repo
        .get_record(
            atrium_api::com::atproto::repo::get_record::ParametersData {
                cid: None,
                collection,
                repo: atrium_api::types::string::AtIdentifier::Did(did),
                rkey,
            }
            .into(),
        )
        .await
        .map_err(|e| map_xrpc_error(e, "fetch"))?;
    let value = serde_json::to_value(&output.value)
        .map_err(|e| AppError::Internal(format!("Failed to serialize record: {e}")))?;
    Ok((value, output.cid.clone()))
}

/// Replace the record at `at_uri` via `putRecord`. With a `swap_record`, the
/// write fails unless that is still the record's CID, so a change made since
/// it was fetched is not overwritten.
pub async fn put_at_record(
    agent: &AgentType,
    did: atrium_api::types::string::Did,
    at_uri: &AtUri,
    record_value: Value,
    swap_record: Option<atrium_api::types::string::Cid>,
) -> Result<atrium_api::com::atproto::repo::put_record::Output, AppError> {
    let (collection, rkey) = parse_collection_and_rkey(at_uri)?;
    agent
        .api
        .com
        .atproto
        .repo
        .put_record(
            atrium_api::com::atproto::repo::put_record::InputData {
                collection,
                record: serde_json::from_value(record_value)
                    .map_err(|e| AppError::Internal(format!("Failed to convert record: {e}")))?,
                repo: atrium_api::types::string::AtIdentifier::Did(did),
                rkey,
                swap_commit: None,
                swap_record,
                validate: None,
            }
            .into(),
        )
        .await
        .map_err(map_put_error)
}

/// Delete the record at `at_uri` via `deleteRecord`.
pub async fn delete_at_record(
    agent: &AgentType,
    did: atrium_api::types::string::Did,
    at_uri: &AtUri,
) -> Result<(), AppError> {
    let (collection, rkey) = parse_collection_and_rkey(at_uri)?;
    agent
        .api
        .com
        .atproto
        .repo
        .delete_record(
            atrium_api::com::atproto::repo::delete_record::InputData {
                collection,
                repo: atrium_api::types::string::AtIdentifier::Did(did),
                rkey,
                swap_commit: None,
                swap_record: None,
            }
            .into(),
        )
        .await
        .map_err(|e| map_xrpc_error(e, "delete"))?;
    Ok(())
}

/// Map a PDS write error: an expired session becomes `Unauthorized` (so the
/// client re-authenticates), anything else an `Internal` naming the verb.
fn map_xrpc_error<E: std::fmt::Debug + std::fmt::Display>(
    e: atrium_api::xrpc::Error<E>,
    verb: &str,
) -> AppError {
    if matches!(e, atrium_api::xrpc::Error::Authentication(_)) {
        tracing::warn!(error = %e, "AT Protocol authentication failed (session expired)");
        AppError::Unauthorized
    } else {
        AppError::Internal(format!("Failed to {verb} record: {e}"))
    }
}

/// Map a `putRecord` error. A lost `swap_record` (the record changed since it
/// was fetched) is a `Conflict` the caller can retry after reloading; anything
/// else maps as any other PDS write error.
fn map_put_error(
    e: atrium_api::xrpc::Error<atrium_api::com::atproto::repo::put_record::Error>,
) -> AppError {
    use atrium_api::com::atproto::repo::put_record::Error::InvalidSwap;
    use atrium_api::xrpc::error::XrpcErrorKind;

    if let atrium_api::xrpc::Error::XrpcResponse(ref response) = e {
        if let Some(XrpcErrorKind::Custom(InvalidSwap(_))) = response.error {
            tracing::info!(error = %e, "putRecord lost its swap: the record changed");
            return AppError::Conflict(
                "This record changed while you were editing it. Reload and try again.".into(),
            );
        }
    }
    map_xrpc_error(e, "put")
}

#[cfg(test)]
mod tests {
    use super::*;
    use atrium_api::com::atproto::repo::put_record;
    use atrium_api::xrpc::error::{XrpcError, XrpcErrorKind};
    use atrium_api::xrpc::http::StatusCode;

    fn put_error(
        error: Option<XrpcErrorKind<put_record::Error>>,
    ) -> atrium_api::xrpc::Error<put_record::Error> {
        atrium_api::xrpc::Error::XrpcResponse(XrpcError {
            status: StatusCode::BAD_REQUEST,
            error,
        })
    }

    /// A swap that no longer matches means the record changed after it was
    /// fetched; the caller should reload, not see a server error.
    #[test]
    fn a_put_whose_swap_no_longer_matches_is_a_conflict() {
        let e = put_error(Some(XrpcErrorKind::Custom(put_record::Error::InvalidSwap(
            Some("Record was at bafyother".into()),
        ))));

        assert!(matches!(map_put_error(e), AppError::Conflict(_)));
    }

    #[test]
    fn other_put_failures_stay_internal() {
        assert!(matches!(
            map_put_error(put_error(None)),
            AppError::Internal(_)
        ));
    }
}

/// Session-token auth against a real database (opt-in via
/// `TEST_DATABASE_URL`; see [`crate::test_db`]).
#[cfg(test)]
mod session_tests {
    use super::*;
    use crate::test_db;
    use axum::body::Body;
    use axum::http::{header, Request, StatusCode};
    use axum::routing::get;
    use axum::Router;
    use tower::ServiceExt;

    const ALICE: &str = "did:plc:alice";

    async fn whoami(user: AuthUser) -> String {
        user.did
    }

    /// A signed-in user: an atproto OAuth session (as atrium stores it after
    /// the callback) plus an appview session. Returns the session token.
    async fn sign_in(pool: &PgPool, did: &str) -> String {
        observing_db::oauth::set_session(pool, did, "{}")
            .await
            .unwrap();
        create_session(pool, did).await.unwrap()
    }

    /// Call a route that requires auth, sending `header` as given.
    async fn call(pool: &PgPool, header: Option<(header::HeaderName, String)>) -> StatusCode {
        let app = Router::new()
            .route("/whoami", get(whoami))
            .with_state(pool.clone());
        let mut req = Request::get("/whoami");
        if let Some((name, value)) = header {
            req = req.header(name, value);
        }
        let res = app.oneshot(req.body(Body::empty()).unwrap()).await.unwrap();
        let status = res.status();
        if status == StatusCode::OK {
            let body = axum::body::to_bytes(res.into_body(), 1024).await.unwrap();
            assert_eq!(body, ALICE, "signed in as the session's DID");
        }
        status
    }

    fn cookie(name: &str, value: &str) -> Option<(header::HeaderName, String)> {
        Some((header::COOKIE, format!("{name}={value}")))
    }

    fn bearer(value: &str) -> Option<(header::HeaderName, String)> {
        Some((header::AUTHORIZATION, format!("Bearer {value}")))
    }

    #[tokio::test]
    async fn a_valid_token_signs_in_by_cookie_or_bearer() {
        let Some(db) = test_db::scratch().await else {
            return;
        };
        let token = sign_in(&db.pool, ALICE).await;

        assert_eq!(
            call(&db.pool, cookie(SESSION_COOKIE, &token)).await,
            StatusCode::OK
        );
        assert_eq!(call(&db.pool, bearer(&token)).await, StatusCode::OK);

        let mut headers = HeaderMap::new();
        headers.insert(AUTHORIZATION, format!("Bearer {token}").parse().unwrap());
        assert_eq!(
            session_did(&db.pool, &headers).await.as_deref(),
            Some(ALICE)
        );
        db.drop().await;
    }

    /// Regression test for the session-forgery bypass: a signed-in user's DID
    /// is public, so presenting it in place of a token must not sign anyone in,
    /// whether in the new cookie, the retired `session_did` cookie, or a
    /// Bearer header.
    #[tokio::test]
    async fn a_signed_in_users_did_is_not_a_session() {
        let Some(db) = test_db::scratch().await else {
            return;
        };
        sign_in(&db.pool, ALICE).await;

        for header in [
            cookie(SESSION_COOKIE, ALICE),
            cookie(LEGACY_SESSION_COOKIE, ALICE),
            bearer(ALICE),
        ] {
            let sent = header.clone();
            assert_eq!(
                call(&db.pool, header).await,
                StatusCode::UNAUTHORIZED,
                "{sent:?}"
            );
        }

        let mut headers = HeaderMap::new();
        headers.insert(
            header::COOKIE,
            format!("{LEGACY_SESSION_COOKIE}={ALICE}").parse().unwrap(),
        );
        assert_eq!(
            session_did(&db.pool, &headers).await,
            None,
            "optional auth too"
        );
        db.drop().await;
    }

    #[tokio::test]
    async fn unknown_expired_and_signed_out_tokens_are_rejected() {
        let Some(db) = test_db::scratch().await else {
            return;
        };
        let token = sign_in(&db.pool, ALICE).await;

        assert_eq!(call(&db.pool, None).await, StatusCode::UNAUTHORIZED);
        let unknown = new_session_token();
        assert_eq!(
            call(&db.pool, cookie(SESSION_COOKIE, &unknown)).await,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            call(&db.pool, bearer(&unknown)).await,
            StatusCode::UNAUTHORIZED
        );

        let expired = new_session_token();
        observing_db::app_sessions::create(
            &db.pool,
            &hash_session_token(&expired),
            ALICE,
            chrono::Utc::now() - chrono::Duration::seconds(1),
        )
        .await
        .unwrap();
        assert_eq!(
            call(&db.pool, cookie(SESSION_COOKIE, &expired)).await,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            call(&db.pool, bearer(&expired)).await,
            StatusCode::UNAUTHORIZED
        );

        let mut headers = HeaderMap::new();
        headers.insert(
            header::COOKIE,
            format!("{SESSION_COOKIE}={token}").parse().unwrap(),
        );
        assert_eq!(
            end_session(&db.pool, &headers).await.unwrap().as_deref(),
            Some(ALICE)
        );
        assert_eq!(
            call(&db.pool, cookie(SESSION_COOKIE, &token)).await,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            call(&db.pool, bearer(&token)).await,
            StatusCode::UNAUTHORIZED
        );
        db.drop().await;
    }

    #[tokio::test]
    async fn logout_deletes_the_session_row() {
        let Some(db) = test_db::scratch().await else {
            return;
        };
        let token = sign_in(&db.pool, ALICE).await;
        let other = create_session(&db.pool, ALICE).await.unwrap();
        let count = || async {
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM appview.app_sessions")
                .fetch_one(&db.pool)
                .await
                .unwrap()
        };
        assert_eq!(count().await, 2);

        let mut headers = HeaderMap::new();
        headers.insert(AUTHORIZATION, format!("Bearer {token}").parse().unwrap());
        end_session(&db.pool, &headers).await.unwrap();

        assert_eq!(count().await, 1, "only the presented session is deleted");
        assert_eq!(call(&db.pool, bearer(&other)).await, StatusCode::OK);
        db.drop().await;
    }

    #[tokio::test]
    async fn sign_in_stores_the_tokens_hash_not_the_token() {
        let Some(db) = test_db::scratch().await else {
            return;
        };
        let token = create_session(&db.pool, ALICE).await.unwrap();
        assert_eq!(
            URL_SAFE_NO_PAD.decode(&token).unwrap().len(),
            32,
            "32 random bytes, base64url"
        );

        let (stored, did, lifetime): (Vec<u8>, String, f64) = sqlx::query_as(
            "SELECT token_hash, did, EXTRACT(EPOCH FROM expires_at - created_at)::float8
             FROM appview.app_sessions",
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(stored, hash_session_token(&token));
        assert_ne!(stored, token.as_bytes());
        assert_eq!(did, ALICE);
        assert!((lifetime - SESSION_MAX_AGE_SECS as f64).abs() < 60.0);

        let found: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM appview.app_sessions t WHERE t::text LIKE '%' || $1 || '%')",
        )
        .bind(&token)
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert!(!found, "the raw token appears nowhere in the table");
        db.drop().await;
    }

    #[test]
    fn tokens_are_random_and_the_cookie_carries_them() {
        assert_ne!(new_session_token(), new_session_token());
        let cookie = session_cookie("tok", true);
        assert_eq!(
            cookie,
            format!("session=tok; HttpOnly; Path=/; Max-Age={SESSION_MAX_AGE_SECS}; Secure; SameSite=None")
        );
        assert!(!session_cookie("tok", false).contains("Secure"));
    }

    #[test]
    fn a_non_bearer_authorization_header_is_not_replaced_by_the_cookie() {
        let mut headers = HeaderMap::new();
        headers.insert(AUTHORIZATION, "Basic abc".parse().unwrap());
        headers.insert(header::COOKIE, "session=tok".parse().unwrap());
        assert_eq!(session_token(&headers), None);

        headers.remove(AUTHORIZATION);
        assert_eq!(session_token(&headers).as_deref(), Some("tok"));
    }
}
