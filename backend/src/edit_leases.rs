use crate::{
    auth::{Result, transaction},
    constants::{error_code, message},
    http::{AppState, RequestId},
    pages::{conflict, lock_page, response},
};
use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::HeaderMap,
    response::Response,
    routing::put,
};
use serde::Deserialize;
use sqlx::{Postgres, Transaction};
use utoipa::ToSchema;
use uuid::Uuid;

const LEASE_SECONDS: i32 = 90;

#[derive(Deserialize, ToSchema)]
pub struct EditLease {
    pub lease_id: Uuid,
    /// Renew only a still-live lease. A delayed heartbeat cannot reacquire a page.
    #[serde(default)]
    pub renew: bool,
}

#[utoipa::path(put, path="/api/v1/pages/{id}/edit-lease", request_body=EditLease, responses((status=200,body=i32),(status=409,body=crate::http::ApiError)))]
pub async fn acquire(
    State(s): State<AppState>,
    Extension(id): Extension<RequestId>,
    h: HeaderMap,
    Path(p): Path<Uuid>,
    Json(v): Json<EditLease>,
) -> Response {
    response(async {
        let (mut tx, u) = transaction(&s, &h, true).await?;
        lock_page(&mut tx, &u, p, 2).await?;
        let statement = if v.renew {
            "UPDATE page_edit_leases SET expires_at=clock_timestamp()+make_interval(secs=>$4)
             WHERE page_id=$1 AND user_id=$2 AND lease_id=$3 AND expires_at>clock_timestamp()"
        } else {
            "INSERT INTO page_edit_leases AS lease(page_id,user_id,lease_id,expires_at)
             VALUES($1,$2,$3,clock_timestamp()+make_interval(secs=>$4))
             ON CONFLICT(page_id) DO UPDATE SET user_id=excluded.user_id, lease_id=excluded.lease_id,
                 expires_at=excluded.expires_at
             WHERE lease.expires_at<=clock_timestamp()
                OR (lease.user_id=excluded.user_id AND lease.lease_id=excluded.lease_id)"
        };
        let result = sqlx::query(statement)
            .bind(p)
            .bind(u.id)
            .bind(v.lease_id)
            .bind(f64::from(LEASE_SECONDS))
            .execute(&mut *tx)
            .await?;
        if result.rows_affected() == 0 {
            let reason = if v.renew { message::LEASE_LOST } else { message::PAGE_BUSY };
            return Err(conflict(error_code::EDIT_LEASE, reason));
        }
        tx.commit().await?;
        Ok(LEASE_SECONDS)
    }.await,&id)
}

pub async fn release_owned(
    tx: &mut Transaction<'_, Postgres>,
    page: Uuid,
    user: Uuid,
    lease: Uuid,
) -> Result<()> {
    sqlx::query("DELETE FROM page_edit_leases WHERE page_id=$1 AND user_id=$2 AND lease_id=$3")
        .bind(page)
        .bind(user)
        .bind(lease)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

#[utoipa::path(delete, path="/api/v1/pages/{id}/edit-lease", request_body=EditLease, responses((status=200,body=bool)))]
pub async fn release(
    State(s): State<AppState>,
    Extension(id): Extension<RequestId>,
    h: HeaderMap,
    Path(p): Path<Uuid>,
    Json(v): Json<EditLease>,
) -> Response {
    response(
        async {
            let (mut tx, u) = transaction(&s, &h, true).await?;
            release_owned(&mut tx, p, u.id, v.lease_id).await?;
            tx.commit().await?;
            Ok(true)
        }
        .await,
        &id,
    )
}

// Call with the page locked, in the same transaction as the protected write.
pub async fn require_owned(
    tx: &mut Transaction<'_, Postgres>,
    page: Uuid,
    user: Uuid,
    lease: Uuid,
) -> Result<()> {
    let owned: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM page_edit_leases
        WHERE page_id=$1 AND user_id=$2 AND lease_id=$3 AND expires_at>clock_timestamp())",
    )
    .bind(page)
    .bind(user)
    .bind(lease)
    .fetch_one(&mut **tx)
    .await?;
    if !owned {
        return Err(conflict(error_code::EDIT_LEASE, message::LEASE_LOST));
    }
    Ok(())
}

pub async fn require_idle(tx: &mut Transaction<'_, Postgres>, page: Uuid) -> Result<()> {
    let busy: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM page_edit_leases
        WHERE page_id=$1 AND expires_at>clock_timestamp())",
    )
    .bind(page)
    .fetch_one(&mut **tx)
    .await?;
    if busy {
        return Err(conflict(error_code::EDIT_LEASE, message::PAGE_BUSY));
    }
    Ok(())
}

pub fn routes() -> Router<AppState> {
    Router::new().route(
        "/api/v1/pages/{id}/edit-lease",
        put(acquire).delete(release),
    )
}
