#[tokio::test]
async fn empty_schema_migrates_twice() {
    let url = std::env::var("TEST_DATABASE_URL")
        .expect("TEST_DATABASE_URL required; never use production");
    let pool = wiki_api::pool(&url).await.unwrap();
    let schema = format!("test_{}", uuid::Uuid::new_v4().simple());
    let mut conn = pool.acquire().await.unwrap();
    sqlx::query(&format!("CREATE SCHEMA {schema}"))
        .execute(&mut *conn)
        .await
        .unwrap();
    sqlx::query(&format!("SET search_path TO {schema}"))
        .execute(&mut *conn)
        .await
        .unwrap();
    wiki_api::MIGRATOR.run(&mut *conn).await.unwrap();
    wiki_api::MIGRATOR.run(&mut *conn).await.unwrap();
    let stage: String =
        sqlx::query_scalar("SELECT value FROM app_metadata WHERE key='schema_stage'")
            .fetch_one(&mut *conn)
            .await
            .unwrap();
    assert_eq!(stage, "foundation");
    sqlx::query(&format!("DROP SCHEMA {schema} CASCADE"))
        .execute(&mut *conn)
        .await
        .unwrap();
    drop(conn);
    pool.close().await;
}
