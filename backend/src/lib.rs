use sqlx::{PgPool, postgres::PgPoolOptions};
use std::time::Duration;
pub static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");
pub async fn pool(url: &str) -> Result<PgPool, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(10)
        .acquire_timeout(Duration::from_secs(3))
        .connect(url)
        .await
}
pub mod admin;
pub mod auth;
pub mod body;
pub mod http;
pub mod identity;
pub mod knowledge;
pub mod permissions;
