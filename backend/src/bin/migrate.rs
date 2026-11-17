use wiki_api::constants::env;
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let url = std::env::var(env::DATABASE_URL)?;
    let pool = wiki_api::pool(&url).await?;
    wiki_api::MIGRATOR.run(&pool).await?;
    pool.close().await;
    Ok(())
}
