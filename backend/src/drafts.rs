use crate::{
    auth::*,
    http::{AppState, RequestId},
    pages::{Content, conflict, content, response},
    permissions::require,
};
use axum::{
    Json, Router,
    extract::{Extension, Path, Query, State},
    http::HeaderMap,
    response::Response,
    routing::get,
};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use utoipa::ToSchema;
use uuid::Uuid;
#[derive(Deserialize, ToSchema)]
pub struct DraftInput {
    pub draft_version: i64,
    pub base_revision_id: Uuid,
    #[serde(flatten)]
    pub content: Content,
}
#[derive(Serialize, FromRow, ToSchema)]
pub struct Draft {
    pub base_revision_id: Uuid,
    pub title: String,
    pub schema_version: i32,
    pub body: serde_json::Value,
}
#[derive(Serialize, ToSchema)]
pub struct DraftState {
    pub draft: Option<Draft>,
    pub draft_version: i64,
}
#[derive(Deserialize)]
pub struct DraftQuery {
    pub draft_version: i64,
}
#[utoipa::path(get,operation_id="get_draft",path="/api/v1/pages/{id}/draft",responses((status=200,body=DraftState)))]
pub async fn read(
    State(s): State<AppState>,
    Extension(id): Extension<RequestId>,
    h: HeaderMap,
    Path(p): Path<Uuid>,
) -> Response {
    response(async{let(mut tx,u)=transaction(&s,&h,false).await?;require(&mut tx,&u,p,true,2).await?;
 let version:Option<i64>=sqlx::query_scalar("SELECT draft_version FROM page_drafts WHERE page_id=$1 AND user_id=$2").bind(p).bind(u.id).fetch_optional(&mut *tx).await?;
 let draft=sqlx::query_as::<_,Draft>("SELECT base_revision_id,title,schema_version,body_json body FROM page_drafts WHERE page_id=$1 AND user_id=$2 AND NOT discarded").bind(p).bind(u.id).fetch_optional(&mut *tx).await?;Ok(DraftState{draft,draft_version:version.unwrap_or(0)})}.await,&id)
}
#[utoipa::path(put,operation_id="put_draft",path="/api/v1/pages/{id}/draft",request_body=DraftInput,responses((status=200,body=DraftState),(status=409,body=crate::http::ApiError)))]
pub async fn write(
    State(s): State<AppState>,
    Extension(id): Extension<RequestId>,
    h: HeaderMap,
    Path(p): Path<Uuid>,
    Json(v): Json<DraftInput>,
) -> Response {
    response(async{content(&v.content)?;let(mut tx,u)=transaction(&s,&h,true).await?;crate::pages::lock_page(&mut tx,&u,p,2).await?;
 let current:Option<i64>=sqlx::query_scalar("SELECT draft_version FROM page_drafts WHERE page_id=$1 AND user_id=$2").bind(p).bind(u.id).fetch_optional(&mut *tx).await?;if current.unwrap_or(0)!=v.draft_version{return Err(conflict("DRAFT_CONFLICT","草稿已在其他窗口更新，请先复制本地内容再重新加载"));}
 sqlx::query("INSERT INTO page_drafts(page_id,user_id,base_revision_id,title,schema_version,body_json,draft_version) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(page_id,user_id) DO UPDATE SET base_revision_id=$3,title=$4,schema_version=$5,body_json=$6,draft_version=$7,discarded=false,updated_at=now()").bind(p).bind(u.id).bind(v.base_revision_id).bind(&v.content.title).bind(v.content.schema_version).bind(&v.content.body).bind(v.draft_version+1).execute(&mut *tx).await?;tx.commit().await?;Ok(DraftState{draft:Some(Draft{base_revision_id:v.base_revision_id,title:v.content.title,schema_version:v.content.schema_version,body:v.content.body}),draft_version:v.draft_version+1})}.await,&id)
}
#[utoipa::path(delete,operation_id="delete_draft",path="/api/v1/pages/{id}/draft",params(("draft_version"=i64,Query)),responses((status=200,body=DraftState),(status=409,body=crate::http::ApiError)))]
pub async fn delete(
    State(s): State<AppState>,
    Extension(id): Extension<RequestId>,
    h: HeaderMap,
    Path(p): Path<Uuid>,
    Query(v): Query<DraftQuery>,
) -> Response {
    response(async{let(mut tx,u)=transaction(&s,&h,true).await?;crate::pages::lock_page(&mut tx,&u,p,2).await?;let current:Option<i64>=sqlx::query_scalar("SELECT draft_version FROM page_drafts WHERE page_id=$1 AND user_id=$2").bind(p).bind(u.id).fetch_optional(&mut *tx).await?;if current.unwrap_or(0)!=v.draft_version{return Err(conflict("DRAFT_CONFLICT","草稿已更新，不能丢弃其他窗口的内容"));}
 sqlx::query("INSERT INTO page_drafts(page_id,user_id,draft_version,discarded) VALUES($1,$2,$3,true) ON CONFLICT(page_id,user_id) DO UPDATE SET title=NULL,body_json=NULL,base_revision_id=NULL,schema_version=NULL,discarded=true,draft_version=$3,updated_at=now()").bind(p).bind(u.id).bind(v.draft_version+1).execute(&mut *tx).await?;tx.commit().await?;Ok(DraftState{draft:None,draft_version:v.draft_version+1})}.await,&id)
}
pub fn routes() -> Router<AppState> {
    Router::new().route(
        "/api/v1/pages/{id}/draft",
        get(read).put(write).delete(delete),
    )
}
