use sqlx::{PgPool, postgres::PgPoolOptions};
use std::time::Duration;
async fn role(pool: &PgPool, user: &str, page: &str) -> i32 {
    sqlx::query_scalar("SELECT effective_role($1,$2)")
        .bind(user)
        .bind(page)
        .fetch_one(pool)
        .await
        .unwrap()
}
async fn wait_for_lock(pool: &PgPool, pid: i32) {
    tokio::time::timeout(Duration::from_secs(5),async {
  loop {
   let waiting:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock')").bind(pid).fetch_one(pool).await.unwrap();
   if waiting {break;}tokio::time::sleep(Duration::from_millis(10)).await;
  }
 }).await.expect("second transaction must actually wait for authorization lock");
}
#[tokio::test]
async fn acl_matrix_and_revocation_serialization() {
    let url = std::env::var("TEST_DATABASE_URL").expect("TEST_DATABASE_URL required");
    let admin = wiki_api::pool(&url).await.unwrap();
    let schema = format!("acl_{}", uuid::Uuid::new_v4().simple());
    sqlx::query(&format!("CREATE SCHEMA {schema}"))
        .execute(&admin)
        .await
        .unwrap();
    let path = schema.clone();
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .after_connect(move |conn, _| {
            let sql = format!("SET search_path TO {path}");
            Box::pin(async move {
                sqlx::query(&sql).execute(conn).await?;
                Ok(())
            })
        })
        .connect(&url)
        .await
        .unwrap();
    sqlx::raw_sql(include_str!("permissions.sql"))
        .execute(&pool)
        .await
        .unwrap();
    for (u, p, r) in [
        ("owner", "leaf", 3),
        ("editor", "child", 2),
        ("reader", "child", 1),
        ("none", "root", 0),
        ("none", "leaf", 1),
        ("member", "child", 2),
        ("member", "leaf", 0),
        ("editor", "leaf", 0),
        ("admin", "leaf", 3),
        ("disabled", "root", 0),
    ] {
        assert_eq!(role(&pool, u, p).await, r, "{u}/{p}");
    }
    // Direct viewer + group editor must take max; independent ACL must replace both.
    sqlx::query("INSERT INTO acl VALUES('k',null,'member',null,1)")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(role(&pool, "member", "child").await, 2);
    let mut revoke = pool.begin().await.unwrap();
    sqlx::query("SELECT id FROM auth_guard WHERE id=1 FOR UPDATE")
        .execute(&mut *revoke)
        .await
        .unwrap();
    sqlx::query("DELETE FROM members WHERE user_id='member'")
        .execute(&mut *revoke)
        .await
        .unwrap();
    let mut write = pool.begin().await.unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *write)
        .await
        .unwrap();
    let writer = tokio::spawn(async move {
        sqlx::query("SELECT id FROM auth_guard WHERE id=1 FOR UPDATE")
            .execute(&mut *write)
            .await
            .unwrap();
        let role: i32 = sqlx::query_scalar("SELECT effective_role('member','child')")
            .fetch_one(&mut *write)
            .await
            .unwrap();
        if role >= 2 {
            sqlx::query("UPDATE pages SET body='unauthorized' WHERE id='child'")
                .execute(&mut *write)
                .await
                .unwrap();
        }
        write.commit().await.unwrap();
        role
    });
    wait_for_lock(&pool, pid).await;
    revoke.commit().await.unwrap();
    assert_eq!(writer.await.unwrap(), 1);
    assert_eq!(role(&pool, "member", "child").await, 1);
    let body: String = sqlx::query_scalar("SELECT body FROM pages WHERE id='child'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(body, "initial");
    // A writer that owns the barrier may finish before revocation commits.
    sqlx::query("INSERT INTO members VALUES('team','member')")
        .execute(&pool)
        .await
        .unwrap();
    let mut first = pool.begin().await.unwrap();
    sqlx::query("SELECT id FROM auth_guard WHERE id=1 FOR UPDATE")
        .execute(&mut *first)
        .await
        .unwrap();
    let allowed: i32 = sqlx::query_scalar("SELECT effective_role('member','child')")
        .fetch_one(&mut *first)
        .await
        .unwrap();
    assert_eq!(allowed, 2);
    let mut second = pool.begin().await.unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *second)
        .await
        .unwrap();
    let revoker = tokio::spawn(async move {
        sqlx::query("SELECT id FROM auth_guard WHERE id=1 FOR UPDATE")
            .execute(&mut *second)
            .await
            .unwrap();
        sqlx::query("DELETE FROM members WHERE user_id='member'")
            .execute(&mut *second)
            .await
            .unwrap();
        second.commit().await.unwrap();
    });
    wait_for_lock(&pool, pid).await;
    sqlx::query("UPDATE pages SET body='authorized' WHERE id='child'")
        .execute(&mut *first)
        .await
        .unwrap();
    first.commit().await.unwrap();
    revoker.await.unwrap();
    assert_eq!(role(&pool, "member", "child").await, 1);
    pool.close().await;
    sqlx::query(&format!("DROP SCHEMA {schema} CASCADE"))
        .execute(&admin)
        .await
        .unwrap();
    admin.close().await;
}
