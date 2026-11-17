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
 let mut items=sqlx::query_as::<_,SearchHit>("WITH matched AS MATERIALIZED(SELECT p.id,p.title,left(r.body_text,240) snippet,p.knowledge_base_id,p.updated_at,p.title ILIKE $2 ESCAPE '\\' title_match FROM pages p JOIN page_revisions r ON r.id=p.current_revision_id WHERE p.deleted_at IS NULL AND page_role($1,p.id)>0 AND ($3::uuid IS NULL OR p.knowledge_base_id=$3) AND (($4 IN('all','title') AND p.title ILIKE $2 ESCAPE '\\') OR ($4 IN('all','body') AND r.body_text ILIKE $2 ESCAPE '\\')) AND ($5::uuid IS NULL OR CASE $6 WHEN 'creator' THEN p.created_by=$5 WHEN 'last_editor' THEN r.editor_id=$5 WHEN 'contributor' THEN EXISTS(SELECT 1 FROM page_revisions h WHERE h.page_id=p.id AND h.editor_id=$5) WHEN 'editor_access' THEN page_role($5,p.id)>=2 ELSE false END)) SELECT id,title,snippet,knowledge_base_id,title_match FROM matched m WHERE ($7::uuid IS NULL OR (title_match,updated_at,id)<(SELECT title_match,updated_at,id FROM matched WHERE id=$7)) ORDER BY title_match DESC,updated_at DESC,id DESC LIMIT $8").bind(u.id).bind(pattern(q.q.as_deref().unwrap_or(""))).bind(q.scope).bind(fields).bind(q.person_id).bind(relation).bind(q.cursor).bind(limit+1).fetch_all(&mut *tx).await?;
 let next_cursor=if items.len()>limit as usize{items.pop();items.last().map(|r|r.id)}else{None};if u.is_system_admin{audit(&mut tx,Some(u.id),"search.admin_read",None,&id.0,serde_json::json!({})).await?;tx.commit().await?;}Ok(SearchResults{items,next_cursor})}.await,&id)
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
    response(async{let(mut tx,u)=transaction(&s,&h,false).await?;let q=q.q.unwrap_or_default();if q.len()>200{return Err(invalid());}Ok(sqlx::query_as::<_,Person>("SELECT u.id,u.display_name FROM users u WHERE u.active AND u.display_name ILIKE $2 ESCAPE '\\' AND EXISTS(SELECT 1 FROM pages p WHERE p.deleted_at IS NULL AND page_role($1,p.id)>0 AND (p.created_by=u.id OR EXISTS(SELECT 1 FROM page_revisions r WHERE r.page_id=p.id AND r.editor_id=u.id) OR page_role(u.id,p.id)>=2)) ORDER BY u.display_name,u.id LIMIT 20").bind(u.id).bind(pattern(&q)).fetch_all(&mut *tx).await?)}.await,&id)
}
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/v1/search", get(search))
        .route("/api/v1/search/people", get(people))
}
