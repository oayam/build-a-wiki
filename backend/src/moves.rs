use crate::{
    auth::*,
    http::{AppState, RequestId},
    identity::audit,
    pages::{conflict, fingerprint, lock_page, response},
    permissions::require,
};
use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::HeaderMap,
    response::Response,
    routing::post,
};
use serde::{Deserialize, Serialize};
use sqlx::{Postgres, Transaction};
use utoipa::ToSchema;
use uuid::Uuid;
#[derive(Serialize, Deserialize, ToSchema)]
pub struct MoveInput {
    pub parent_id: Option<Uuid>,
    pub position: i64,
    pub preview_token: Option<String>,
}
#[derive(Serialize, ToSchema)]
pub struct MovePreview {
    pub preview_token: String,
    pub affected_pages: i64,
    pub inherited_pages: i64,
    pub notice: String,
}
async fn plan(
    tx: &mut Transaction<'_, Postgres>,
    u: &Actor,
    p: Uuid,
    v: &MoveInput,
) -> Result<MovePreview> {
    let (k, _, _) = lock_page(tx, u, p, 3).await?;
    if !(-1_000_000_000..=1_000_000_000).contains(&v.position) {
        return Err(invalid());
    }
    let nodes:Vec<(Uuid,i32,i16,bool)>=sqlx::query_as("WITH RECURSIVE s AS(SELECT id,1 depth,acl_mode='inherit' inherited FROM pages WHERE id=$1 UNION ALL SELECT p.id,s.depth+1,s.inherited AND p.acl_mode='inherit' FROM pages p JOIN s ON p.parent_id=s.id WHERE p.deleted_at IS NULL AND s.depth<=64) SELECT id,depth,COALESCE(page_role($2,id),0)::smallint,inherited FROM s").bind(p).bind(u.id).fetch_all(&mut **tx).await?;
    if nodes.iter().any(|n| n.2 < 3) {
        return Err(denied());
    }
    let height = nodes.iter().map(|n| n.1).max().unwrap_or(1);
    let depth = if let Some(target) = v.parent_id {
        require(tx, u, target, true, 2).await?;
        let same: bool = sqlx::query_scalar("SELECT knowledge_base_id=$2 FROM pages WHERE id=$1")
            .bind(target)
            .bind(k)
            .fetch_one(&mut **tx)
            .await?;
        if !same || nodes.iter().any(|n| n.0 == target) {
            return Err(invalid());
        }
        sqlx::query_scalar::<_,i32>("WITH RECURSIVE a AS(SELECT id,parent_id,1 depth FROM pages WHERE id=$1 UNION ALL SELECT p.id,p.parent_id,a.depth+1 FROM pages p JOIN a ON p.id=a.parent_id WHERE a.depth<=64) SELECT max(depth) FROM a").bind(target).fetch_one(&mut **tx).await?
    } else {
        require(tx, u, k, false, 2).await?;
        0
    };
    if depth + height > 64 {
        return Err(invalid());
    }
    // Conservative snapshot invalidates previews after any authorization or same-library structure change.
    // Excludes password/session data; only its digest is returned to the client.
    let state:serde_json::Value=sqlx::query_scalar("SELECT jsonb_build_array((SELECT jsonb_agg(jsonb_build_array(id,parent_id,position,acl_mode,acl_version,lock_version,deleted_at) ORDER BY id) FROM pages WHERE knowledge_base_id=$1),(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM knowledge_base_acl a),(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM page_acl a),(SELECT jsonb_agg(jsonb_build_array(id,active,is_system_admin) ORDER BY id) FROM users),(SELECT jsonb_agg(to_jsonb(g) ORDER BY group_id,user_id) FROM group_members g),(SELECT jsonb_agg(jsonb_build_array(id,owner_id,acl_version) ORDER BY id) FROM knowledge_bases))").bind(k).fetch_one(&mut **tx).await?;
    Ok(MovePreview{preview_token:fingerprint(&(u.id,p,v.parent_id,v.position,state)),affected_pages:nodes.len() as i64,inherited_pages:nodes.iter().filter(|n|n.3).count() as i64,notice:"继承权限的页面将采用目标位置的授权；独立授权边界及其后代保持原授权。移动不改变页面网址和历史版本。".into()})
}
#[utoipa::path(post,operation_id="preview_move",path="/api/v1/pages/{id}/move-preview",request_body=MoveInput,responses((status=200,body=MovePreview)))]
pub async fn preview(
    State(s): State<AppState>,
    Extension(id): Extension<RequestId>,
    h: HeaderMap,
    Path(p): Path<Uuid>,
    Json(v): Json<MoveInput>,
) -> Response {
    response(
        async {
            let (mut tx, u) = transaction(&s, &h, true).await?;
            let result = plan(&mut tx, &u, p, &v).await?;
            tx.commit().await?;
            Ok(result)
        }
        .await,
        &id,
    )
}
#[utoipa::path(post,operation_id="move_page",path="/api/v1/pages/{id}/move",request_body=MoveInput,responses((status=200,body=MovePreview),(status=409,body=crate::http::ApiError)))]
pub async fn execute(
    State(s): State<AppState>,
    Extension(id): Extension<RequestId>,
    h: HeaderMap,
    Path(p): Path<Uuid>,
    Json(v): Json<MoveInput>,
) -> Response {
    response(async{let(mut tx,u)=transaction(&s,&h,true).await?;let result=plan(&mut tx,&u,p,&v).await?;if v.preview_token.as_deref()!=Some(&result.preview_token){return Err(conflict("MOVE_CONFLICT","结构或权限已变化，请重新预览"));}sqlx::query("UPDATE pages SET parent_id=$2,position=$3,lock_version=lock_version+1,updated_at=now() WHERE id=$1").bind(p).bind(v.parent_id).bind(v.position).execute(&mut *tx).await?;audit(&mut tx,Some(u.id),"pages.move",Some(p),&id.0,serde_json::json!({})).await?;tx.commit().await?;Ok(result)}.await,&id)
}
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/v1/pages/{id}/move-preview", post(preview))
        .route("/api/v1/pages/{id}/move", post(execute))
}
