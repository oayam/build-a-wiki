use sqlx::{Postgres, Transaction};
use std::path::{Path, PathBuf};
use uuid::Uuid;
pub async fn enqueue(
    tx: &mut Transaction<'_, Postgres>,
    kind: &str,
    key: &str,
    payload: serde_json::Value,
    delay: i32,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO jobs(id,kind,dedupe_key,payload,available_at) VALUES($1,$2,$3,$4,now()+make_interval(secs=>$5)) ON CONFLICT(dedupe_key) DO NOTHING").bind(Uuid::new_v4()).bind(kind).bind(key).bind(payload).bind(delay as f64).execute(&mut **tx).await?;
    Ok(())
}
pub fn file_path(root: &Path, key: &str) -> std::io::Result<PathBuf> {
    let id = Uuid::parse_str(key).map_err(|_| std::io::Error::other("invalid storage key"))?;
    if id.to_string() != key {
        return Err(std::io::Error::other("invalid storage key"));
    }
    Ok(root.join(key))
}
pub async fn remove(root: &Path, key: &str) -> std::io::Result<()> {
    match tokio::fs::remove_file(file_path(root, key)?).await {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        r => r,
    }
}
/// The transaction owns the claim until completion. A crash releases it immediately;
/// filesystem deletion is idempotent, so replay after a crash is safe.
pub async fn tick(pool: &sqlx::PgPool, root: &Path) -> Result<bool, sqlx::Error> {
    let mut tx = pool.begin().await?;
    crate::identity::guard(&mut tx).await?;
    let maintenance: bool = sqlx::query_scalar("SELECT maintenance FROM auth_guard WHERE id=1")
        .fetch_one(&mut *tx)
        .await?;
    if maintenance {
        return Ok(false);
    }
    let job:Option<(Uuid,String,serde_json::Value,i32)>=sqlx::query_as("SELECT id,kind,payload,attempts FROM jobs WHERE completed_at IS NULL AND available_at<=now() ORDER BY available_at,id FOR UPDATE SKIP LOCKED LIMIT 1").fetch_optional(&mut *tx).await?;
    let Some((id, kind, payload, attempts)) = job else {
        return Ok(false);
    };
    let result = match kind.as_str() {
        "remove_file" => remove(root, payload["key"].as_str().unwrap_or("")).await,
        _ => Err(std::io::Error::other("unsupported job")),
    };
    match result {
        Ok(()) => {
            sqlx::query("UPDATE jobs SET completed_at=now(),last_error=NULL WHERE id=$1")
                .bind(id)
                .execute(&mut *tx)
                .await?;
        }
        Err(_) => {
            let delay = 2_i32.pow(attempts.min(11) as u32).min(3600);
            sqlx::query("UPDATE jobs SET attempts=attempts+1,last_error='task failed; check storage and task kind',available_at=now()+make_interval(secs=>$2) WHERE id=$1").bind(id).bind(delay as f64).execute(&mut *tx).await?;
        }
    }
    tx.commit().await?;
    Ok(true)
}
pub async fn run(pool: sqlx::PgPool, root: PathBuf, mut stop: tokio::sync::watch::Receiver<bool>) {
    loop {
        if *stop.borrow() {
            break;
        }
        if let Err(e) = tick(&pool, &root).await {
            tracing::error!(error=%e,"background task failed");
        }
        tokio::select! {_=stop.changed()=>{},_=tokio::time::sleep(std::time::Duration::from_secs(1))=>{}}
    }
}
