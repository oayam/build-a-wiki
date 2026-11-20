use crate::{
    auth::*,
    http::{AppState, RequestId},
    pages::{PageLink, response},
    permissions::require,
};
use axum::{
    Router,
    extract::{Extension, Path, State},
    http::HeaderMap,
    response::Response,
    routing::{get, put},
};
use uuid::Uuid;
#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct RecordedVisit {
    pub ok: bool,
    pub view_count: i64,
}
#[utoipa::path(put,operation_id="record_visit",path="/api/v1/pages/{id}/visit",responses((status=200,body=RecordedVisit)))]
pub async fn visit(
    State(s): State<AppState>,
    Extension(id): Extension<RequestId>,
    h: HeaderMap,
    Path(p): Path<Uuid>,
) -> Response {
    response(
        async {
            let (mut tx, u) = transaction(&s, &h, true).await?;
            require(&mut tx, &u, p, true, 1).await?;
            sqlx::query(
                "INSERT INTO recent_visits(user_id, page_id) VALUES ($1, $2)
                     ON CONFLICT(user_id, page_id) DO UPDATE
                     SET visited_at=now(), view_count=recent_visits.view_count+1",
            )
            .bind(u.id)
            .bind(p)
            .execute(&mut *tx)
            .await?;
            let view_count = sqlx::query_scalar(
                "SELECT sum(view_count)::bigint FROM recent_visits WHERE page_id=$1",
            )
            .bind(p)
            .fetch_one(&mut *tx)
            .await?;
            tx.commit().await?;
            Ok(RecordedVisit {
                ok: true,
                view_count,
            })
        }
        .await,
        &id,
    )
}
#[utoipa::path(get,operation_id="recent_visits",path="/api/v1/recent-visits",responses((status=200,body=Vec<PageLink>)))]
pub async fn list(
    State(s): State<AppState>,
    Extension(id): Extension<RequestId>,
    h: HeaderMap,
) -> Response {
    response(async{let(mut tx,u)=transaction(&s,&h,false).await?;Ok(sqlx::query_as::<_,PageLink>("SELECT p.id,p.title FROM recent_visits r JOIN pages p ON p.id=r.page_id WHERE r.user_id=$1 AND p.deleted_at IS NULL AND page_role($1,p.id)>0 ORDER BY r.visited_at DESC,r.page_id LIMIT 20").bind(u.id).fetch_all(&mut *tx).await?)}.await,&id)
}
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/v1/recent-visits", get(list))
        .route("/api/v1/pages/{id}/visit", put(visit))
}
