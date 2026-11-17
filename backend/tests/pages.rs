mod common;
use common::request;
use serde_json::{Value, json};
use uuid::Uuid;
const O: &str = "http://127.0.0.1:5173";
fn body(title: &str) -> Value {
    json!({"title":title,"schema_version":1,"body":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"中文内容"}]}]}})
}
#[tokio::test]
async fn pages_are_atomic_idempotent_and_permission_filtered() {
    let (pool, admin, schema) = common::database().await;
    wiki_api::identity::bootstrap(&pool, "root", "root-password-123")
        .await
        .unwrap();
    let app = wiki_api::http::router(wiki_api::http::AppState {
        pool: pool.clone(),
        attachment_dir: "/tmp".into(),
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
    let (_, e, _) = request(
        &app,
        "POST",
        "/api/v1/admin/users",
        json!({"username":"editor","display_name":"编辑者","password":"editor-password-123"}),
        &c,
        t,
        O,
    )
    .await;
    let (_, eu, ec) = request(
        &app,
        "POST",
        "/api/v1/auth/login",
        json!({"username":"editor","password":"editor-password-123"}),
        "",
        "",
        O,
    )
    .await;
    let et = eu["csrf_token"].as_str().unwrap();
    let (_, k, _) = request(
        &app,
        "POST",
        "/api/v1/knowledge-bases",
        json!({"name":"测试库"}),
        &c,
        t,
        O,
    )
    .await;
    let kid = k["id"].as_str().unwrap();
    let tree = format!("/api/v1/knowledge-bases/{kid}/pages");
    let acl = format!("/api/v1/knowledge-bases/{kid}/permissions");
    request(
        &app,
        "PUT",
        &acl,
        json!({"acl_version":1,"entries":[{"user_id":e["id"],"group_id":null,"role":2}]}),
        &c,
        t,
        O,
    )
    .await;
    let mut create = body("根页面");
    create["request_id"] = json!(Uuid::new_v4());
    let (code, p, _) = request(&app, "POST", &tree, create.clone(), &ec, et, O).await;
    assert_eq!(code, 200, "{p}");
    let pid = p["id"].as_str().unwrap();
    let path = format!("/api/v1/pages/{pid}");
    let save = format!("{path}/revisions");
    let (_, retry, _) = request(&app, "POST", &tree, create.clone(), &ec, et, O).await;
    assert_eq!(retry, p);
    create["title"] = json!("changed");
    assert_eq!(
        request(&app, "POST", &tree, create, &ec, et, O).await.0,
        409
    );
    let mut a = body("版本A");
    a["request_id"] = json!(Uuid::new_v4());
    a["base_revision_id"] = p["revision_id"].clone();
    let mut b = a.clone();
    b["request_id"] = json!(Uuid::new_v4());
    b["title"] = json!("版本B");
    let (x, y) = tokio::join!(
        request(&app, "POST", &save, a.clone(), &ec, et, O),
        request(&app, "POST", &save, b.clone(), &c, t, O)
    );
    assert!((x.0 == 200 && y.0 == 409) || (x.0 == 409 && y.0 == 200));
    let winning = if x.0 == 200 { a } else { b };
    let (cookie, csrf) = if x.0 == 200 { (&ec, et) } else { (&c, t) };
    assert_eq!(
        request(&app, "POST", &save, winning, cookie, csrf, O)
            .await
            .0,
        200
    );
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM page_revisions WHERE page_id=$1")
        .bind(Uuid::parse_str(pid).unwrap())
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 2);
    let mut parent = pid.to_owned();
    for n in 0..3 {
        let mut v = body(&format!("层{n}"));
        v["parent_id"] = json!(parent);
        v["request_id"] = json!(Uuid::new_v4());
        let (code, r, _) = request(&app, "POST", &tree, v, &ec, et, O).await;
        assert_eq!(code, 200, "{r}");
        parent = r["id"].as_str().unwrap().to_owned();
    }
    let page_acl = format!("/api/v1/pages/{parent}/permissions");
    assert_eq!(request(&app,"PUT",&page_acl,json!({"acl_version":1,"acl_mode":"independent","entries":[{"user_id":e["id"],"group_id":null,"role":1}]}),&c,t,O).await.0,200);
    request(
        &app,
        "PUT",
        &acl,
        json!({"acl_version":2,"entries":[]}),
        &c,
        t,
        O,
    )
    .await;
    assert_eq!(
        request(&app, "GET", &path, json!({}), &ec, et, O).await.0,
        404
    );
    let (code, visible, _) = request(
        &app,
        "GET",
        &format!("/api/v1/pages/{parent}"),
        json!({}),
        &ec,
        et,
        O,
    )
    .await;
    assert_eq!(code, 200);
    assert!(visible["parent_id"].is_null());
    assert_eq!(visible["breadcrumbs"].as_array().unwrap().len(), 1);
    let (_, shared, _) = request(&app, "GET", "/api/v1/shared-pages", json!({}), &ec, et, O).await;
    assert_eq!(shared["items"].as_array().unwrap().len(), 1);
    assert_eq!(
        request(&app, "GET", &tree, json!({}), &ec, et, O).await.0,
        404
    );
    assert_eq!(
        request(&app, "POST", &save, body("unauthorized"), &ec, et, O)
            .await
            .0,
        422
    );
    common::cleanup(pool, admin, schema).await;
}
