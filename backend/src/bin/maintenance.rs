#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mode = std::env::args().nth(1).ok_or("use on|off|status")?;
    let pool = wiki_api::pool(&std::env::var("DATABASE_URL")?).await?;
    let mut tx = pool.begin().await?;
    wiki_api::identity::guard(&mut tx).await?;
    let old: bool = sqlx::query_scalar("SELECT maintenance FROM auth_guard WHERE id=1")
        .fetch_one(&mut *tx)
        .await?;
    match mode.as_str() {
        "on" | "off" => {
            sqlx::query("UPDATE auth_guard SET maintenance=$1 WHERE id=1")
                .bind(mode == "on")
                .execute(&mut *tx)
                .await?;
            wiki_api::identity::audit(
                &mut tx,
                None,
                "system.maintenance",
                None,
                &uuid::Uuid::new_v4().to_string(),
                serde_json::json!({}),
            )
            .await?;
        }
        "status" => {}
        _ => return Err("use on|off|status".into()),
    };
    tx.commit().await?;
    println!("{}", if old { "on" } else { "off" });
    pool.close().await;
    Ok(())
}
