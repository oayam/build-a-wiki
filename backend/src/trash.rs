use crate::{
    auth::*,
    http::{AppState, RequestId},
    identity::audit,
    jobs,
    pages::{conflict, fingerprint, lock_page, response},
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
use sqlx::{FromRow, Postgres, Transaction};
use utoipa::ToSchema;
use uuid::Uuid;
#[derive(Serialize, ToSchema)]
pub struct DeletePreview {
    pub affected_pages: i64,
    pub preview_token: String,
}
#[derive(Deserialize, ToSchema)]
pub struct DeleteInput {
    pub preview_token: String,
}
#[derive(Deserialize, ToSchema)]
pub struct RestoreInput {
    pub parent_id: Option<Uuid>,
}
#[derive(Serialize, FromRow, ToSchema)]
pub struct TrashItem {
    pub id: Uuid,
    pub root_id: Uuid,
    pub title: String,
    pub deleted_at: String,
    pub affected_pages: i64,
}
#[derive(Serialize, ToSchema)]
pub struct TrashList {
    pub items: Vec<TrashItem>,
    pub next_cursor: Option<Uuid>,
}
async fn preview_tx(
    tx: &mut Transaction<'_, Postgres>,
    u: &Actor,
    p: Uuid,
) -> Result<(Vec<Uuid>, DeletePreview)> {
    lock_page(tx, u, p, 3).await?;
    let rows:Vec<(Uuid,i16,i64,i64)>=sqlx::query_as("WITH RECURSIVE s AS(SELECT id,0 d FROM pages WHERE id=$1 AND deleted_at IS NULL UNION ALL SELECT p.id,s.d+1 FROM pages p JOIN s ON p.parent_id=s.id WHERE p.deleted_at IS NULL AND s.d<64) SELECT p.id,page_role($2,p.id),p.lock_version,p.acl_version FROM s JOIN pages p ON p.id=s.id ORDER BY p.id").bind(p).bind(u.id).fetch_all(&mut **tx).await?;
    if rows.iter().any(|r| r.1 < 3) {
        return Err(denied());
    }
    let token = fingerprint(&(u.id, &rows));
    Ok((
        rows.iter().map(|r| r.0).collect(),
        DeletePreview {
            affected_pages: rows.len() as i64,
            preview_token: token,
        },
    ))
}
#[utoipa::path(post,operation_id="delete_preview",path="/api/v1/pages/{id}/delete-preview",responses((status=200,body=DeletePreview)))]
pub async fn preview(
    State(s): State<AppState>,
    Extension(id): Extension<RequestId>,
    h: HeaderMap,
    Path(p): Path<Uuid>,
) -> Response {
    response(
        async {
            let (mut tx, u) = transaction(&s, &h, true).await?;
            Ok(preview_tx(&mut tx, &u, p).await?.1)
        }
        .await,
        &id,
    )
}
#[utoipa::path(delete,operation_id="delete_page",path="/api/v1/pages/{id}",request_body=DeleteInput,responses((status=200,body=serde_json::Value)))]
pub async fn delete(
    State(s): State<AppState>,
    Extension(id): Extension<RequestId>,
    h: HeaderMap,
    Path(p): Path<Uuid>,
    Json(v): Json<DeleteInput>,
) -> Response {
    response(async{let(mut tx,u)=transaction(&s,&h,true).await?;let(nodes,preview)=preview_tx(&mut tx,&u,p).await?;if preview.preview_token!=v.preview_token{return Err(conflict("STRUCTURE_CONFLICT","子树已变化，请重新预览"));}let batch=Uuid::new_v4();sqlx::query("INSERT INTO deletion_batches(id,root_id,deleted_by) VALUES($1,$2,$3)").bind(batch).bind(p).bind(u.id).execute(&mut *tx).await?;sqlx::query("UPDATE pages SET deleted_at=now(),deletion_batch_id=$1,lock_version=lock_version+1 WHERE id=ANY($2)").bind(batch).bind(&nodes).execute(&mut *tx).await?;jobs::enqueue(&mut tx,"purge_batch",&format!("purge:{batch}"),serde_json::json!({"id":batch}),30*86400).await?;audit(&mut tx,Some(u.id),"pages.delete",Some(p),&id.0,serde_json::json!({})).await?;tx.commit().await?;Ok(serde_json::json!({"batch_id":batch}))}.await,&id)
}
#[utoipa::path(get,operation_id="list_trash",path="/api/v1/trash",params(("cursor"=Option<Uuid>,Query)),responses((status=200,body=TrashList)))]
pub async fn list(
    State(s): State<AppState>,
    Extension(id): Extension<RequestId>,
    h: HeaderMap,
    Query(q): Query<crate::knowledge::Pagination>,
) -> Response {
    response(async{let(mut tx,u)=transaction(&s,&h,false).await?;let mut items=sqlx::query_as::<_,TrashItem>("SELECT b.id,b.root_id,p.title,b.created_at::text deleted_at,(SELECT count(*) FROM pages WHERE deletion_batch_id=b.id) affected_pages FROM deletion_batches b JOIN pages p ON p.id=b.root_id WHERE p.deleted_at IS NOT NULL AND p.deletion_batch_id=b.id AND NOT EXISTS(SELECT 1 FROM pages c WHERE c.deletion_batch_id=b.id AND archived_page_role($1,c.id)<3) AND ($2::uuid IS NULL OR b.id>$2) ORDER BY b.id LIMIT 21").bind(u.id).bind(q.cursor).fetch_all(&mut *tx).await?;let next_cursor=if items.len()>20{items.pop();items.last().map(|r|r.id)}else{None};Ok(TrashList{items,next_cursor})}.await,&id)
}
#[utoipa::path(post,operation_id="restore_deleted_page",path="/api/v1/pages/{id}/restore",request_body=RestoreInput,responses((status=200,body=serde_json::Value)))]
pub async fn restore(
    State(s): State<AppState>,
    Extension(id): Extension<RequestId>,
    h: HeaderMap,
    Path(p): Path<Uuid>,
    Json(v): Json<RestoreInput>,
) -> Response {
    response(async{let(mut tx,u)=transaction(&s,&h,true).await?;let row:Option<(Uuid,Uuid)>=sqlx::query_as("SELECT p.knowledge_base_id,b.id FROM deletion_batches b JOIN pages p ON p.id=b.root_id WHERE p.id=$1 AND p.deleted_at IS NOT NULL AND p.deletion_batch_id=b.id AND NOT EXISTS(SELECT 1 FROM pages c WHERE c.deletion_batch_id=b.id AND archived_page_role($2,c.id)<3)").bind(p).bind(u.id).fetch_optional(&mut *tx).await?;let(k,b)=row.ok_or_else(missing)?;
 sqlx::query("SELECT id FROM knowledge_bases WHERE id=$1 FOR UPDATE").bind(k).execute(&mut *tx).await?;
 let depth=if let Some(parent)=v.parent_id{require(&mut tx,&u,parent,true,2).await?;let same:bool=sqlx::query_scalar("SELECT knowledge_base_id=$2 FROM pages WHERE id=$1").bind(parent).bind(k).fetch_one(&mut *tx).await?;if !same{return Err(invalid());}sqlx::query_scalar::<_,i32>("WITH RECURSIVE a AS(SELECT id,parent_id,1 d FROM pages WHERE id=$1 UNION ALL SELECT p.id,p.parent_id,a.d+1 FROM pages p JOIN a ON a.parent_id=p.id WHERE a.d<65) SELECT max(d) FROM a").bind(parent).fetch_one(&mut *tx).await?}else{require(&mut tx,&u,k,false,2).await?;0};
 let height:i32=sqlx::query_scalar("WITH RECURSIVE s AS(SELECT id,1 d FROM pages WHERE id=$1 UNION ALL SELECT p.id,s.d+1 FROM pages p JOIN s ON p.parent_id=s.id WHERE p.deletion_batch_id=$2 AND s.d<65) SELECT max(d) FROM s").bind(p).bind(b).fetch_one(&mut *tx).await?;if depth+height>64{return Err(invalid());}
 sqlx::query("UPDATE pages SET parent_id=$2 WHERE id=$1").bind(p).bind(v.parent_id).execute(&mut *tx).await?;sqlx::query("UPDATE pages SET deleted_at=NULL,deletion_batch_id=NULL,lock_version=lock_version+1 WHERE deletion_batch_id=$1").bind(b).execute(&mut *tx).await?;sqlx::query("DELETE FROM deletion_batches WHERE id=$1").bind(b).execute(&mut *tx).await?;audit(&mut tx,Some(u.id),"pages.restore",Some(p),&id.0,serde_json::json!({})).await?;tx.commit().await?;Ok(serde_json::json!({"ok":true}))}.await,&id)
}
/// Called with the global write barrier held by the worker.
pub async fn purge(tx: &mut Transaction<'_, Postgres>, batch: Uuid) -> Result<()> {
    let nodes:Vec<Uuid>=sqlx::query_scalar("SELECT id FROM pages WHERE deletion_batch_id=$1 AND deleted_at<=now()-interval '30 days' FOR UPDATE").bind(batch).fetch_all(&mut **tx).await?;
    if nodes.is_empty() {
        return Ok(());
    }
    let files: Vec<String> =
        sqlx::query_scalar("SELECT storage_key FROM attachments WHERE page_id=ANY($1)")
            .bind(&nodes)
            .fetch_all(&mut **tx)
            .await?;
    for key in files {
        jobs::enqueue(
            tx,
            "remove_file",
            &format!("remove:{key}"),
            serde_json::json!({"key":key}),
            0,
        )
        .await?;
    }
    // Detach earlier independently deleted descendants before removing their old parent.
    sqlx::query("UPDATE pages SET parent_id=NULL WHERE parent_id=ANY($1) AND NOT(id=ANY($1))")
        .bind(&nodes)
        .execute(&mut **tx)
        .await?;
    for table in ["attachments", "page_drafts", "recent_visits", "page_acl"] {
        sqlx::query(&format!("DELETE FROM {table} WHERE page_id=ANY($1)"))
            .bind(&nodes)
            .execute(&mut **tx)
            .await?;
    }
    sqlx::query("SET LOCAL wiki.purge='on'")
        .execute(&mut **tx)
        .await?;
    sqlx::query("UPDATE pages SET current_revision_id=NULL WHERE id=ANY($1)")
        .bind(&nodes)
        .execute(&mut **tx)
        .await?;
    sqlx::query("DELETE FROM page_revisions WHERE page_id=ANY($1)")
        .bind(&nodes)
        .execute(&mut **tx)
        .await?;
    sqlx::query("DELETE FROM pages WHERE id=ANY($1)")
        .bind(&nodes)
        .execute(&mut **tx)
        .await?;
    sqlx::query("DELETE FROM deletion_batches WHERE id=$1")
        .bind(batch)
        .execute(&mut **tx)
        .await?;
    audit(
        tx,
        None,
        "pages.purge",
        Some(batch),
        &Uuid::new_v4().to_string(),
        serde_json::json!({}),
    )
    .await?;
    Ok(())
}
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/v1/pages/{id}/delete-preview", post(preview))
        .route("/api/v1/pages/{id}/restore", post(restore))
        .route("/api/v1/trash", get(list))
}
