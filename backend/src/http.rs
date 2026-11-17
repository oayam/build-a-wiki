use axum::{
    Json, Router,
    extract::{Extension, Request, State},
    http::{HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
};
use serde::Serialize;
use sqlx::PgPool;
use std::{net::SocketAddr, path::PathBuf, time::Instant};
use utoipa::{OpenApi, ToSchema};
#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub attachment_dir: PathBuf,
    pub security: crate::auth::Security,
}
#[derive(Debug)]
pub struct Config {
    pub database_url: String,
    pub bind_addr: SocketAddr,
    pub attachment_dir: PathBuf,
    pub log_level: String,
}
impl Config {
    pub fn from_env() -> Result<Self, String> {
        Self::parse(|k| std::env::var(k).ok())
    }
    pub fn parse(get: impl Fn(&str) -> Option<String>) -> Result<Self, String> {
        let database_url = get("DATABASE_URL")
            .filter(|v| v.starts_with("postgres://") || v.starts_with("postgresql://"))
            .ok_or("DATABASE_URL must be a PostgreSQL URL")?;
        let bind_addr = get("BIND_ADDR")
            .unwrap_or_else(|| "127.0.0.1:8080".into())
            .parse()
            .map_err(|_| "invalid BIND_ADDR")?;
        let attachment_dir = get("ATTACHMENT_DIR")
            .filter(|s| !s.trim().is_empty())
            .ok_or("ATTACHMENT_DIR required")?
            .into();
        let log_level = get("LOG_LEVEL").unwrap_or_else(|| "info".into());
        tracing_subscriber::EnvFilter::try_new(&log_level).map_err(|_| "invalid LOG_LEVEL")?;
        Ok(Self {
            database_url,
            bind_addr,
            attachment_dir,
            log_level,
        })
    }
}
#[derive(Serialize, ToSchema)]
pub struct Health {
    pub status: String,
}
#[derive(Serialize, ToSchema)]
pub struct ApiError {
    pub code: String,
    pub message: String,
    pub request_id: String,
    pub details: serde_json::Value,
}
#[derive(Clone)]
pub struct RequestId(pub String);
pub(crate) fn error(status: StatusCode, code: &str, message: &str, id: &RequestId) -> Response {
    (
        status,
        Json(ApiError {
            code: code.into(),
            message: message.into(),
            request_id: id.0.clone(),
            details: serde_json::json!({}),
        }),
    )
        .into_response()
}
#[utoipa::path(get,path="/health/live",responses((status=200,description="进程存活",body=Health)))]
pub async fn live() -> Json<Health> {
    Json(Health {
        status: "ok".into(),
    })
}
#[utoipa::path(get,path="/health/ready",responses((status=200,description="服务就绪",body=Health),(status=503,description="服务未就绪",body=ApiError)))]
pub async fn ready(State(state): State<AppState>, Extension(id): Extension<RequestId>) -> Response {
    let check = async {
        sqlx::query("SELECT 1")
            .execute(&state.pool)
            .await
            .map_err(|_| ())?;
        let rows: Vec<(i64, Vec<u8>, bool)> = sqlx::query_as(
            "SELECT version,checksum,success FROM _sqlx_migrations ORDER BY version",
        )
        .fetch_all(&state.pool)
        .await
        .map_err(|_| ())?;
        let expected: Vec<_> = crate::MIGRATOR.iter().collect();
        if rows.len() != expected.len()
            || !rows
                .iter()
                .zip(expected)
                .all(|((v, c, s), m)| *s && *v == m.version && c.as_slice() == m.checksum.as_ref())
        {
            return Err(());
        }
        let probe = state
            .attachment_dir
            .join(format!(".ready-{}", uuid::Uuid::new_v4()));
        let file = tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&probe)
            .await
            .map_err(|_| ())?;
        drop(file);
        tokio::fs::remove_file(probe).await.map_err(|_| ())?;
        Ok::<(), ()>(())
    };
    match tokio::time::timeout(std::time::Duration::from_secs(4), check).await {
        Ok(Ok(())) => Json(Health {
            status: "ok".into(),
        })
        .into_response(),
        _ => error(
            StatusCode::SERVICE_UNAVAILABLE,
            "NOT_READY",
            "服务尚未就绪",
            &id,
        ),
    }
}
async fn not_found(Extension(id): Extension<RequestId>) -> Response {
    error(StatusCode::NOT_FOUND, "NOT_FOUND", "资源不存在", &id)
}
async fn method_not_allowed(Extension(id): Extension<RequestId>) -> Response {
    error(
        StatusCode::METHOD_NOT_ALLOWED,
        "METHOD_NOT_ALLOWED",
        "请求方法不支持",
        &id,
    )
}
async fn request_context(mut req: Request, next: Next) -> Response {
    let id = RequestId(uuid::Uuid::new_v4().to_string());
    req.extensions_mut().insert(id.clone());
    let start = Instant::now();
    let method = req.method().clone();
    let mut response = next.run(req).await;
    if response.status().is_client_error()
        && !response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.starts_with("application/json"))
    {
        let status = response.status();
        response = error(status, "VALIDATION_ERROR", "请求格式无效", &id);
    }
    response
        .headers_mut()
        .insert("cache-control", HeaderValue::from_static("no-store"));
    response.headers_mut().insert(
        "x-request-id",
        HeaderValue::from_str(&id.0).expect("UUID header"),
    );
    tracing::info!(request_id=%id.0,method=%method,status=response.status().as_u16(),elapsed_ms=start.elapsed().as_millis() as u64,"http request");
    response
}
pub fn router(state: AppState) -> Router {
    Router::new()
        .merge(crate::auth::routes())
        .merge(crate::admin::routes())
        .merge(crate::knowledge::routes())
        .merge(crate::pages::routes())
        .merge(crate::drafts::routes())
        .merge(crate::history::routes())
        .merge(crate::recent::routes())
        .merge(crate::moves::routes())
        .route("/health/live", get(live))
        .route("/health/ready", get(ready))
        .fallback(not_found)
        .method_not_allowed_fallback(method_not_allowed)
        .layer(middleware::from_fn(request_context))
        .with_state(state)
}
#[derive(OpenApi)]
#[openapi(
    paths(
        crate::pages::create,
        crate::pages::tree,
        crate::pages::read,
        crate::pages::save,
        crate::pages::shared,
        crate::drafts::read,
        crate::drafts::write,
        crate::drafts::delete,
        crate::history::list,
        crate::history::read,
        crate::history::restore,
        crate::recent::visit,
        crate::recent::list,
        crate::moves::preview,
        crate::moves::execute,
        live,
        ready,
        crate::auth::login,
        crate::auth::me,
        crate::auth::logout,
        crate::admin::users,
        crate::admin::create_user,
        crate::admin::update_user,
        crate::admin::reset_password,
        crate::admin::groups,
        crate::admin::create_group,
        crate::admin::members,
        crate::admin::add_member,
        crate::admin::remove_member,
        crate::knowledge::list,
        crate::knowledge::create,
        crate::knowledge::detail,
        crate::knowledge::rename,
        crate::knowledge::transfer,
        crate::knowledge::kb_permissions,
        crate::knowledge::kb_update,
        crate::knowledge::page_permissions,
        crate::knowledge::page_update,
        crate::knowledge::kb_subjects,
        crate::knowledge::page_subjects,
    ),
    components(schemas(Health, ApiError))
)]
pub struct ApiDoc;
#[cfg(test)]
mod tests {
    use super::*;
    use tower::ServiceExt;
    #[test]
    fn rejects_missing_and_invalid_configuration() {
        assert!(Config::parse(|_| None).is_err());
        assert!(
            Config::parse(|k| Some(
                match k {
                    "DATABASE_URL" => "postgres://localhost/wiki",
                    "ATTACHMENT_DIR" => "/tmp/wiki",
                    "BIND_ADDR" => "bad",
                    _ => "info",
                }
                .into()
            ))
            .is_err()
        );
    }
    #[tokio::test]
    async fn live_and_errors_have_request_ids() {
        let pool = sqlx::postgres::PgPoolOptions::new()
            .connect_lazy("postgres://localhost/wiki")
            .unwrap();
        for (path, status) in [("/health/live", 200), ("/private", 404)] {
            let response = router(AppState {
                pool: pool.clone(),
                attachment_dir: "/nonexistent".into(),
                security: crate::auth::Security::default(),
            })
            .oneshot(
                Request::builder()
                    .uri(path)
                    .header("x-request-id", "untrusted")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
            assert_eq!(response.status().as_u16(), status);
            let id = response.headers()["x-request-id"]
                .to_str()
                .unwrap()
                .to_owned();
            assert!(uuid::Uuid::parse_str(&id).is_ok());
            let body = axum::body::to_bytes(response.into_body(), 8192)
                .await
                .unwrap();
            let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
            if status == 404 {
                assert_eq!(json["request_id"], id);
                assert_eq!(json["code"], "NOT_FOUND");
            }
        }
    }
}
