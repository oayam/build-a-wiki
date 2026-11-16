mod common;
use wiki_api::identity::*;
#[tokio::test]
async fn bootstrap_is_single_use_and_audit_is_transactional() {
    let (pool, admin, schema) = common::database().await;
    let (a, b) = tokio::join!(
        bootstrap(&pool, "admin-a", "secure-password-123"),
        bootstrap(&pool, "admin-b", "secure-password-456")
    );
    assert_ne!(a.is_ok(), b.is_ok());
    let id = a.or(b).unwrap();
    let hash: String = sqlx::query_scalar("SELECT password_hash FROM users WHERE id=$1")
        .bind(id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(hash.starts_with("$argon2id$"));
    assert!(!verify_password("wrong", &hash));
    assert!(
        bootstrap(&pool, "third", "secure-password-789")
            .await
            .is_err()
    );
    let mut tx = pool.begin().await.unwrap();
    audit(
        &mut tx,
        Some(id),
        "test.change",
        Some(id),
        "req-1",
        serde_json::json!({"password":"secret","token":"secret","role":"viewer"}),
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    let details: serde_json::Value =
        sqlx::query_scalar("SELECT details FROM audit_events WHERE request_id='req-1'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(details, serde_json::json!({"role":"viewer"}));
    let mut tx = pool.begin().await.unwrap();
    audit(
        &mut tx,
        Some(id),
        "test.rollback",
        None,
        "req-2",
        serde_json::json!({}),
    )
    .await
    .unwrap();
    tx.rollback().await.unwrap();
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM audit_events WHERE request_id='req-2'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count, 0);
    assert!(
        sqlx::query("INSERT INTO group_members VALUES($1,$2)")
            .bind(uuid::Uuid::new_v4())
            .bind(id)
            .execute(&pool)
            .await
            .is_err()
    );
    common::cleanup(pool, admin, schema).await;
}
