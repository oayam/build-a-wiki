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
    let draft_path = format!("{path}/draft");
    let mut draft = body("个人草稿");
    draft["base_revision_id"] = p["revision_id"].clone();
    draft["draft_version"] = json!(0);
    assert_eq!(
        request(&app, "PUT", &draft_path, draft.clone(), &ec, et, O)
            .await
            .0,
        200
    );
    assert_eq!(
        request(&app, "PUT", &draft_path, draft.clone(), &ec, et, O)
            .await
            .0,
        409
    );
    let (_, private, _) = request(&app, "GET", &draft_path, json!({}), &c, t, O).await;
    assert!(private["draft"].is_null());
    assert_eq!(
        request(
            &app,
            "DELETE",
            &format!("{draft_path}?draft_version=0"),
            json!({}),
            &ec,
            et,
            O
        )
        .await
        .0,
        409
    );
    assert_eq!(
        request(
            &app,
            "DELETE",
            &format!("{draft_path}?draft_version=1"),
            json!({}),
            &ec,
            et,
            O
        )
        .await
        .0,
        200
    );
    draft["draft_version"] = json!(1);
    assert_eq!(
        request(&app, "PUT", &draft_path, draft.clone(), &ec, et, O)
            .await
            .0,
        409
    );
    draft["draft_version"] = json!(2);
    assert_eq!(
        request(&app, "PUT", &draft_path, draft.clone(), &ec, et, O)
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
    let (_, current, _) = request(&app, "GET", &path, json!({}), &ec, et, O).await;
    let restore = json!({"request_id":Uuid::new_v4(),"base_revision_id":current["current_revision_id"],"revision_id":p["revision_id"]});
    let (code, restored, _) = request(
        &app,
        "POST",
        &format!("{path}/restore-revision"),
        restore.clone(),
        &ec,
        et,
        O,
    )
    .await;
    assert_eq!(code, 200, "{restored}");
    assert_eq!(restored["revision_no"], 3);
    assert_eq!(
        request(
            &app,
            "POST",
            &format!("{path}/restore-revision"),
            restore.clone(),
            &ec,
            et,
            O
        )
        .await
        .1,
        restored
    );
    let mut stale = restore;
    stale["request_id"] = json!(Uuid::new_v4());
    assert_eq!(
        request(
            &app,
            "POST",
            &format!("{path}/restore-revision"),
            stale,
            &ec,
            et,
            O
        )
        .await
        .0,
        409
    );
    let (_, history, _) = request(&app, "GET", &save, json!({}), &ec, et, O).await;
    assert_eq!(history["items"].as_array().unwrap().len(), 3);
    let (_, restored_page, _) = request(&app, "GET", &path, json!({}), &ec, et, O).await;
    assert_eq!(restored_page["title"], "根页面");
    assert_eq!(
        request(&app, "PUT", &format!("{path}/visit"), json!({}), &ec, et, O)
            .await
            .0,
        200
    );
    assert_eq!(
        request(&app, "GET", "/api/v1/recent-visits", json!({}), &ec, et, O)
            .await
            .1
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let mut sibling = body("移动目标");
    sibling["request_id"] = json!(Uuid::new_v4());
    let (_, sibling, _) = request(&app, "POST", &tree, sibling, &c, t, O).await;
    let sid = sibling["id"].as_str().unwrap();
    let spath = format!("/api/v1/pages/{sid}");
    let mut mv = json!({"parent_id":sid,"position":-10});
    let mut reverse = json!({"parent_id":pid,"position":0});
    let (code, prev, _) = request(
        &app,
        "POST",
        &format!("{path}/move-preview"),
        mv.clone(),
        &c,
        t,
        O,
    )
    .await;
    assert_eq!(code, 200, "{prev}");
    mv["preview_token"] = prev["preview_token"].clone();
    let (_, prev, _) = request(
        &app,
        "POST",
        &format!("{spath}/move-preview"),
        reverse.clone(),
        &c,
        t,
        O,
    )
    .await;
    reverse["preview_token"] = prev["preview_token"].clone();
    let move_path = format!("{path}/move");
    let reverse_path = format!("{spath}/move");
    let (a, b) = tokio::join!(
        request(&app, "POST", &move_path, mv.clone(), &c, t, O),
        request(&app, "POST", &reverse_path, reverse, &c, t, O)
    );
    assert!(
        (a.0 == 200 && b.0 != 200) || (a.0 != 200 && b.0 == 200),
        "{a:?} {b:?}"
    );
    // Normalize the structure using fresh previews; a consumed preview cannot be reused.
    assert_ne!(
        request(&app, "POST", &format!("{path}/move"), mv, &c, t, O)
            .await
            .0,
        200
    );
    for target in [&path, &spath] {
        let mut v = json!({"parent_id":null,"position":0});
        let (code, r, _) = request(
            &app,
            "POST",
            &format!("{target}/move-preview"),
            v.clone(),
            &c,
            t,
            O,
        )
        .await;
        assert_eq!(code, 200, "{r}");
        v["preview_token"] = r["preview_token"].clone();
        assert_eq!(
            request(&app, "POST", &format!("{target}/move"), v, &c, t, O)
                .await
                .0,
            200
        );
    }
    // Maximum-depth target: moving a page beneath level 64 is rejected.
    let mut deep = sid.to_owned();
    for _ in 1..64 {
        let mut v = body("深度边界");
        v["request_id"] = json!(Uuid::new_v4());
        v["parent_id"] = json!(deep);
        let (code, r, _) = request(&app, "POST", &tree, v, &c, t, O).await;
        assert_eq!(code, 200, "{r}");
        deep = r["id"].as_str().unwrap().to_owned();
    }
    assert_eq!(
        request(
            &app,
            "POST",
            &format!("{path}/move-preview"),
            json!({"parent_id":deep,"position":0}),
            &c,
            t,
            O
        )
        .await
        .0,
        422
    );
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
    assert_eq!(
        request(
            &app,
            "PUT",
            &acl,
            json!({"acl_version":2,"entries":[{"user_id":e["id"],"group_id":null,"role":3}]}),
            &c,
            t,
            O
        )
        .await
        .0,
        200
    );
    // Managing the parent does not permit moving an independently protected descendant.
    for action in ["move-preview", "move"] {
        let (code, r, _) = request(
            &app,
            "POST",
            &format!("{path}/{action}"),
            json!({"parent_id":null,"position":0}),
            &ec,
            et,
            O,
        )
        .await;
        assert_eq!(code, 403, "{r}");
        assert!(r.get("affected_pages").is_none());
    }
    // Hold the real authorization barrier while a real HTTP save waits for revocation.
    let mut revoke = pool.begin().await.unwrap();
    sqlx::query("SELECT id FROM auth_guard WHERE id=1 FOR UPDATE")
        .execute(&mut *revoke)
        .await
        .unwrap();
    let revoker_pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *revoke)
        .await
        .unwrap();
    sqlx::query("DELETE FROM knowledge_base_acl WHERE knowledge_base_id=$1")
        .bind(Uuid::parse_str(kid).unwrap())
        .execute(&mut *revoke)
        .await
        .unwrap();
    let mut pending = body("撤权竞态");
    pending["request_id"] = json!(Uuid::new_v4());
    pending["base_revision_id"] = restored["revision_id"].clone();
    let save_app = app.clone();
    let save_cookie = ec.clone();
    let save_csrf = et.to_owned();
    let save_url = save.clone();
    let waiting = tokio::spawn(async move {
        request(
            &save_app,
            "POST",
            &save_url,
            pending,
            &save_cookie,
            &save_csrf,
            O,
        )
        .await
    });
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            let blocked: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)))",
            )
            .bind(revoker_pid)
            .fetch_one(&pool)
            .await
            .unwrap();
            if blocked {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    revoke.commit().await.unwrap();
    assert_eq!(waiting.await.unwrap().0, 404);

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
    let mut denied = body("unauthorized");
    denied["request_id"] = json!(Uuid::new_v4());
    denied["base_revision_id"] = restored["revision_id"].clone();
    assert_eq!(
        request(&app, "POST", &save, denied, &ec, et, O).await.0,
        404
    );
    assert!(
        request(&app, "GET", "/api/v1/recent-visits", json!({}), &ec, et, O)
            .await
            .1
            .as_array()
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        request(&app, "GET", &draft_path, json!({}), &ec, et, O)
            .await
            .0,
        404
    );
    assert_eq!(
        request(&app, "PUT", &draft_path, draft, &ec, et, O).await.0,
        404
    );
    assert_eq!(
        request(
            &app,
            "DELETE",
            &format!("{draft_path}?draft_version=3"),
            json!({}),
            &ec,
            et,
            O
        )
        .await
        .0,
        404
    );
    assert_eq!(
        request(&app, "GET", &save, json!({}), &ec, et, O).await.0,
        404
    );
    assert_eq!(
        request(
            &app,
            "GET",
            &format!("{save}/{}", p["revision_id"].as_str().unwrap()),
            json!({}),
            &ec,
            et,
            O
        )
        .await
        .0,
        404
    );
    common::cleanup(pool, admin, schema).await;
}
