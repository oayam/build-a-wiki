use std::io::Read;
use wiki_api::constants::env;
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let username = std::env::args()
        .nth(1)
        .ok_or("usage: bootstrap USERNAME < password-file")?;
    let mut password = String::new();
    std::io::stdin().take(258).read_to_string(&mut password)?;
    let pool = wiki_api::pool(&std::env::var(env::DATABASE_URL)?).await?;
    let id =
        wiki_api::identity::bootstrap(&pool, &username, password.trim_end_matches(['\n', '\r']))
            .await
            .map_err(std::io::Error::other)?;
    println!("管理员初始化成功：{id}");
    pool.close().await;
    Ok(())
}
