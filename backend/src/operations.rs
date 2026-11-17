use crate::constants::audit_action;
use crate::{
    auth::*,
    http::{AppState, RequestId},
    pages::response,
};
use axum::{
    Router,
    extract::{Extension, Path, Query, State},
    http::HeaderMap,
    response::Response,
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use utoipa::ToSchema;
use uuid::Uuid;
#[derive(Deserialize)]
pub struct AuditQuery {
    pub cursor: Option<Uuid>,
    pub action: Option<String>,
}
#[derive(Serialize, FromRow, ToSchema)]
pub struct AuditRow {
    pub id: Uuid,
    pub actor_id: Option<Uuid>,
    pub action: String,
    pub resource_id: Option<Uuid>,
    pub created_at: String,
    pub details: serde_json::Value,
}
#[derive(Serialize, ToSchema)]
pub struct AuditList {
    pub items: Vec<AuditRow>,
    pub next_cursor: Option<Uuid>,
}
#[utoipa::path(get,operation_id="audit_events",path="/api/v1/admin/audit-events",params(("cursor"=Option<Uuid>,Query),("action"=Option<String>,Query)),responses((status=200,body=AuditList)))]
pub async fn audit(
    State(s): State<AppState>,
    Extension(id): Extension<RequestId>,
    h: HeaderMap,
    Query(q): Query<AuditQuery>,
) -> Response {
    response(async{let(mut tx,u)=transaction(&s,&h,false).await?;admin(&u)?;if q.action.as_ref().is_some_and(|a|a.len()>100){return Err(invalid());}let mut items=sqlx::query_as::<_,AuditRow>("SELECT id,actor_id,action,resource_id,created_at::text,details FROM audit_events WHERE ($1::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM audit_events WHERE id=$1)) AND ($2::text IS NULL OR action=$2) ORDER BY created_at DESC,id DESC LIMIT 51").bind(q.cursor).bind(q.action.filter(|a|!a.is_empty())).fetch_all(&mut *tx).await?;let next_cursor=if items.len()>50{items.pop();items.last().map(|r|r.id)}else{None};Ok(AuditList{items,next_cursor})}.await,&id)
}
#[derive(Serialize, FromRow, ToSchema)]
pub struct JobRow {
    pub id: Uuid,
    pub kind: String,
    pub attempts: i32,
    pub available_at: String,
    pub last_error: Option<String>,
}
#[derive(Serialize, ToSchema)]
pub struct SystemStatus {
    pub maintenance: bool,
    pub pending_jobs: i64,
    pub failed_jobs: i64,
    pub disk_available_bytes: Option<u64>,
    pub disk_warning: bool,
    pub jobs: Vec<JobRow>,
}
#[utoipa::path(get,operation_id="system_status",path="/api/v1/admin/system-status",responses((status=200,body=SystemStatus)))]
pub async fn status(
    State(s): State<AppState>,
    Extension(id): Extension<RequestId>,
    h: HeaderMap,
) -> Response {
    response(async{let(mut tx,u)=transaction(&s,&h,false).await?;admin(&u)?;let maintenance:bool=sqlx::query_scalar("SELECT maintenance FROM auth_guard WHERE id=1").fetch_one(&mut *tx).await?;let(pending_jobs,failed_jobs):(i64,i64)=sqlx::query_as("SELECT count(*),count(*) FILTER(WHERE attempts>0) FROM jobs WHERE completed_at IS NULL").fetch_one(&mut *tx).await?;let jobs=sqlx::query_as::<_,JobRow>("SELECT id,kind,attempts,available_at::text,last_error FROM jobs WHERE completed_at IS NULL ORDER BY attempts DESC,available_at,id LIMIT 50").fetch_all(&mut *tx).await?;let output=tokio::process::Command::new("df").args(["-Pk","--"]).arg(&s.attachment_dir).output().await.ok();let disk_available_bytes=output.filter(|o|o.status.success()).and_then(|o|String::from_utf8(o.stdout).ok()).and_then(|s|s.lines().nth(1).and_then(|l|l.split_whitespace().nth(3)).and_then(|n|n.parse::<u64>().ok()).map(|n|n*1024));Ok(SystemStatus{maintenance,pending_jobs,failed_jobs,disk_warning:disk_available_bytes.is_none_or(|n|n<1024*1024*1024),disk_available_bytes,jobs})}.await,&id)
}
#[utoipa::path(post,operation_id="retry_job",path="/api/v1/admin/jobs/{id}/retry",responses((status=200,body=serde_json::Value)))]
pub async fn retry(
    State(s): State<AppState>,
    Extension(id): Extension<RequestId>,
    h: HeaderMap,
    Path(j): Path<Uuid>,
) -> Response {
    response(
        async {
            let (mut tx, u) = transaction(&s, &h, true).await?;
            admin(&u)?;
            let rows = sqlx::query(
                "UPDATE jobs SET available_at=now() WHERE id=$1 AND completed_at IS NULL",
            )
            .bind(j)
            .execute(&mut *tx)
            .await?
            .rows_affected();
            if rows == 0 {
                return Err(missing());
            }
            crate::identity::audit(
                &mut tx,
                Some(u.id),
                audit_action::JOBS_RETRY,
                Some(j),
                &id.0,
                serde_json::json!({}),
            )
            .await?;
            tx.commit().await?;
            Ok(serde_json::json!({"ok":true}))
        }
        .await,
        &id,
    )
}
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/v1/admin/audit-events", get(audit))
        .route("/api/v1/admin/system-status", get(status))
        .route("/api/v1/admin/jobs/{id}/retry", post(retry))
}
