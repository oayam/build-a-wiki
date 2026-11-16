use crate::auth::{Actor, Result, denied, missing};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;
pub async fn require(
    tx: &mut Transaction<'_, Postgres>,
    actor: &Actor,
    id: Uuid,
    page: bool,
    min: i16,
) -> Result<i16> {
    let sql = if page {
        "SELECT page_role($1,$2)"
    } else {
        "SELECT kb_role($1,$2)"
    };
    let role: Option<i16> = sqlx::query_scalar(sql)
        .bind(actor.id)
        .bind(id)
        .fetch_one(&mut **tx)
        .await?;
    let role = role.unwrap_or(0);
    if role == 0 {
        return Err(missing());
    }
    if role < min {
        return Err(denied());
    }
    Ok(role)
}
