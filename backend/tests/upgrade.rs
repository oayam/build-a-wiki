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
    // Retain the stage-C identity check, then exercise the storage upgrade
    // starting from the schema that currently writes both body representations.
    let before_storage_change = sqlx::migrate::Migrator {
        migrations: Cow::Owned(
            wiki_api::MIGRATOR
                .iter()
                .take_while(|m| m.version < 13)
                .cloned()
                .collect(),
        ),
        ..sqlx::migrate::Migrator::DEFAULT
    };
    before_storage_change.run(&pool).await.unwrap();
    let kb = uuid::Uuid::new_v4();
    let page = uuid::Uuid::new_v4();
    let previous = uuid::Uuid::new_v4();
    let current = uuid::Uuid::new_v4();
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("../../fixtures/body-v1.json")).unwrap();
    let latest = serde_json::json!({"type":"doc","content":[{"type":"paragraph",
        "content":[{"type":"text","text":"现行📖"}]}]});
    let mut tx = pool.begin().await.unwrap();
    sqlx::query("INSERT INTO knowledge_bases(id,name,owner_id) VALUES($1,'迁移测试',$2)")
        .bind(kb)
        .bind(user)
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::query("INSERT INTO pages(id,knowledge_base_id,title,created_by,current_revision_id) VALUES($1,$2,'当前',$3,$4)")
        .bind(page).bind(kb).bind(user).bind(current).execute(&mut *tx).await.unwrap();
    let insert = "INSERT INTO page_revisions(id,page_id,revision_no,title,schema_version,body_json,body_text,editor_id)
                  VALUES($1,$2,$3,'版本',1,$4,$5,$6)";
    for (id, number, body, text) in [
        (
            previous,
            1_i64,
            &fixture["body"],
            fixture["text"].as_str().unwrap(),
        ),
        (current, 2, &latest, "现行📖"),
    ] {
        sqlx::query(insert)
            .bind(id)
            .bind(page)
            .bind(number)
            .bind(body)
            .bind(text)
            .bind(user)
            .execute(&mut *tx)
            .await
            .unwrap();
    }
    tx.commit().await.unwrap();
    wiki_api::MIGRATOR.run(&pool).await.unwrap();
    let cached: String = sqlx::query_scalar("SELECT body_text FROM pages WHERE id=$1")
        .bind(page)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(cached, "现行📖");
    let (historical, text, has_old_column): (serde_json::Value, String, bool) = sqlx::query_as(
        "SELECT body_json,revision_text_v1(body_json),to_jsonb(r) ? 'body_text' FROM page_revisions r WHERE id=$1")
        .bind(previous).fetch_one(&pool).await.unwrap();
    assert_eq!(historical, fixture["body"]);
    assert_eq!(text, fixture["text"].as_str().unwrap());
    assert!(!has_old_column);
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
