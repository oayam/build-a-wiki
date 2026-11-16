mod common;
use axum::{
    Router,
    body::{Body, to_bytes},
    http::Request,
};
use serde_json::{Value, json};
use tower::ServiceExt;
async fn request(
    app: &Router,
    method: &str,
    path: &str,
    body: Value,
    cookie: &str,
    csrf: &str,
    origin: &str,
) -> (u16, Value, String) {
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(path)
                .header("content-type", "application/json")
                .header("origin", origin)
                .header("cookie", cookie)
                .header("x-csrf-token", csrf)
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let code = r.status().as_u16();
    let cookie = r
        .headers()
        .get("set-cookie")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_owned();
    let bytes = to_bytes(r.into_body(), 1024 * 1024).await.unwrap();
    let value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (code, value, cookie)
}
#[tokio::test]
async fn session_csrf_admin_group_and_revocation() {
    let (pool, admin, schema) = common::database().await;
    let root = wiki_api::identity::bootstrap(&pool, "root", "root-password-123")
        .await
        .unwrap();
    let app = wiki_api::http::router(wiki_api::http::AppState {
        pool: pool.clone(),
        attachment_dir: "/tmp".into(),
        security: Default::default(),
    });
    let origin = "http://127.0.0.1:5173";
    assert_eq!(
        request(&app, "GET", "/api/v1/me", json!({}), "", "", origin)
            .await
            .0,
        401
    );
    assert_eq!(
        request(
            &app,
            "POST",
            "/api/v1/auth/login",
            json!({"username":"root","password":"root-password-123"}),
            "",
            "",
            "http://evil.test"
        )
        .await
        .0,
        403
    );
    let (code, user, cookie) = request(
        &app,
        "POST",
        "/api/v1/auth/login",
        json!({"username":"root","password":"root-password-123"}),
        "",
        "",
        origin,
    )
    .await;
    assert_eq!(code, 200);
    assert!(cookie.contains("HttpOnly"));
    assert!(cookie.contains("SameSite=Strict"));
    let csrf = user["csrf_token"].as_str().unwrap();
    let raw = cookie
        .split(';')
        .next()
        .unwrap()
        .strip_prefix("wiki_session=")
        .unwrap();
    let stored: String = sqlx::query_scalar("SELECT token_hash FROM sessions LIMIT 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_ne!(stored, raw);
    assert_eq!(
        request(
            &app,
            "POST",
            "/api/v1/admin/users",
            json!({"username":"e","display_name":"编辑者","password":"editor-password-123"}),
            &cookie,
            "",
            origin
        )
        .await
        .0,
        403
    );
    let (code, e, _) = request(
        &app,
        "POST",
        "/api/v1/admin/users",
        json!({"username":"e","display_name":"编辑者","password":"editor-password-123"}),
        &cookie,
        csrf,
        origin,
    )
    .await;
    assert_eq!(code, 200);
    let eid = e["id"].as_str().unwrap();
    let (_, eu, ec) = request(
        &app,
        "POST",
        "/api/v1/auth/login",
        json!({"username":"e","password":"editor-password-123"}),
        "",
        "",
        origin,
    )
    .await;
    assert_eq!(
        request(
            &app,
            "GET",
            "/api/v1/admin/users",
            json!({}),
            &ec,
            "",
            origin
        )
        .await
        .0,
        403
    );
    let (_, g, _) = request(
        &app,
        "POST",
        "/api/v1/admin/groups",
        json!({"name":"研发"}),
        &cookie,
        csrf,
        origin,
    )
    .await;
    let gid = g["id"].as_str().unwrap();
    assert_eq!(
        request(
            &app,
            "PUT",
            &format!("/api/v1/admin/groups/{gid}/members/{eid}"),
            json!({}),
            &cookie,
            csrf,
            origin
        )
        .await
        .0,
        200
    );
    let (_, members, _) = request(
        &app,
        "GET",
        &format!("/api/v1/admin/groups/{gid}/members"),
        json!({}),
        &cookie,
        "",
        origin,
    )
    .await;
    assert_eq!(members.as_array().unwrap().len(), 1);
    assert_eq!(
        request(
            &app,
            "PATCH",
            &format!("/api/v1/admin/users/{root}"),
            json!({"display_name":"root","active":false,"is_system_admin":true}),
            &cookie,
            csrf,
            origin
        )
        .await
        .0,
        409
    );
    assert_eq!(
        request(
            &app,
            "POST",
            &format!("/api/v1/admin/users/{eid}/reset-password"),
            json!({"password":"replacement-password-123"}),
            &cookie,
            csrf,
            origin
        )
        .await
        .0,
        200
    );
    assert_eq!(
        request(&app, "GET", "/api/v1/me", json!({}), &ec, "", origin)
            .await
            .0,
        401
    );
    let (_, _, ec) = request(
        &app,
        "POST",
        "/api/v1/auth/login",
        json!({"username":"e","password":"replacement-password-123"}),
        "",
        "",
        origin,
    )
    .await;
    assert_eq!(
        request(
            &app,
            "PATCH",
            &format!("/api/v1/admin/users/{eid}"),
            json!({"display_name":"编辑者","active":false,"is_system_admin":false}),
            &cookie,
            csrf,
            origin
        )
        .await
        .0,
        200
    );
    assert_eq!(
        request(&app, "GET", "/api/v1/me", json!({}), &ec, "", origin)
            .await
            .0,
        401
    );
    for _ in 0..5 {
        assert_eq!(
            request(
                &app,
                "POST",
                "/api/v1/auth/login",
                json!({"username":"root","password":"wrong"}),
                "",
                "",
                origin
            )
            .await
            .0,
            401
        );
    }
    assert_eq!(
        request(
            &app,
            "POST",
            "/api/v1/auth/login",
            json!({"username":"root","password":"root-password-123"}),
            "",
            "",
            origin
        )
        .await
        .0,
        429
    );
    assert_eq!(
        request(
            &app,
            "POST",
            "/api/v1/auth/logout",
            json!({}),
            &cookie,
            csrf,
            origin
        )
        .await
        .0,
        204
    );
    assert_eq!(
        request(&app, "GET", "/api/v1/me", json!({}), &cookie, "", origin)
            .await
            .0,
        401
    );
    assert!(eu["csrf_token"].is_string());
    common::cleanup(pool, admin, schema).await;
}
