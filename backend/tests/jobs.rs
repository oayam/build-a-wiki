mod common;
use serde_json::json;
use uuid::Uuid;
#[tokio::test]
async fn durable_jobs_retry_and_pause_without_duplicate_effects() {
    let (pool, admin, schema) = common::database().await;
    let root = std::env::temp_dir().join(format!("wiki-jobs-{}", Uuid::new_v4()));
    tokio::fs::create_dir(&root).await.unwrap();
    let key = Uuid::new_v4().to_string();
    tokio::fs::write(root.join(&key), b"cleanup").await.unwrap();
    let mut tx = pool.begin().await.unwrap();
    for _ in 0..2 {
        wiki_api::jobs::enqueue(&mut tx, "remove_file", &key, json!({"key":key}), 0)
            .await
            .unwrap();
    }
    tx.commit().await.unwrap();
    sqlx::query("UPDATE auth_guard SET maintenance=true")
        .execute(&pool)
        .await
        .unwrap();
    assert!(!wiki_api::jobs::tick(&pool, &root).await.unwrap());
    assert!(root.join(&key).exists());
    sqlx::query("UPDATE auth_guard SET maintenance=false")
        .execute(&pool)
        .await
        .unwrap();
    // Simulate process failure between the idempotent file effect and database commit.
    let mut interrupted = pool.begin().await.unwrap();
    sqlx::query("SELECT id FROM jobs FOR UPDATE")
        .execute(&mut *interrupted)
        .await
        .unwrap();
    wiki_api::jobs::remove(&root, &key).await.unwrap();
    interrupted.rollback().await.unwrap();
    assert!(wiki_api::jobs::tick(&pool, &root).await.unwrap());
    assert!(!wiki_api::jobs::tick(&pool, &root).await.unwrap());
    let bad = Uuid::new_v4().to_string();
    tokio::fs::create_dir(root.join(&bad)).await.unwrap();
    let mut tx = pool.begin().await.unwrap();
    wiki_api::jobs::enqueue(&mut tx, "remove_file", &bad, json!({"key":bad}), 0)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    wiki_api::jobs::tick(&pool, &root).await.unwrap();
    let attempts: i32 = sqlx::query_scalar("SELECT attempts FROM jobs WHERE dedupe_key=$1")
        .bind(&bad)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(attempts, 1);
    assert!(wiki_api::jobs::file_path(&root, "../../etc/passwd").is_err());
    tokio::fs::remove_dir(root.join(&bad)).await.unwrap();
    sqlx::query("UPDATE jobs SET available_at=now()")
        .execute(&pool)
        .await
        .unwrap();
    wiki_api::jobs::tick(&pool, &root).await.unwrap();
    tokio::fs::remove_dir(root).await.unwrap();
    common::cleanup(pool, admin, schema).await;
}
