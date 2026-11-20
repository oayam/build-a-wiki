use crate::constants::{audit_action, error_code, message};
use crate::{
    auth::*,
    http::{AppState, RequestId},
    identity::audit,
    pages::*,
    permissions::require,
};
use axum::{
    Json, Router,
    extract::{Extension, Path, Query, State},
    http::HeaderMap,
    response::Response,
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use utoipa::ToSchema;
use uuid::Uuid;
#[derive(Serialize, FromRow, ToSchema)]
pub struct RevisionSummary {
    pub id: Uuid,
    pub revision_no: i64,
    pub title: String,
    pub editor_id: Uuid,
    pub summary: String,
    pub created_at: String,
    pub restored_from_revision_id: Option<Uuid>,
}
#[derive(Serialize, FromRow, ToSchema)]
pub struct Revision {
    pub id: Uuid,
    pub revision_no: i64,
    pub title: String,
    pub schema_version: i32,
    pub body: serde_json::Value,
    pub body_text: String,
    pub editor_id: Uuid,
    pub restored_from_revision_id: Option<Uuid>,
}
#[derive(Serialize, ToSchema)]
pub struct Revisions {
    pub items: Vec<RevisionSummary>,
    pub next_cursor: Option<i64>,
}
#[derive(Deserialize)]
pub struct RevisionQuery {
    pub limit: Option<i64>,
    pub cursor: Option<i64>,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct Restore {
    pub request_id: Uuid,
    pub base_revision_id: Uuid,
    pub revision_id: Uuid,
}
#[utoipa::path(get,operation_id="list_revisions",path="/api/v1/pages/{id}/revisions",params(("limit"=Option<i64>,Query),("cursor"=Option<i64>,Query)),responses((status=200,body=Revisions)))]
pub async fn list(
    State(s): State<AppState>,
    Extension(id): Extension<RequestId>,
    h: HeaderMap,
    Path(p): Path<Uuid>,
    Query(q): Query<RevisionQuery>,
) -> Response {
    response(async{let(mut tx,u)=transaction(&s,&h,false).await?;require(&mut tx,&u,p,true,1).await?;let limit=q.limit.unwrap_or(20);if !(1..=100).contains(&limit)||q.cursor.is_some_and(|n|n<1){return Err(invalid());}let mut items=sqlx::query_as::<_,RevisionSummary>("SELECT id,revision_no,title,editor_id,summary,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') created_at,restored_from_revision_id FROM page_revisions WHERE page_id=$1 AND ($2::bigint IS NULL OR revision_no<$2) ORDER BY revision_no DESC LIMIT $3").bind(p).bind(q.cursor).bind(limit+1).fetch_all(&mut *tx).await?;let next_cursor=if items.len()>limit as usize{items.pop();items.last().map(|r|r.revision_no)}else{None};Ok(Revisions{items,next_cursor})}.await,&id)
}
#[utoipa::path(get,operation_id="read_revision",path="/api/v1/pages/{id}/revisions/{revision_id}",responses((status=200,body=Revision)))]
pub async fn read(
    State(s): State<AppState>,
    Extension(id): Extension<RequestId>,
    h: HeaderMap,
    Path((p, r)): Path<(Uuid, Uuid)>,
) -> Response {
    response(async{let(mut tx,u)=transaction(&s,&h,false).await?;require(&mut tx,&u,p,true,1).await?;let rev=sqlx::query_as::<_,Revision>("SELECT id,revision_no,title,schema_version,body_json body,revision_text_v1(body_json) body_text,editor_id,restored_from_revision_id FROM page_revisions WHERE page_id=$1 AND id=$2").bind(p).bind(r).fetch_optional(&mut *tx).await?.ok_or_else(missing)?;if u.is_system_admin{audit(&mut tx,Some(u.id),audit_action::REVISIONS_ADMIN_READ,Some(p),&id.0,serde_json::json!({})).await?;tx.commit().await?;}Ok(rev)}.await,&id)
}
#[utoipa::path(post,operation_id="restore_revision",path="/api/v1/pages/{id}/restore-revision",request_body=Restore,responses((status=200,body=Saved),(status=409,body=crate::http::ApiError)))]
pub async fn restore(
    State(s): State<AppState>,
    Extension(id): Extension<RequestId>,
    h: HeaderMap,
    Path(p): Path<Uuid>,
    Json(v): Json<Restore>,
) -> Response {
    response(async{let(mut tx,u)=transaction(&s,&h,true).await?;let(_,current,_)=lock_page(&mut tx,&u,p,2).await?;let scope=format!("restore:{p}");let hash=fingerprint(&v);if let Some(result)=replay(&mut tx,u.id,&scope,v.request_id,&hash).await?{return Ok(result);}
 crate::edit_leases::require_idle(&mut tx,p).await?;
 if current!=v.base_revision_id{return Err(conflict(error_code::REVISION_CONFLICT,message::RESTORE_CONFLICT));}
 let source:Option<(String,i32,serde_json::Value)>=sqlx::query_as("SELECT title,schema_version,body_json FROM page_revisions WHERE page_id=$1 AND id=$2").bind(p).bind(v.revision_id).fetch_optional(&mut *tx).await?;let(title,schema_version,body)=source.ok_or_else(missing)?;let value=Content{title,schema_version,body};let text=content(&value)?;let saved=append(&mut tx,&u,p,&value,&text,message::RESTORE_REVISION,Some(v.revision_id)).await?;let result=serde_json::to_value(saved).unwrap();remember(&mut tx,u.id,&scope,v.request_id,&hash,&result).await?;audit(&mut tx,Some(u.id),audit_action::REVISIONS_RESTORE,Some(p),&id.0,serde_json::json!({})).await?;tx.commit().await?;Ok(result)}.await,&id)
}
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/v1/pages/{id}/revisions/{revision_id}", get(read))
        .route("/api/v1/pages/{id}/restore-revision", post(restore))
}
