use crate::constants::audit_action;
use crate::{
    auth::*,
    http::{AppState, RequestId},
    identity::audit,
    pages::response,
};
use axum::{
    Router,
    extract::{Extension, Query, State},
    http::HeaderMap,
    response::Response,
    routing::get,
};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use utoipa::ToSchema;
use uuid::Uuid;
#[derive(Deserialize)]
pub struct SearchQuery {
    pub q: Option<String>,
    pub scope: Option<Uuid>,
    pub fields: Option<String>,
    pub person_id: Option<Uuid>,
    pub relation: Option<String>,
    pub cursor: Option<Uuid>,
    pub limit: Option<i64>,
}
#[derive(Serialize, FromRow, ToSchema)]
pub struct SearchHit {
    pub id: Uuid,
    pub title: String,
    pub snippet: String,
    pub knowledge_base_id: Uuid,
    pub title_match: bool,
}
#[derive(Serialize, ToSchema)]
pub struct SearchResults {
    pub items: Vec<SearchHit>,
    pub next_cursor: Option<Uuid>,
}
#[derive(Serialize, FromRow, ToSchema)]
pub struct Person {
    pub id: Uuid,
    pub display_name: String,
}
fn pattern(q: &str) -> String {
    format!(
        "%{}%",
        q.replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_")
    )
}
#[utoipa::path(get,operation_id="search_pages",path="/api/v1/search",params(("q"=Option<String>,Query),("scope"=Option<Uuid>,Query),("fields"=Option<String>,Query),("person_id"=Option<Uuid>,Query),("relation"=Option<String>,Query),("cursor"=Option<Uuid>,Query),("limit"=Option<i64>,Query)),responses((status=200,body=SearchResults)))]
pub async fn search(
    State(s): State<AppState>,
    Extension(id): Extension<RequestId>,
    h: HeaderMap,
    Query(q): Query<SearchQuery>,
) -> Response {
    response(async{let(mut tx,u)=transaction(&s,&h,false).await?;let fields=q.fields.as_deref().unwrap_or("all");let relation=q.relation.as_deref().unwrap_or("creator");let limit=q.limit.unwrap_or(20);if !["title","body","all"].contains(&fields)||!["creator","last_editor","contributor","editor_access"].contains(&relation)||!(1..=100).contains(&limit)||q.q.as_ref().is_some_and(|v|v.chars().count()>200){return Err(invalid());}
 let mut items=sqlx::query_as::<_,SearchHit>("WITH cursor_page AS (SELECT id,updated_at,title ILIKE $2 ESCAPE '\\' title_match FROM pages WHERE id=$7 AND page_role($1,id)>0), candidates AS ((SELECT p.id,p.title,p.knowledge_base_id,r.id revision_id,p.updated_at,true title_match FROM pages p JOIN page_revisions r ON r.id=p.current_revision_id WHERE p.title ILIKE $2 ESCAPE '\\' AND ($4!='body' OR r.body_text ILIKE $2 ESCAPE '\\') AND p.deleted_at IS NULL AND ($3::uuid IS NULL OR p.knowledge_base_id=$3) AND page_role($1,p.id)>0 AND ($5::uuid IS NULL OR CASE $6 WHEN 'creator' THEN p.created_by=$5 WHEN 'last_editor' THEN r.editor_id=$5 WHEN 'contributor' THEN EXISTS(SELECT 1 FROM page_revisions h WHERE h.page_id=p.id AND h.editor_id=$5) WHEN 'editor_access' THEN page_role($5,p.id)>=2 ELSE false END) AND ($7::uuid IS NULL OR (true,p.updated_at,p.id)<(SELECT title_match,updated_at,id FROM cursor_page)) ORDER BY p.updated_at DESC,p.id DESC LIMIT $8) UNION ALL (SELECT p.id,p.title,p.knowledge_base_id,r.id revision_id,p.updated_at,false title_match FROM pages p JOIN page_revisions r ON r.id=p.current_revision_id WHERE p.title NOT ILIKE $2 ESCAPE '\\' AND $4!='title' AND r.body_text ILIKE $2 ESCAPE '\\' AND p.deleted_at IS NULL AND ($3::uuid IS NULL OR p.knowledge_base_id=$3) AND page_role($1,p.id)>0 AND ($5::uuid IS NULL OR CASE $6 WHEN 'creator' THEN p.created_by=$5 WHEN 'last_editor' THEN r.editor_id=$5 WHEN 'contributor' THEN EXISTS(SELECT 1 FROM page_revisions h WHERE h.page_id=p.id AND h.editor_id=$5) WHEN 'editor_access' THEN page_role($5,p.id)>=2 ELSE false END) AND ($7::uuid IS NULL OR (false,p.updated_at,p.id)<(SELECT title_match,updated_at,id FROM cursor_page)) ORDER BY p.updated_at DESC,p.id DESC LIMIT $8)) SELECT c.id,c.title,left(r.body_text,240) snippet,c.knowledge_base_id,c.title_match FROM candidates c JOIN page_revisions r ON r.id=c.revision_id ORDER BY c.title_match DESC,c.updated_at DESC,c.id DESC LIMIT $8").bind(u.id).bind(pattern(q.q.as_deref().unwrap_or(""))).bind(q.scope).bind(fields).bind(q.person_id).bind(relation).bind(q.cursor).bind(limit+1).fetch_all(&mut *tx).await?;
 let next_cursor=if items.len()>limit as usize{items.pop();items.last().map(|r|r.id)}else{None};if u.is_system_admin{audit(&mut tx,Some(u.id),audit_action::SEARCH_ADMIN_READ,None,&id.0,serde_json::json!({})).await?;tx.commit().await?;}Ok(SearchResults{items,next_cursor})}.await,&id)
}
#[derive(Deserialize)]
pub struct PeopleQuery {
    pub q: Option<String>,
}
#[utoipa::path(get,operation_id="search_people",path="/api/v1/search/people",params(("q"=Option<String>,Query)),responses((status=200,body=Vec<Person>)))]
pub async fn people(
    State(s): State<AppState>,
    Extension(id): Extension<RequestId>,
    h: HeaderMap,
    Query(q): Query<PeopleQuery>,
) -> Response {
    response(async{let(mut tx,u)=transaction(&s,&h,false).await?;let q=q.q.unwrap_or_default();if q.len()>200{return Err(invalid());}Ok(sqlx::query_as::<_,Person>("WITH visible AS MATERIALIZED(SELECT p.* FROM page_access($1) v JOIN pages p ON p.id=v.id) SELECT u.id,u.display_name FROM users u WHERE u.active AND u.display_name ILIKE $2 ESCAPE '\\' AND EXISTS(SELECT 1 FROM visible p WHERE (p.created_by=u.id OR EXISTS(SELECT 1 FROM page_revisions r WHERE r.page_id=p.id AND r.editor_id=u.id) OR page_role(u.id,p.id)>=2)) ORDER BY u.display_name,u.id LIMIT 20").bind(u.id).bind(pattern(&q)).fetch_all(&mut *tx).await?)}.await,&id)
}
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/v1/search", get(search))
        .route("/api/v1/search/people", get(people))
}
