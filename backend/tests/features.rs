mod common;
use axum::{Router, body::Body, http::Request};
use common::request;
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tower::ServiceExt;
use uuid::Uuid;
const O: &str = "http://127.0.0.1:5173";
async fn raw(
    app: &Router,
    method: &str,
    path: &str,
    bytes: Vec<u8>,
    cookie: &str,
    csrf: &str,
) -> (u16, axum::http::HeaderMap, Vec<u8>) {
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(path)
                .header("cookie", cookie)
                .header("origin", O)
                .header("x-csrf-token", csrf)
                .body(Body::from(bytes))
                .unwrap(),
        )
        .await
        .unwrap();
    let code = r.status().as_u16();
    let h = r.headers().clone();
    (
        code,
        h,
        r.into_body().collect().await.unwrap().to_bytes().to_vec(),
    )
}
#[tokio::test]
async fn attachments_are_streamed_idempotent_compensated_and_reauthorized() {
    let (pool, admin, schema) = common::database().await;
    wiki_api::identity::bootstrap(&pool, "root", "root-password-123")
        .await
        .unwrap();
    let dir = std::env::temp_dir().join(format!("wiki-files-{}", Uuid::new_v4()));
    tokio::fs::create_dir(&dir).await.unwrap();
    let app = wiki_api::http::router(wiki_api::http::AppState {
        pool: pool.clone(),
        attachment_dir: dir.clone(),
        security: Default::default(),
    });
    let (_, u, c) = request(
        &app,
        "POST",
        "/api/v1/auth/login",
        json!({"username":"root","password":"root-password-123"}),
        "",
        "",
        O,
    )
    .await;
    let t = u["csrf_token"].as_str().unwrap();
    let (_, k, _) = request(
        &app,
        "POST",
        "/api/v1/knowledge-bases",
        json!({"name":"附件库"}),
        &c,
        t,
        O,
    )
    .await;
    let kid = k["id"].as_str().unwrap();
    let create = json!({"request_id":Uuid::new_v4(),"title":"附件测试","schema_version":1,"body":{"type":"doc","content":[{"type":"paragraph"}]}});
    let (_, p, _) = request(
        &app,
        "POST",
        &format!("/api/v1/knowledge-bases/{kid}/pages"),
        create,
        &c,
        t,
        O,
    )
    .await;
    let pid = p["id"].as_str().unwrap();
    let bytes = b"<svg onload='alert(1)'>private attachment</svg>".to_vec();
    let sha = format!("{:x}", Sha256::digest(&bytes));
    let path = format!(
        "/api/v1/pages/{pid}/attachments?request_id={}&name=sample.svg&sha256={sha}",
        Uuid::new_v4()
    );
    let (code, _, body) = raw(&app, "POST", &path, bytes.clone(), &c, t).await;
    assert_eq!(code, 200, "{}", String::from_utf8_lossy(&body));
    let a: Value = serde_json::from_slice(&body).unwrap();
    let aid = a["id"].as_str().unwrap();
    assert_eq!(raw(&app, "POST", &path, bytes.clone(), &c, t).await.0, 200);
    let download = format!("/api/v1/attachments/{aid}/download");
    let (code, h, data) = raw(&app, "GET", &download, vec![], &c, t).await;
    assert_eq!(code, 200);
    assert_eq!(data, bytes);
    assert_eq!(h["content-type"], "application/octet-stream");
    assert!(
        h["content-disposition"]
            .to_str()
            .unwrap()
            .starts_with("attachment")
    );
    assert_eq!(h["x-content-type-options"], "nosniff");
    let invalid = format!(
        "/api/v1/pages/{pid}/attachments?request_id={}&name=..%2Fsecret&sha256={sha}",
        Uuid::new_v4()
    );
    assert_eq!(
        raw(&app, "POST", &invalid, bytes.clone(), &c, t).await.0,
        422
    );
    let corrupt = format!(
        "/api/v1/pages/{pid}/attachments?request_id={}&name=wrong&sha256={}",
        Uuid::new_v4(),
        "0".repeat(64)
    );
    assert_eq!(raw(&app, "POST", &corrupt, bytes, &c, t).await.0, 422);
    sqlx::query(
        "UPDATE attachments SET created_at=now()-interval '2 hours' WHERE status='pending'",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("UPDATE jobs SET available_at=now()")
        .execute(&pool)
        .await
        .unwrap();
    while wiki_api::jobs::tick(&pool, &dir).await.unwrap() {}
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM attachments")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 1);
    let (_, reader, _) = request(
        &app,
        "POST",
        "/api/v1/admin/users",
        json!({"username":"reader","display_name":"读者","password":"reader-password-123"}),
        &c,
        t,
        O,
    )
    .await;
    let (_, r, rc) = request(
        &app,
        "POST",
        "/api/v1/auth/login",
        json!({"username":"reader","password":"reader-password-123"}),
        "",
        "",
        O,
    )
    .await;
    let rt = r["csrf_token"].as_str().unwrap();
    let acl = format!("/api/v1/knowledge-bases/{kid}/permissions");
    assert_eq!(
        request(
            &app,
            "PUT",
            &acl,
            json!({"acl_version":1,"entries":[{"user_id":reader["id"],"group_id":null,"role":1}]}),
            &c,
            t,
            O
        )
        .await
        .0,
        200
    );
    assert_eq!(raw(&app, "GET", &download, vec![], &rc, rt).await.0, 200);
    assert_eq!(
        raw(&app, "POST", &path, b"bad".to_vec(), &rc, rt).await.0,
        403
    );
    assert_eq!(
        request(
            &app,
            "PUT",
            &acl,
            json!({"acl_version":2,"entries":[{"user_id":reader["id"],"group_id":null,"role":2}]}),
            &c,
            t,
            O
        )
        .await
        .0,
        200
    );
    let lease = Uuid::new_v4();
    assert_eq!(
        request(
            &app,
            "PUT",
            &format!("/api/v1/pages/{pid}/edit-lease"),
            json!({"lease_id":lease}),
            &rc,
            rt,
            O
        )
        .await
        .0,
        200
    );
    assert_eq!(request(&app,"POST",&format!("/api/v1/pages/{pid}/revisions"),json!({"lease_id":lease,"request_id":Uuid::new_v4(),"base_revision_id":p["revision_id"],"title":"附件测试","schema_version":1,"body":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"第二位成员的贡献"}]}]}}),&rc,rt,O).await.0,200);
    request(
        &app,
        "PUT",
        &acl,
        json!({"acl_version":3,"entries":[]}),
        &c,
        t,
        O,
    )
    .await;
    assert_eq!(raw(&app, "GET", &download, vec![], &rc, rt).await.0, 404);
    let root_id = u["id"].as_str().unwrap();
    for relation in ["creator", "last_editor", "contributor", "editor_access"] {
        let (code, r, _) = request(
            &app,
            "GET",
            &format!("/api/v1/search?person_id={root_id}&relation={relation}"),
            json!({}),
            &c,
            t,
            O,
        )
        .await;
        assert_eq!(code, 200, "{r}");
        assert_eq!(
            r["items"].as_array().unwrap().len(),
            if relation == "last_editor" { 0 } else { 1 }
        );
    }
    for relation in ["creator", "last_editor", "contributor", "editor_access"] {
        let (_, r, _) = request(
            &app,
            "GET",
            &format!(
                "/api/v1/search?person_id={}&relation={relation}",
                reader["id"].as_str().unwrap()
            ),
            json!({}),
            &c,
            t,
            O,
        )
        .await;
        assert_eq!(
            r["items"].as_array().unwrap().len(),
            if ["last_editor", "contributor"].contains(&relation) {
                1
            } else {
                0
            }
        );
    }
    let (_, hidden, _) = request(&app, "GET", "/api/v1/search", json!({}), &rc, rt, O).await;
    assert!(hidden["items"].as_array().unwrap().is_empty());
    let (_, literal, _) = request(&app, "GET", "/api/v1/search?q=%25", json!({}), &c, t, O).await;
    assert!(literal["items"].as_array().unwrap().is_empty());
    assert_eq!(
        request(
            &app,
            "GET",
            "/api/v1/admin/system-status",
            json!({}),
            &rc,
            rt,
            O
        )
        .await
        .0,
        403
    );
    assert_eq!(
        request(
            &app,
            "GET",
            "/api/v1/admin/audit-events",
            json!({}),
            &rc,
            rt,
            O
        )
        .await
        .0,
        403
    );
    assert_eq!(
        request(
            &app,
            "GET",
            "/api/v1/admin/system-status",
            json!({}),
            &c,
            t,
            O
        )
        .await
        .0,
        200
    );
    let (_, audit, _) = request(
        &app,
        "GET",
        "/api/v1/admin/audit-events?action=attachments.upload",
        json!({}),
        &c,
        t,
        O,
    )
    .await;
    assert_eq!(audit["items"].as_array().unwrap().len(), 1, "{audit}");
    assert!(!audit.to_string().contains("password"));
    let (_,child,_)=request(&app,"POST",&format!("/api/v1/knowledge-bases/{kid}/pages"),json!({"request_id":Uuid::new_v4(),"parent_id":pid,"title":"单独删除子页","schema_version":1,"body":{"type":"doc","content":[{"type":"paragraph"}]}}),&c,t,O).await;
    let child = child["id"].as_str().unwrap();
    for target in [child, pid] {
        let url = format!("/api/v1/pages/{target}");
        let (code, prev, _) = request(
            &app,
            "POST",
            &format!("{url}/delete-preview"),
            json!({}),
            &c,
            t,
            O,
        )
        .await;
        assert_eq!(code, 200, "{prev}");
        assert_eq!(prev["affected_pages"], 1);
        assert_eq!(
            request(
                &app,
                "DELETE",
                &url,
                json!({"preview_token":prev["preview_token"]}),
                &c,
                t,
                O
            )
            .await
            .0,
            200
        );
    }
    assert_eq!(raw(&app, "GET", &download, vec![], &c, t).await.0, 404);
    let (_, trash, _) = request(&app, "GET", "/api/v1/trash", json!({}), &c, t, O).await;
    assert_eq!(trash["items"].as_array().unwrap().len(), 2);
    assert_eq!(
        request(
            &app,
            "POST",
            &format!("/api/v1/pages/{pid}/restore"),
            json!({"parent_id":null}),
            &c,
            t,
            O
        )
        .await
        .0,
        200
    );
    assert_eq!(
        request(
            &app,
            "GET",
            &format!("/api/v1/pages/{child}"),
            json!({}),
            &c,
            t,
            O
        )
        .await
        .0,
        404
    );
    assert_eq!(raw(&app, "GET", &download, vec![], &c, t).await.0, 200);
    assert_eq!(
        request(
            &app,
            "POST",
            &format!("/api/v1/pages/{child}/restore"),
            json!({"parent_id":pid}),
            &c,
            t,
            O
        )
        .await
        .0,
        200
    );
    let (_, prev, _) = request(
        &app,
        "POST",
        &format!("/api/v1/pages/{pid}/delete-preview"),
        json!({}),
        &c,
        t,
        O,
    )
    .await;
    assert_eq!(prev["affected_pages"], 2);
    assert_eq!(
        request(
            &app,
            "DELETE",
            &format!("/api/v1/pages/{pid}"),
            json!({"preview_token":prev["preview_token"]}),
            &c,
            t,
            O
        )
        .await
        .0,
        200
    );
    sqlx::query(
        "UPDATE pages SET deleted_at=now()-interval '31 days' WHERE deleted_at IS NOT NULL",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("UPDATE jobs SET available_at=now()")
        .execute(&pool)
        .await
        .unwrap();
    while wiki_api::jobs::tick(&pool, &dir).await.unwrap() {}
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM pages")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
    assert!(!dir.join(aid).exists());
    tokio::fs::remove_dir_all(&dir).await.unwrap();
    common::cleanup(pool, admin, schema).await;
}
