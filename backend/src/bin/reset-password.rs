use std::io::Read;
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let name = std::env::args()
        .nth(1)
        .ok_or("usage: reset-password USERNAME < protected-password-file")?;
    let mut password = String::new();
    std::io::stdin().take(258).read_to_string(&mut password)?;
    let hash = wiki_api::identity::hash_password(password.trim_end_matches(['\r', '\n']))
        .map_err(std::io::Error::other)?;
    let pool = wiki_api::pool(&std::env::var("DATABASE_URL")?).await?;
    let mut tx = pool.begin().await?;
    wiki_api::identity::guard(&mut tx).await?;
    let id: uuid::Uuid =
        sqlx::query_scalar("UPDATE users SET password_hash=$2 WHERE username=$1 RETURNING id")
            .bind(name)
            .bind(hash)
            .fetch_one(&mut *tx)
            .await?;
    sqlx::query("UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    wiki_api::identity::audit(
        &mut tx,
        None,
        "users.local_password_reset",
        Some(id),
        &uuid::Uuid::new_v4().to_string(),
        serde_json::json!({}),
    )
    .await?;
    tx.commit().await?;
    pool.close().await;
    println!("密码已更新，旧会话已撤销");
    Ok(())
}
