mod common;
use uuid::Uuid;
#[tokio::test]
async fn physical_acl_constraints_and_revision_ownership() {
    let (pool, admin, schema) = common::database().await;
    let owner = wiki_api::identity::bootstrap(&pool, "owner", "owner-password-123")
        .await
        .unwrap();
    let k = Uuid::new_v4();
    let k2 = Uuid::new_v4();
    for id in [k, k2] {
        sqlx::query("INSERT INTO knowledge_bases(id,name,owner_id) VALUES($1,'库',$2)")
            .bind(id)
            .bind(owner)
            .execute(&pool)
            .await
            .unwrap();
    }
    let p = Uuid::new_v4();
    let r = Uuid::new_v4();
    let mut tx = pool.begin().await.unwrap();
    sqlx::query("INSERT INTO pages(id,knowledge_base_id,title,created_by,current_revision_id) VALUES($1,$2,'页',$3,$4)").bind(p).bind(k).bind(owner).bind(r).execute(&mut *tx).await.unwrap();
    sqlx::query("INSERT INTO page_revisions(id,page_id,revision_no,title,schema_version,body_json,editor_id) VALUES($1,$2,1,'页',1,'{}',$3)").bind(r).bind(p).bind(owner).execute(&mut *tx).await.unwrap();
    tx.commit().await.unwrap();
    assert!(
        sqlx::query("UPDATE page_revisions SET title='改变' WHERE id=$1")
            .bind(r)
            .execute(&pool)
            .await
            .is_err()
    );
    assert!(sqlx::query("INSERT INTO pages(id,knowledge_base_id,title,created_by,parent_id,current_revision_id) VALUES($1,$2,'跨库',$3,$4,$5)").bind(Uuid::new_v4()).bind(k2).bind(owner).bind(p).bind(r).execute(&pool).await.is_err());
    assert!(sqlx::query("INSERT INTO pages(id,knowledge_base_id,title,created_by,current_revision_id) VALUES($1,$2,'错误版本',$3,$4)").bind(Uuid::new_v4()).bind(k).bind(owner).bind(r).execute(&pool).await.is_err());
    assert!(
        sqlx::query(
            "INSERT INTO pages(id,knowledge_base_id,title,created_by) VALUES($1,$2,'无版本',$3)"
        )
        .bind(Uuid::new_v4())
        .bind(k)
        .bind(owner)
        .execute(&pool)
        .await
        .is_err()
    );
    assert!(
        sqlx::query("INSERT INTO page_acl(id,page_id,role) VALUES($1,$2,2)")
            .bind(Uuid::new_v4())
            .bind(p)
            .execute(&pool)
            .await
            .is_err()
    );
    let user = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO users(id,username,display_name,password_hash) VALUES($1,'reader','读者','x')",
    )
    .bind(user)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO knowledge_base_acl(id,knowledge_base_id,user_id,role) VALUES($1,$2,$3,2)",
    )
    .bind(Uuid::new_v4())
    .bind(k)
    .bind(user)
    .execute(&pool)
    .await
    .unwrap();
    let role: i16 = sqlx::query_scalar("SELECT page_role($1,$2)")
        .bind(user)
        .bind(p)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(role, 2);
    sqlx::query("UPDATE pages SET acl_mode='independent' WHERE id=$1")
        .bind(p)
        .execute(&pool)
        .await
        .unwrap();
    let role: i16 = sqlx::query_scalar("SELECT page_role($1,$2)")
        .bind(user)
        .bind(p)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(role, 0);
    sqlx::query("INSERT INTO page_acl(id,page_id,user_id,role) VALUES($1,$2,$3,1)")
        .bind(Uuid::new_v4())
        .bind(p)
        .bind(user)
        .execute(&pool)
        .await
        .unwrap();
    assert!(
        sqlx::query("INSERT INTO page_acl(id,page_id,user_id,role) VALUES($1,$2,$3,2)")
            .bind(Uuid::new_v4())
            .bind(p)
            .bind(user)
            .execute(&pool)
            .await
            .is_err()
    );
    let role: i16 = sqlx::query_scalar("SELECT page_role($1,$2)")
        .bind(user)
        .bind(p)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(role, 1);
    let group = Uuid::new_v4();
    sqlx::query("INSERT INTO groups VALUES($1,'测试组')")
        .bind(group)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO group_members VALUES($1,$2)")
        .bind(group)
        .bind(user)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO page_acl(id,page_id,group_id,role) VALUES($1,$2,$3,2)")
        .bind(Uuid::new_v4())
        .bind(p)
        .bind(group)
        .execute(&pool)
        .await
        .unwrap();
    let role: i16 = sqlx::query_scalar("SELECT page_role($1,$2)")
        .bind(user)
        .bind(p)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(role, 2);
    sqlx::query("DELETE FROM group_members WHERE user_id=$1")
        .bind(user)
        .execute(&pool)
        .await
        .unwrap();
    let role: i16 = sqlx::query_scalar("SELECT page_role($1,$2)")
        .bind(user)
        .bind(p)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(role, 1);
    sqlx::query("UPDATE users SET active=false WHERE id=$1")
        .bind(user)
        .execute(&pool)
        .await
        .unwrap();
    let role: i16 = sqlx::query_scalar("SELECT page_role($1,$2)")
        .bind(user)
        .bind(p)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(role, 0);
    common::cleanup(pool, admin, schema).await;
}
