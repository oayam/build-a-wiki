use wiki_api::http::{AppState, Config, router};
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config = Config::from_env().map_err(std::io::Error::other)?;
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(config.log_level)
        .init();
    let pool = wiki_api::pool(&config.database_url)
        .await
        .map_err(|_| std::io::Error::other("database connection failed"))?;
    tokio::fs::create_dir_all(&config.attachment_dir).await?;
    let listener = tokio::net::TcpListener::bind(config.bind_addr).await?;
    tracing::info!(address=%config.bind_addr,"server started");
    let (stop, stopped) = tokio::sync::watch::channel(false);
    let worker = tokio::spawn(wiki_api::jobs::run(
        pool.clone(),
        config.attachment_dir.clone(),
        stopped,
    ));
    axum::serve(
        listener,
        router(AppState {
            security: wiki_api::auth::Security::from_env().map_err(std::io::Error::other)?,
            pool: pool.clone(),
            attachment_dir: config.attachment_dir,
        }),
    )
    .with_graceful_shutdown(shutdown())
    .await?;
    let _ = stop.send(true);
    worker.await?;
    pool.close().await;
    Ok(())
}
async fn shutdown() {
    let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        .expect("SIGTERM handler");
    tokio::select! { _=tokio::signal::ctrl_c()=>{},_=term.recv()=>{} }
    tracing::info!("graceful shutdown");
}
