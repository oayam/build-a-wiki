use crate::constants::{attachment_status, job_kind, message};
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
    let id =
        Uuid::parse_str(key).map_err(|_| std::io::Error::other(message::INVALID_STORAGE_KEY))?;
    if id.to_string() != key {
        return Err(std::io::Error::other(message::INVALID_STORAGE_KEY));
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
    // Manual retries cannot bypass upload grace time or trash retention.
    if let Some(resource) = payload["id"].as_str().and_then(|s| Uuid::parse_str(s).ok()) {
        let wait=match kind.as_str(){
            job_kind::EXPIRE_UPLOAD=>sqlx::query_scalar::<_,f64>("SELECT extract(epoch FROM created_at+interval '1 hour'-now())::float8 FROM attachments WHERE id=$1 AND status='pending' AND created_at>now()-interval '1 hour'").bind(resource).fetch_optional(&mut *tx).await?,
            job_kind::PURGE_BATCH=>sqlx::query_scalar::<_,f64>("SELECT extract(epoch FROM max(deleted_at)+interval '30 days'-now())::float8 FROM pages WHERE deletion_batch_id=$1 HAVING max(deleted_at)>now()-interval '30 days'").bind(resource).fetch_optional(&mut *tx).await?,
            _=>None,
        };
        if let Some(wait) = wait {
            sqlx::query("UPDATE jobs SET available_at=now()+make_interval(secs=>$2) WHERE id=$1")
                .bind(id)
                .bind(wait + 1.0)
                .execute(&mut *tx)
                .await?;
            tx.commit().await?;
            return Ok(true);
        }
    }
    sqlx::query("SAVEPOINT job_effect")
        .execute(&mut *tx)
        .await?;
    let result = match kind.as_str() {
        job_kind::REMOVE_FILE => remove(root, payload["key"].as_str().unwrap_or("")).await,
        job_kind::PURGE_BATCH => {
            if let Some(b) = payload["id"].as_str().and_then(|v| Uuid::parse_str(v).ok()) {
                crate::trash::purge(&mut tx, b)
                    .await
                    .map_err(|_| std::io::Error::other(message::PURGE_FAILED))
            } else {
                Err(std::io::Error::other(message::INVALID_BATCH))
            }
        }
        job_kind::EXPIRE_UPLOAD => {
            let a = payload["id"].as_str().and_then(|v| Uuid::parse_str(v).ok());
            if let Some(a) = a {
                let row: Option<(String, String)> = sqlx::query_as(
                    "SELECT storage_key,status FROM attachments WHERE id=$1 FOR UPDATE",
                )
                .bind(a)
                .fetch_optional(&mut *tx)
                .await?;
                if let Some((key, status)) = row {
                    if status == attachment_status::PENDING {
                        let r = remove(root, &key).await;
                        if r.is_ok() {
                            sqlx::query("DELETE FROM attachments WHERE id=$1")
                                .bind(a)
                                .execute(&mut *tx)
                                .await?;
                        }
                        r
                    } else {
                        Ok(())
                    }
                } else {
                    Ok(())
                }
            } else {
                Err(std::io::Error::other(message::INVALID_UPLOAD_JOB))
            }
        }
        _ => Err(std::io::Error::other(message::UNSUPPORTED_JOB)),
    };
    match result {
        Ok(()) => {
            sqlx::query("UPDATE jobs SET completed_at=now(),last_error=NULL WHERE id=$1")
                .bind(id)
                .execute(&mut *tx)
                .await?;
        }
        Err(_) => {
            sqlx::query("ROLLBACK TO SAVEPOINT job_effect")
                .execute(&mut *tx)
                .await?;
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
