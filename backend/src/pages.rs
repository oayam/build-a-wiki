use crate::constants::{audit_action, error_code, message};
use crate::{
    auth::*,
    body,
    http::{AppState, RequestId},
    identity::{audit, token_hash},
    permissions::require,
};
use axum::{
    Json, Router,
    extract::{Extension, Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{FromRow, Postgres, Transaction};
use utoipa::ToSchema;
use uuid::Uuid;
#[derive(Serialize, Deserialize, ToSchema, Clone)]
pub struct Content {
    pub title: String,
    pub schema_version: i32,
    pub body: Value,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct CreatePage {
    pub request_id: Uuid,
    pub parent_id: Option<Uuid>,
    #[serde(flatten)]
    pub content: Content,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct SavePage {
    pub lease_id: Uuid,
    pub request_id: Uuid,
    pub base_revision_id: Uuid,
    #[serde(flatten)]
    pub content: Content,
    pub summary: Option<String>,
}
#[derive(Serialize, Deserialize, FromRow, ToSchema)]
pub struct PageLink {
    pub id: Uuid,
    pub title: String,
}
#[derive(Serialize, Deserialize, FromRow, ToSchema)]
pub struct PageSummary {
    pub id: Uuid,
    pub title: String,
    pub position: i64,
    pub role: i16,
    pub has_children: bool,
}
#[derive(Serialize, ToSchema)]
pub struct PageList {
    pub items: Vec<PageSummary>,
    pub next_cursor: Option<Uuid>,
}
#[derive(Serialize, Deserialize, FromRow, ToSchema)]
pub struct Page {
    pub id: Uuid,
    pub knowledge_base_id: Uuid,
    pub parent_id: Option<Uuid>,
    pub title: String,
    pub current_revision_id: Uuid,
    pub schema_version: i32,
    pub body: Value,
    pub body_text: String,
    pub role: i16,
    pub lock_version: i64,
    pub editor_id: Uuid,
    pub author_name: String,
    pub last_edited_at: String,
    pub view_count: i64,
}
#[derive(Serialize, ToSchema)]
pub struct PageDetail {
    #[serde(flatten)]
    pub page: Page,
    pub breadcrumbs: Vec<PageLink>,
}
#[derive(Deserialize)]
pub struct TreeQuery {
    pub parent_id: Option<Uuid>,
    pub limit: Option<i64>,
    pub cursor: Option<Uuid>,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct Saved {
    pub id: Uuid,
    pub revision_id: Uuid,
    pub revision_no: i64,
}
pub fn response<T: Serialize>(r: Result<T>, id: &RequestId) -> Response {
    match r {
        Ok(v) => Json(v).into_response(),
        Err(e) => e.response(id),
    }
}
pub fn conflict(code: &'static str, message: &'static str) -> Failure {
    Failure(StatusCode::CONFLICT, code, message)
}
pub fn content(v: &Content) -> Result<String> {
    if v.title.trim().is_empty() || v.title.chars().count() > 200 {
        return Err(invalid());
    }
    body::validate(v.schema_version, &v.body)
}
pub async fn replay(
    tx: &mut Transaction<'_, Postgres>,
    user: Uuid,
    scope: &str,
    key: Uuid,
    hash: &str,
) -> Result<Option<Value>> {
    let result:Option<(String,Value)>=sqlx::query_as("SELECT request_hash,response FROM request_results WHERE user_id=$1 AND scope=$2 AND request_id=$3").bind(user).bind(scope).bind(key).fetch_optional(&mut **tx).await?;
    match result {
        Some((h, value)) if h == hash => Ok(Some(value)),
        Some(_) => Err(conflict(
            error_code::IDEMPOTENCY_CONFLICT,
            message::PAGE_IDEMPOTENCY_CONFLICT,
        )),
        None => Ok(None),
    }
}
pub async fn remember(
    tx: &mut Transaction<'_, Postgres>,
    user: Uuid,
    scope: &str,
    key: Uuid,
    hash: &str,
    value: &Value,
) -> Result<()> {
    sqlx::query("INSERT INTO request_results(user_id,scope,request_id,request_hash,response) VALUES($1,$2,$3,$4,$5)").bind(user).bind(scope).bind(key).bind(hash).bind(value).execute(&mut **tx).await?;
    Ok(())
}
pub fn fingerprint(v: &impl Serialize) -> String {
    token_hash(&serde_json::to_string(v).expect("serializable request"))
}
pub async fn lock_page(
    tx: &mut Transaction<'_, Postgres>,
    u: &Actor,
    p: Uuid,
    min: i16,
) -> Result<(Uuid, Uuid, i64)> {
    require(tx, u, p, true, min).await?;
    let kb: Uuid = sqlx::query_scalar("SELECT knowledge_base_id FROM pages WHERE id=$1")
        .bind(p)
        .fetch_one(&mut **tx)
        .await?;
    sqlx::query("SELECT id FROM knowledge_bases WHERE id=$1 FOR UPDATE")
        .bind(kb)
        .execute(&mut **tx)
        .await?;
    let (current, version): (Uuid, i64) =
        sqlx::query_as("SELECT current_revision_id,lock_version FROM pages WHERE id=$1 FOR UPDATE")
            .bind(p)
            .fetch_one(&mut **tx)
            .await?;
    Ok((kb, current, version))
}
pub async fn append(
    tx: &mut Transaction<'_, Postgres>,
    u: &Actor,
    p: Uuid,
    v: &Content,
    text: &str,
    summary: &str,
    restored: Option<Uuid>,
) -> Result<Saved> {
    let n: i64 = sqlx::query_scalar(
        "SELECT COALESCE(max(revision_no),0)+1 FROM page_revisions WHERE page_id=$1",
    )
    .bind(p)
    .fetch_one(&mut **tx)
    .await?;
    let r = Uuid::new_v4();
    sqlx::query("INSERT INTO page_revisions(id,page_id,revision_no,title,schema_version,body_json,editor_id,summary,restored_from_revision_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)").bind(r).bind(p).bind(n).bind(&v.title).bind(v.schema_version).bind(&v.body).bind(u.id).bind(summary).bind(restored).execute(&mut **tx).await?;
    sqlx::query("UPDATE pages SET title=$2,current_revision_id=$3,body_text=$4,lock_version=lock_version+1,updated_at=now() WHERE id=$1").bind(p).bind(&v.title).bind(r).bind(text).execute(&mut **tx).await?;
    Ok(Saved {
        id: p,
        revision_id: r,
        revision_no: n,
    })
}
#[utoipa::path(post,operation_id="create_page",path="/api/v1/knowledge-bases/{id}/pages",request_body=CreatePage,responses((status=200,body=Saved),(status=409,body=crate::http::ApiError)))]
pub async fn create(
    State(s): State<AppState>,
    Extension(id): Extension<RequestId>,
    h: HeaderMap,
    Path(k): Path<Uuid>,
    Json(v): Json<CreatePage>,
) -> Response {
    response(async{
 let text=content(&v.content)?;let(mut tx,u)=transaction(&s,&h,true).await?;
 if let Some(parent)=v.parent_id{require(&mut tx,&u,parent,true,2).await?;let same:bool=sqlx::query_scalar("SELECT knowledge_base_id=$2 FROM pages WHERE id=$1").bind(parent).bind(k).fetch_one(&mut *tx).await?;if !same{return Err(invalid());}
 let depth:i64=sqlx::query_scalar("WITH RECURSIVE a AS(SELECT id,parent_id,1 AS depth FROM pages WHERE id=$1 UNION ALL SELECT p.id,p.parent_id,a.depth+1 FROM pages p JOIN a ON p.id=a.parent_id WHERE a.depth<=64) SELECT max(depth)::bigint FROM a").bind(parent).fetch_one(&mut *tx).await?;if depth>=64{return Err(invalid());}
 }else{require(&mut tx,&u,k,false,2).await?;}
 sqlx::query("SELECT id FROM knowledge_bases WHERE id=$1 FOR UPDATE").bind(k).execute(&mut *tx).await?;
 let scope=format!("create-page:{k}");let hash=fingerprint(&v);if let Some(r)=replay(&mut tx,u.id,&scope,v.request_id,&hash).await?{return Ok(r);}
 let p=Uuid::new_v4();sqlx::query("INSERT INTO pages(id,knowledge_base_id,parent_id,title,created_by,position) VALUES($1,$2,$3,$4,$5,COALESCE((SELECT max(position)+1 FROM pages WHERE knowledge_base_id=$2 AND parent_id IS NOT DISTINCT FROM $3),0))").bind(p).bind(k).bind(v.parent_id).bind(&v.content.title).bind(u.id).execute(&mut *tx).await?;
 let saved=append(&mut tx,&u,p,&v.content,&text,message::CREATE_PAGE,None).await?;let value=serde_json::to_value(saved).unwrap();remember(&mut tx,u.id,&scope,v.request_id,&hash,&value).await?;audit(&mut tx,Some(u.id),audit_action::PAGES_CREATE,Some(p),&id.0,serde_json::json!({})).await?;tx.commit().await?;Ok(value)
 }.await,&id)
}
#[utoipa::path(get,path="/api/v1/knowledge-bases/{id}/pages",params(("parent_id"=Option<Uuid>,Query),("limit"=Option<i64>,Query),("cursor"=Option<Uuid>,Query)),responses((status=200,body=PageList)))]
pub async fn tree(
    State(s): State<AppState>,
    Extension(id): Extension<RequestId>,
    h: HeaderMap,
    Path(k): Path<Uuid>,
    Query(q): Query<TreeQuery>,
) -> Response {
    response(async{
 let(mut tx,u)=transaction(&s,&h,false).await?;let limit=q.limit.unwrap_or(20);if !(1..=100).contains(&limit){return Err(invalid());}
 if let Some(parent)=q.parent_id{require(&mut tx,&u,parent,true,1).await?;let same:bool=sqlx::query_scalar("SELECT knowledge_base_id=$2 FROM pages WHERE id=$1").bind(parent).bind(k).fetch_one(&mut *tx).await?;if !same{return Err(missing());}}else{require(&mut tx,&u,k,false,1).await?;}
 let cursor=if let Some(c)=q.cursor{Some(sqlx::query_scalar::<_,i64>("SELECT position FROM pages WHERE id=$1 AND knowledge_base_id=$2 AND parent_id IS NOT DISTINCT FROM $3 AND deleted_at IS NULL AND page_role($4,id)>0").bind(c).bind(k).bind(q.parent_id).bind(u.id).fetch_optional(&mut *tx).await?.ok_or_else(invalid)?)}else{None};
 let mut items=sqlx::query_as::<_,PageSummary>("SELECT p.id,p.title,p.position,page_role($1,p.id) role,EXISTS(SELECT 1 FROM pages c WHERE c.parent_id=p.id AND c.deleted_at IS NULL AND page_role($1,c.id)>0) has_children FROM pages p WHERE p.knowledge_base_id=$2 AND p.parent_id IS NOT DISTINCT FROM $3 AND p.deleted_at IS NULL AND page_role($1,p.id)>0 AND ($4::bigint IS NULL OR (p.position,p.id)>($4,$5::uuid)) ORDER BY p.position,p.id LIMIT $6").bind(u.id).bind(k).bind(q.parent_id).bind(cursor).bind(q.cursor).bind(limit+1).fetch_all(&mut *tx).await?;
 let next_cursor=if items.len()>limit as usize{items.pop();items.last().map(|p|p.id)}else{None};Ok(PageList{items,next_cursor})
 }.await,&id)
}
#[utoipa::path(get,path="/api/v1/pages/{id}",responses((status=200,body=PageDetail)))]
pub async fn read(
    State(s): State<AppState>,
    Extension(id): Extension<RequestId>,
    h: HeaderMap,
    Path(p): Path<Uuid>,
) -> Response {
    response(async{
 let(mut tx,u)=transaction(&s,&h,false).await?;require(&mut tx,&u,p,true,1).await?;
 let page=sqlx::query_as::<_,Page>(r#"
    SELECT p.id, p.knowledge_base_id,
           CASE WHEN page_role($1,p.parent_id)>0 THEN p.parent_id ELSE NULL END parent_id,
           p.title, p.current_revision_id, r.schema_version, r.body_json body, p.body_text,
           page_role($1,p.id) role, p.lock_version, r.editor_id, author.display_name AS author_name,
           to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS last_edited_at,
           (SELECT COALESCE(sum(v.view_count), 0)::bigint FROM recent_visits v WHERE v.page_id=p.id) AS view_count
    FROM pages p JOIN page_revisions r ON r.id=p.current_revision_id
    JOIN users author ON author.id=p.created_by WHERE p.id=$2
 "#).bind(u.id).bind(p).fetch_one(&mut *tx).await?;
 let breadcrumbs=sqlx::query_as::<_,PageLink>("WITH RECURSIVE a AS(SELECT id,parent_id,title,0 depth FROM pages WHERE id=$1 UNION ALL SELECT p.id,p.parent_id,p.title,a.depth+1 FROM pages p JOIN a ON p.id=a.parent_id WHERE a.depth<64) SELECT id,title FROM a WHERE page_role($2,id)>0 ORDER BY depth DESC").bind(p).bind(u.id).fetch_all(&mut *tx).await?;
 if u.is_system_admin{audit(&mut tx,Some(u.id),audit_action::PAGES_ADMIN_READ,Some(p),&id.0,serde_json::json!({})).await?;tx.commit().await?;}
 Ok(PageDetail{page,breadcrumbs})
 }.await,&id)
}
#[utoipa::path(post,path="/api/v1/pages/{id}/revisions",request_body=SavePage,responses((status=200,body=Saved),(status=409,body=crate::http::ApiError)))]
pub async fn save(
    State(s): State<AppState>,
    Extension(id): Extension<RequestId>,
    h: HeaderMap,
    Path(p): Path<Uuid>,
    Json(v): Json<SavePage>,
) -> Response {
    response(
        async {
            let text = content(&v.content)?;
            if v.summary.as_ref().is_some_and(|s| s.len() > 1000) {
                return Err(invalid());
            }
            let (mut tx, u) = transaction(&s, &h, true).await?;
            let (_, current, _) = lock_page(&mut tx, &u, p, 2).await?;
            let scope = format!("save:{p}");
            let hash = fingerprint(&v);
            if let Some(r) = replay(&mut tx, u.id, &scope, v.request_id, &hash).await? {
                return Ok(r);
            }
            crate::edit_leases::require_owned(&mut tx, p, u.id, v.lease_id).await?;
            if current != v.base_revision_id {
                return Err(conflict(
                    error_code::REVISION_CONFLICT,
                    message::REVISION_CONFLICT,
                ));
            }
            let saved = append(
                &mut tx,
                &u,
                p,
                &v.content,
                &text,
                v.summary.as_deref().unwrap_or(""),
                None,
            )
            .await?;
            crate::edit_leases::release_owned(&mut tx, p, u.id, v.lease_id).await?;
            let value = serde_json::to_value(saved).unwrap();
            remember(&mut tx, u.id, &scope, v.request_id, &hash, &value).await?;
            audit(
                &mut tx,
                Some(u.id),
                audit_action::PAGES_SAVE,
                Some(p),
                &id.0,
                serde_json::json!({}),
            )
            .await?;
            tx.commit().await?;
            Ok(value)
        }
        .await,
        &id,
    )
}
#[utoipa::path(get,path="/api/v1/shared-pages",params(("limit"=Option<i64>,Query),("cursor"=Option<Uuid>,Query)),responses((status=200,body=PageList)))]
pub async fn shared(
    State(s): State<AppState>,
    Extension(id): Extension<RequestId>,
    h: HeaderMap,
    Query(q): Query<crate::knowledge::Pagination>,
) -> Response {
    response(async{let(mut tx,u)=transaction(&s,&h,false).await?;let limit=q.limit.unwrap_or(20);if !(1..=100).contains(&limit){return Err(invalid());}let mut items=sqlx::query_as::<_,PageSummary>("SELECT id,title,position,page_role($1,id) role,EXISTS(SELECT 1 FROM pages c WHERE c.parent_id=p.id AND c.deleted_at IS NULL AND page_role($1,c.id)>0) has_children FROM pages p WHERE deleted_at IS NULL AND page_role($1,id)>0 AND (COALESCE(kb_role($1,knowledge_base_id),0)=0 OR (parent_id IS NOT NULL AND COALESCE(page_role($1,parent_id),0)=0)) AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3").bind(u.id).bind(q.cursor).bind(limit+1).fetch_all(&mut *tx).await?;let next_cursor=if items.len()>limit as usize{items.pop();items.last().map(|p|p.id)}else{None};Ok(PageList{items,next_cursor})}.await,&id)
}
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/v1/knowledge-bases/{id}/pages", get(tree).post(create))
        .route("/api/v1/pages/{id}", get(read).delete(crate::trash::delete))
        .route(
            "/api/v1/pages/{id}/revisions",
            post(save).get(crate::history::list),
        )
        .route("/api/v1/shared-pages", get(shared))
}
