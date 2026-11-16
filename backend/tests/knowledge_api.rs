mod common;
use common::request;
use serde_json::json;
#[tokio::test]
async fn knowledge_acl_transfer_and_independent_pages() {
    let (pool, admin, schema) = common::database().await;
    wiki_api::identity::bootstrap(&pool, "root", "root-password-123")
        .await
        .unwrap();
    let app = wiki_api::http::router(wiki_api::http::AppState {
        pool: pool.clone(),
        attachment_dir: "/tmp".into(),
        security: Default::default(),
    });
    let o = "http://127.0.0.1:5173";
    let (_, root, rc) = request(
        &app,
        "POST",
        "/api/v1/auth/login",
        json!({"username":"root","password":"root-password-123"}),
        "",
        "",
        o,
    )
    .await;
    let rt = root["csrf_token"].as_str().unwrap();
    let mut users = Vec::new();
    for name in ["owner", "editor", "reader", "outsider"] {
        let (code, u, _) = request(
            &app,
            "POST",
            "/api/v1/admin/users",
            json!({"username":name,"display_name":name,"password":"member-password-123"}),
            &rc,
            rt,
            o,
        )
        .await;
        assert_eq!(code, 200);
        let (_, session, c) = request(
            &app,
            "POST",
            "/api/v1/auth/login",
            json!({"username":name,"password":"member-password-123"}),
            "",
            "",
            o,
        )
        .await;
        users.push((
            u["id"].as_str().unwrap().to_owned(),
            c,
            session["csrf_token"].as_str().unwrap().to_owned(),
        ));
    }
    let (owner, oc, ot) = &users[0];
    let (editor, ec, et) = &users[1];
    let (reader, vc, vt) = &users[2];
    let (outsider, nc, nt) = &users[3];
    let (code, k, _) = request(
        &app,
        "POST",
        "/api/v1/knowledge-bases",
        json!({"name":"私有研发库"}),
        oc,
        ot,
        o,
    )
    .await;
    assert_eq!(code, 200);
    let kid = k["id"].as_str().unwrap();
    let path = format!("/api/v1/knowledge-bases/{kid}");
    let acl = format!("{path}/permissions");
    assert_eq!(
        request(&app, "GET", &path, json!({}), nc, nt, o).await.0,
        404
    );
    let (_, list, _) = request(&app, "GET", "/api/v1/knowledge-bases", json!({}), nc, nt, o).await;
    assert_eq!(list["items"].as_array().unwrap().len(), 0);
    let entries = json!([{"user_id":editor,"group_id":null,"role":2},{"user_id":reader,"group_id":null,"role":1}]);
    assert_eq!(
        request(
            &app,
            "PUT",
            &acl,
            json!({"acl_version":1,"entries":entries}),
            oc,
            ot,
            o
        )
        .await
        .0,
        200
    );
    assert_eq!(
        request(
            &app,
            "PUT",
            &acl,
            json!({"acl_version":1,"entries":[]}),
            oc,
            ot,
            o
        )
        .await
        .0,
        409
    );
    assert_eq!(
        request(
            &app,
            "PUT",
            &acl,
            json!({"acl_version":2,"entries":[]}),
            ec,
            et,
            o
        )
        .await
        .0,
        403
    );
    assert_eq!(
        request(
            &app,
            "GET",
            &format!("{path}/subjects"),
            json!({}),
            vc,
            vt,
            o
        )
        .await
        .0,
        403
    );
    let (_, preview, _) = request(&app, "GET", &acl, json!({}), vc, vt, o).await;
    assert_eq!(preview["role"], 1);
    assert!(preview["entries"].is_null());
    let pid = uuid::Uuid::new_v4();
    let rid = uuid::Uuid::new_v4();
    let mut tx = pool.begin().await.unwrap();
    sqlx::query("INSERT INTO pages(id,knowledge_base_id,title,created_by,current_revision_id) VALUES($1,$2,'fixture',$3,$4)").bind(pid).bind(uuid::Uuid::parse_str(kid).unwrap()).bind(uuid::Uuid::parse_str(owner).unwrap()).bind(rid).execute(&mut *tx).await.unwrap();
    sqlx::query("INSERT INTO page_revisions(id,page_id,revision_no,title,schema_version,body_json,body_text,editor_id) VALUES($1,$2,1,'fixture',1,'{}','',$3)").bind(rid).bind(pid).bind(uuid::Uuid::parse_str(owner).unwrap()).execute(&mut *tx).await.unwrap();
    tx.commit().await.unwrap();
    let page_acl = format!("/api/v1/pages/{pid}/permissions");
    let (_, p, _) = request(&app, "GET", &page_acl, json!({}), ec, et, o).await;
    assert_eq!(p["role"], 2);
    assert_eq!(p["inherited"], true);
    assert_eq!(request(&app,"PUT",&page_acl,json!({"acl_version":1,"acl_mode":"independent","entries":[{"user_id":outsider,"group_id":null,"role":3}]}),oc,ot,o).await.0,200);
    assert_eq!(
        request(&app, "GET", &page_acl, json!({}), ec, et, o)
            .await
            .0,
        404
    );
    assert_eq!(
        request(&app, "GET", &page_acl, json!({}), nc, nt, o)
            .await
            .0,
        200
    );
    assert_eq!(
        request(
            &app,
            "PUT",
            &acl,
            json!({"acl_version":2,"entries":[]}),
            nc,
            nt,
            o
        )
        .await
        .0,
        404
    );
    assert_eq!(
        request(
            &app,
            "PATCH",
            &format!("/api/v1/admin/users/{owner}"),
            json!({"display_name":"owner","active":false,"is_system_admin":false}),
            &rc,
            rt,
            o
        )
        .await
        .0,
        409
    );
    assert_eq!(
        request(
            &app,
            "POST",
            &format!("{path}/transfer-ownership"),
            json!({"owner_id":reader}),
            oc,
            ot,
            o
        )
        .await
        .0,
        200
    );
    assert_eq!(
        request(&app, "GET", &path, json!({}), oc, ot, o).await.0,
        404
    );
    assert_eq!(
        request(
            &app,
            "PUT",
            &acl,
            json!({"acl_version":3,"entries":[]}),
            vc,
            vt,
            o
        )
        .await
        .0,
        200
    );
    assert_eq!(
        request(&app, "GET", &path, json!({}), ec, et, o).await.0,
        404
    );
    common::cleanup(pool, admin, schema).await;
}
