use std::borrow::Cow;
#[tokio::test]
async fn stage_c_database_upgrades_without_losing_identity() {
    let url = std::env::var("TEST_DATABASE_URL").unwrap();
    let admin = wiki_api::pool(&url).await.unwrap();
    let schema = format!("upgrade_{}", uuid::Uuid::new_v4().simple());
    sqlx::query(&format!("CREATE SCHEMA {schema}"))
        .execute(&admin)
        .await
        .unwrap();
    let name = schema.clone();
    let pool = sqlx::postgres::PgPoolOptions::new()
        .after_connect(move |conn, _| {
            let q = format!("SET search_path TO {name}");
            Box::pin(async move {
                sqlx::query(&q).execute(conn).await?;
                Ok(())
            })
        })
        .connect(&url)
        .await
        .unwrap();
    let old = sqlx::migrate::Migrator {
        migrations: Cow::Owned(wiki_api::MIGRATOR.iter().take(6).cloned().collect()),
        ..sqlx::migrate::Migrator::DEFAULT
    };
    old.run(&pool).await.unwrap();
    let user = uuid::Uuid::new_v4();
    let hash = wiki_api::identity::hash_password("upgrade-password-123").unwrap();
    sqlx::query("INSERT INTO users(id,username,display_name,password_hash,is_system_admin) VALUES($1,'upgrade-user','升级账号',$2,true)").bind(user).bind(hash).execute(&pool).await.unwrap();
    wiki_api::MIGRATOR.run(&pool).await.unwrap();
    wiki_api::MIGRATOR.run(&pool).await.unwrap();
    let stored: uuid::Uuid =
        sqlx::query_scalar("SELECT id FROM users WHERE username='upgrade-user'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(stored, user);
    pool.close().await;
    sqlx::query(&format!("DROP SCHEMA {schema} CASCADE"))
        .execute(&admin)
        .await
        .unwrap();
    admin.close().await;
}
