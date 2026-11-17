use crate::constants::{acl_mode, audit_action, error_code, message};
use crate::{
    admin::text,
    auth::*,
    http::{AppState, RequestId},
    identity::audit,
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
use sqlx::FromRow;
use utoipa::ToSchema;
use uuid::Uuid;
#[derive(Serialize, FromRow, ToSchema)]
pub struct KnowledgeBase {
    pub id: Uuid,
    pub name: String,
    pub owner_id: Uuid,
    pub acl_version: i64,
    pub role: i16,
}
#[derive(Deserialize, ToSchema)]
pub struct Name {
    pub name: String,
}
#[derive(Deserialize, ToSchema)]
pub struct Transfer {
    pub owner_id: Uuid,
}
#[derive(Deserialize)]
pub struct Pagination {
    pub limit: Option<i64>,
    pub cursor: Option<Uuid>,
}
#[derive(Serialize, ToSchema)]
pub struct KnowledgeList {
    pub items: Vec<KnowledgeBase>,
    pub next_cursor: Option<Uuid>,
}
#[derive(Serialize, Deserialize, FromRow, ToSchema)]
pub struct Entry {
    pub user_id: Option<Uuid>,
    pub group_id: Option<Uuid>,
    pub role: i16,
}
#[derive(Serialize, ToSchema)]
pub struct Permissions {
    pub role: i16,
    pub source: String,
    pub inherited: bool,
    pub acl_mode: String,
    pub acl_version: i64,
    pub entries: Option<Vec<Entry>>,
}
#[derive(Deserialize, ToSchema)]
pub struct PermissionUpdate {
    pub acl_version: i64,
    pub acl_mode: Option<String>,
    pub entries: Vec<Entry>,
}
#[derive(Serialize, FromRow, ToSchema)]
pub struct Subject {
    pub id: Uuid,
    pub name: String,
    pub kind: String,
}
fn response<T: Serialize>(r: Result<T>, id: &RequestId) -> Response {
    match r {
        Ok(v) => Json(v).into_response(),
        Err(e) => e.response(id),
    }
}
#[utoipa::path(get,path="/api/v1/knowledge-bases",params(("limit"=Option<i64>,Query),("cursor"=Option<Uuid>,Query)),responses((status=200,body=KnowledgeList)))]
pub async fn list(
    State(s): State<AppState>,
    Extension(id): Extension<RequestId>,
    h: HeaderMap,
    Query(q): Query<Pagination>,
) -> Response {
    response(async{let(mut tx,u)=transaction(&s,&h,false).await?;let limit=q.limit.unwrap_or(20);if !(1..=100).contains(&limit){return Err(invalid());}let mut items=sqlx::query_as::<_,KnowledgeBase>("SELECT id,name,owner_id,acl_version,kb_role($1,id) AS role FROM knowledge_bases WHERE kb_role($1,id)>0 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3").bind(u.id).bind(q.cursor).bind(limit+1).fetch_all(&mut *tx).await?;let next_cursor=if items.len()>limit as usize{items.pop();items.last().map(|k|k.id)}else{None};Ok(KnowledgeList{items,next_cursor})}.await,&id)
}
#[utoipa::path(post,path="/api/v1/knowledge-bases",request_body=Name,responses((status=200,body=KnowledgeBase)))]
pub async fn create(
    State(s): State<AppState>,
    Extension(id): Extension<RequestId>,
    h: HeaderMap,
    Json(v): Json<Name>,
) -> Response {
    response(
        async {
            let (mut tx, u) = transaction(&s, &h, true).await?;
            text(&v.name, 100)?;
            let k = Uuid::new_v4();
            sqlx::query("INSERT INTO knowledge_bases(id,name,owner_id) VALUES($1,$2,$3)")
                .bind(k)
                .bind(&v.name)
                .bind(u.id)
                .execute(&mut *tx)
                .await?;
            audit(
                &mut tx,
                Some(u.id),
                audit_action::KNOWLEDGE_BASES_CREATE,
                Some(k),
                &id.0,
                serde_json::json!({}),
            )
            .await?;
            tx.commit().await?;
            Ok(KnowledgeBase {
                id: k,
                name: v.name,
                owner_id: u.id,
                acl_version: 1,
                role: 3,
            })
        }
        .await,
        &id,
    )
}
#[utoipa::path(get,path="/api/v1/knowledge-bases/{id}",responses((status=200,body=KnowledgeBase)))]
pub async fn detail(
    State(s): State<AppState>,
    Extension(id): Extension<RequestId>,
    h: HeaderMap,
    Path(k): Path<Uuid>,
) -> Response {
    response(async{let(mut tx,u)=transaction(&s,&h,false).await?;require(&mut tx,&u,k,false,1).await?;let row=sqlx::query_as::<_,KnowledgeBase>("SELECT id,name,owner_id,acl_version,kb_role($1,id) AS role FROM knowledge_bases WHERE id=$2").bind(u.id).bind(k).fetch_one(&mut *tx).await?;if u.is_system_admin{audit(&mut tx,Some(u.id),audit_action::KNOWLEDGE_BASES_ADMIN_READ,Some(k),&id.0,serde_json::json!({})).await?;tx.commit().await?;}Ok(row)}.await,&id)
}
#[utoipa::path(patch,path="/api/v1/knowledge-bases/{id}",request_body=Name,responses((status=200,body=serde_json::Value)))]
pub async fn rename(
    State(s): State<AppState>,
    Extension(id): Extension<RequestId>,
    h: HeaderMap,
    Path(k): Path<Uuid>,
    Json(v): Json<Name>,
) -> Response {
    response(
        async {
            let (mut tx, u) = transaction(&s, &h, true).await?;
            require(&mut tx, &u, k, false, 3).await?;
            text(&v.name, 100)?;
            sqlx::query("UPDATE knowledge_bases SET name=$2 WHERE id=$1")
                .bind(k)
                .bind(v.name)
                .execute(&mut *tx)
                .await?;
            audit(
                &mut tx,
                Some(u.id),
                audit_action::KNOWLEDGE_BASES_RENAME,
                Some(k),
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
#[utoipa::path(post,path="/api/v1/knowledge-bases/{id}/transfer-ownership",request_body=Transfer,responses((status=200,body=serde_json::Value)))]
pub async fn transfer(
    State(s): State<AppState>,
    Extension(id): Extension<RequestId>,
    h: HeaderMap,
    Path(k): Path<Uuid>,
    Json(v): Json<Transfer>,
) -> Response {
    response(
        async {
            let (mut tx, u) = transaction(&s, &h, true).await?;
            require(&mut tx, &u, k, false, 3).await?;
            let owner: Uuid =
                sqlx::query_scalar("SELECT owner_id FROM knowledge_bases WHERE id=$1 FOR UPDATE")
                    .bind(k)
                    .fetch_one(&mut *tx)
                    .await?;
            if !u.is_system_admin && u.id != owner {
                return Err(denied());
            }
            let active: bool =
                sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users WHERE id=$1 AND active)")
                    .bind(v.owner_id)
                    .fetch_one(&mut *tx)
                    .await?;
            if !active {
                return Err(invalid());
            }
            sqlx::query(
                "UPDATE knowledge_bases SET owner_id=$2,acl_version=acl_version+1 WHERE id=$1",
            )
            .bind(k)
            .bind(v.owner_id)
            .execute(&mut *tx)
            .await?;
            audit(
                &mut tx,
                Some(u.id),
                audit_action::KNOWLEDGE_BASES_TRANSFER,
                Some(k),
                &id.0,
                serde_json::json!({"owner_id":v.owner_id}),
            )
            .await?;
            tx.commit().await?;
            Ok(serde_json::json!({"ok":true}))
        }
        .await,
        &id,
    )
}
async fn get_permissions(
    s: AppState,
    id: RequestId,
    h: HeaderMap,
    k: Uuid,
    page: bool,
) -> Response {
    response(async{
 let(mut tx,u)=transaction(&s,&h,false).await?;let role=require(&mut tx,&u,k,page,1).await?;
 let(mode,version):(String,i64)=if page{sqlx::query_as("SELECT acl_mode,acl_version FROM pages WHERE id=$1").bind(k).fetch_one(&mut *tx).await?}else{(acl_mode::INDEPENDENT.into(),sqlx::query_scalar("SELECT acl_version FROM knowledge_bases WHERE id=$1").bind(k).fetch_one(&mut *tx).await?)};
 let source=if u.is_system_admin {message::SYSTEM_ADMIN.to_owned()} else {
 let owner:Uuid=sqlx::query_scalar(if page {"SELECT k.owner_id FROM knowledge_bases k JOIN pages p ON p.knowledge_base_id=k.id WHERE p.id=$1"} else {"SELECT owner_id FROM knowledge_bases WHERE id=$1"}).bind(k).fetch_one(&mut *tx).await?;
 if owner==u.id {message::KNOWLEDGE_BASE_OWNER.to_owned()} else if page {
 let boundary:Option<Uuid>=sqlx::query_scalar("WITH RECURSIVE chain AS (SELECT id,parent_id,acl_mode,0 depth FROM pages WHERE id=$1 UNION ALL SELECT p.id,p.parent_id,p.acl_mode,c.depth+1 FROM pages p JOIN chain c ON p.id=c.parent_id WHERE c.depth<64) SELECT id FROM chain WHERE acl_mode='independent' ORDER BY depth LIMIT 1").bind(k).fetch_optional(&mut *tx).await?;
 boundary.map(|id|format!("独立页面授权：{id}")).unwrap_or_else(||message::KNOWLEDGE_BASE_PERMISSION.into())
 } else {message::KNOWLEDGE_BASE_PERMISSION.into()}
 };
 let entries=if role>=3{Some(sqlx::query_as::<_,Entry>(if page{"SELECT user_id,group_id,role FROM page_acl WHERE page_id=$1 ORDER BY id"}else{"SELECT user_id,group_id,role FROM knowledge_base_acl WHERE knowledge_base_id=$1 ORDER BY id"}).bind(k).fetch_all(&mut *tx).await?)}else{None};
 if u.is_system_admin{audit(&mut tx,Some(u.id),audit_action::PERMISSIONS_ADMIN_READ,Some(k),&id.0,serde_json::json!({})).await?;tx.commit().await?;}
 Ok(Permissions{role,source,inherited:page&&mode==acl_mode::INHERIT,acl_mode:mode,acl_version:version,entries})
 }.await,&id)
}
async fn put_permissions(
    s: AppState,
    id: RequestId,
    h: HeaderMap,
    k: Uuid,
    page: bool,
    v: PermissionUpdate,
) -> Response {
    response(async{
 let(mut tx,u)=transaction(&s,&h,true).await?;require(&mut tx,&u,k,page,3).await?;
 if v.entries.len()>100{return Err(invalid());}let mode=v.acl_mode.as_deref().unwrap_or(acl_mode::INDEPENDENT);if !matches!(mode,acl_mode::INHERIT|acl_mode::INDEPENDENT)||(!page&&mode!=acl_mode::INDEPENDENT){return Err(invalid());}
 let current:i64=sqlx::query_scalar(if page{"SELECT acl_version FROM pages WHERE id=$1 FOR UPDATE"}else{"SELECT acl_version FROM knowledge_bases WHERE id=$1 FOR UPDATE"}).bind(k).fetch_one(&mut *tx).await?;
 if current!=v.acl_version{return Err(Failure(StatusCode::CONFLICT,error_code::ACL_CONFLICT,message::ACL_CONFLICT));}
 for e in &v.entries{if e.user_id.is_some()==e.group_id.is_some()||!(1..=3).contains(&e.role){return Err(invalid());}}
 sqlx::query(if page{"DELETE FROM page_acl WHERE page_id=$1"}else{"DELETE FROM knowledge_base_acl WHERE knowledge_base_id=$1"}).bind(k).execute(&mut *tx).await?;
 for e in v.entries{sqlx::query(if page{"INSERT INTO page_acl(id,page_id,user_id,group_id,role) VALUES($1,$2,$3,$4,$5)"}else{"INSERT INTO knowledge_base_acl(id,knowledge_base_id,user_id,group_id,role) VALUES($1,$2,$3,$4,$5)"}).bind(Uuid::new_v4()).bind(k).bind(e.user_id).bind(e.group_id).bind(e.role).execute(&mut *tx).await?;}
 if page{sqlx::query("UPDATE pages SET acl_mode=$2,acl_version=acl_version+1 WHERE id=$1").bind(k).bind(mode).execute(&mut *tx).await?;}else{sqlx::query("UPDATE knowledge_bases SET acl_version=acl_version+1 WHERE id=$1").bind(k).execute(&mut *tx).await?;}
 audit(&mut tx,Some(u.id),audit_action::PERMISSIONS_UPDATE,Some(k),&id.0,serde_json::json!({"acl_version":current+1})).await?;tx.commit().await?;Ok(serde_json::json!({"acl_version":current+1}))
 }.await,&id)
}
#[utoipa::path(get,path="/api/v1/knowledge-bases/{id}/permissions",responses((status=200,body=Permissions)))]
pub async fn kb_permissions(
    State(s): State<AppState>,
    Extension(id): Extension<RequestId>,
    h: HeaderMap,
    Path(k): Path<Uuid>,
) -> Response {
    get_permissions(s, id, h, k, false).await
}
#[utoipa::path(put,path="/api/v1/knowledge-bases/{id}/permissions",request_body=PermissionUpdate,responses((status=200,body=serde_json::Value)))]
pub async fn kb_update(
    State(s): State<AppState>,
    Extension(id): Extension<RequestId>,
    h: HeaderMap,
    Path(k): Path<Uuid>,
    Json(v): Json<PermissionUpdate>,
) -> Response {
    put_permissions(s, id, h, k, false, v).await
}
#[utoipa::path(get,path="/api/v1/pages/{id}/permissions",responses((status=200,body=Permissions)))]
pub async fn page_permissions(
    State(s): State<AppState>,
    Extension(id): Extension<RequestId>,
    h: HeaderMap,
    Path(k): Path<Uuid>,
) -> Response {
    get_permissions(s, id, h, k, true).await
}
#[utoipa::path(put,path="/api/v1/pages/{id}/permissions",request_body=PermissionUpdate,responses((status=200,body=serde_json::Value)))]
pub async fn page_update(
    State(s): State<AppState>,
    Extension(id): Extension<RequestId>,
    h: HeaderMap,
    Path(k): Path<Uuid>,
    Json(v): Json<PermissionUpdate>,
) -> Response {
    put_permissions(s, id, h, k, true, v).await
}
async fn subjects(s: AppState, id: RequestId, h: HeaderMap, k: Uuid, page: bool) -> Response {
    response(async{let(mut tx,u)=transaction(&s,&h,false).await?;require(&mut tx,&u,k,page,3).await?;Ok(sqlx::query_as::<_,Subject>("SELECT id,display_name AS name,'user'::text AS kind FROM users WHERE active UNION ALL SELECT id,name,'group' FROM groups ORDER BY kind,name,id").fetch_all(&mut *tx).await?)}.await,&id)
}
#[utoipa::path(get,path="/api/v1/knowledge-bases/{id}/subjects",responses((status=200,body=Vec<Subject>)))]
pub async fn kb_subjects(
    State(s): State<AppState>,
    Extension(id): Extension<RequestId>,
    h: HeaderMap,
    Path(k): Path<Uuid>,
) -> Response {
    subjects(s, id, h, k, false).await
}
#[utoipa::path(get,path="/api/v1/pages/{id}/subjects",responses((status=200,body=Vec<Subject>)))]
pub async fn page_subjects(
    State(s): State<AppState>,
    Extension(id): Extension<RequestId>,
    h: HeaderMap,
    Path(k): Path<Uuid>,
) -> Response {
    subjects(s, id, h, k, true).await
}
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/v1/knowledge-bases", get(list).post(create))
        .route("/api/v1/knowledge-bases/{id}", get(detail).patch(rename))
        .route(
            "/api/v1/knowledge-bases/{id}/transfer-ownership",
            post(transfer),
        )
        .route(
            "/api/v1/knowledge-bases/{id}/permissions",
            get(kb_permissions).put(kb_update),
        )
        .route(
            "/api/v1/pages/{id}/permissions",
            get(page_permissions).put(page_update),
        )
        .route("/api/v1/knowledge-bases/{id}/subjects", get(kb_subjects))
        .route("/api/v1/pages/{id}/subjects", get(page_subjects))
}
