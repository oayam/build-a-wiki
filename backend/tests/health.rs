use axum::{
    body::{Body, to_bytes},
    http::Request,
};
use tower::ServiceExt;
use wiki_api::http::{AppState, router};
#[tokio::test]
async fn readiness_checks_migrations_storage_and_database() {
    let url = std::env::var("TEST_DATABASE_URL").expect("TEST_DATABASE_URL required");
    let admin = wiki_api::pool(&url).await.unwrap();
    let schema = format!("health_{}", uuid::Uuid::new_v4().simple());
    sqlx::query(&format!("CREATE SCHEMA {schema}"))
        .execute(&admin)
        .await
        .unwrap();
    let path = schema.clone();
    let pool = sqlx::postgres::PgPoolOptions::new()
        .after_connect(move |c, _| {
            let q = format!("SET search_path TO {path}");
            Box::pin(async move {
                sqlx::query(&q).execute(c).await?;
                Ok(())
            })
        })
        .connect(&url)
        .await
        .unwrap();
    let dir = std::env::temp_dir().join(&schema);
    tokio::fs::create_dir(&dir).await.unwrap();
    let app = router(AppState {
        pool: pool.clone(),
        attachment_dir: dir.clone(),
        security: wiki_api::auth::Security::default(),
    });
    async fn check(app: axum::Router, expected: u16) {
        let r = app
            .oneshot(
                Request::builder()
                    .uri("/health/ready")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(r.status().as_u16(), expected);
        let id = r.headers()["x-request-id"].to_str().unwrap().to_owned();
        let json: serde_json::Value =
            serde_json::from_slice(&to_bytes(r.into_body(), 8192).await.unwrap()).unwrap();
        if expected == 503 {
            assert_eq!(json["code"], "NOT_READY");
            assert_eq!(json["request_id"], id);
            assert_eq!(json["details"], serde_json::json!({}));
        }
    }
    check(app.clone(), 503).await;
    wiki_api::MIGRATOR.run(&pool).await.unwrap();
    check(app.clone(), 200).await;
    tokio::fs::remove_dir(&dir).await.unwrap();
    check(app.clone(), 503).await;
    pool.close().await;
    check(app, 503).await;
    sqlx::query(&format!("DROP SCHEMA {schema} CASCADE"))
        .execute(&admin)
        .await
        .unwrap();
    admin.close().await;
}
