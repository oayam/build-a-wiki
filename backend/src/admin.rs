use crate::constants::{audit_action, error_code, message};
use crate::{
    auth::*,
    http::{AppState, RequestId},
    identity::*,
};
use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::HeaderMap,
    response::{IntoResponse, Response},
    routing::{get, patch, post, put},
};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use utoipa::ToSchema;
use uuid::Uuid;
#[derive(Serialize, FromRow, ToSchema)]
pub struct User {
    pub id: Uuid,
    pub username: String,
    pub display_name: String,
    pub active: bool,
    pub is_system_admin: bool,
}
#[derive(Deserialize, ToSchema)]
pub struct NewUser {
    pub username: String,
    pub display_name: String,
    pub password: String,
}
#[derive(Deserialize, ToSchema)]
pub struct UpdateUser {
    pub display_name: String,
    pub active: bool,
    pub is_system_admin: bool,
}
#[derive(Deserialize, ToSchema)]
pub struct Password {
    pub password: String,
}
#[derive(Deserialize, ToSchema)]
pub struct NewGroup {
    pub name: String,
}
#[derive(Serialize, FromRow, ToSchema)]
pub struct Group {
    pub id: Uuid,
    pub name: String,
}
pub fn text(s: &str, max: usize) -> Result<()> {
    if s.trim().is_empty() || s.len() > max {
        Err(invalid())
    } else {
        Ok(())
    }
}
fn response<T: Serialize>(r: Result<T>, id: &RequestId) -> Response {
    match r {
        Ok(v) => Json(v).into_response(),
        Err(e) => e.response(id),
    }
}
#[utoipa::path(get,path="/api/v1/admin/users",responses((status=200,body=Vec<User>)))]
pub async fn users(
    State(s): State<AppState>,
    Extension(id): Extension<RequestId>,
    h: HeaderMap,
) -> Response {
    response(async{let(mut tx,u)=transaction(&s,&h,false).await?;admin(&u)?;Ok(sqlx::query_as::<_,User>("SELECT id,username,display_name,active,is_system_admin FROM users ORDER BY username,id").fetch_all(&mut *tx).await?)}.await,&id)
}
#[utoipa::path(post,path="/api/v1/admin/users",request_body=NewUser,responses((status=200,body=User)))]
pub async fn create_user(
    State(s): State<AppState>,
    Extension(id): Extension<RequestId>,
    h: HeaderMap,
    Json(v): Json<NewUser>,
) -> Response {
    response(async{
 let(mut tx,u)=transaction(&s,&h,true).await?;admin(&u)?;text(&v.username,64)?;text(&v.display_name,100)?;let hash=hash_password(&v.password).map_err(|_|invalid())?;let new=Uuid::new_v4();
 let row=sqlx::query_as::<_,User>("INSERT INTO users(id,username,display_name,password_hash) VALUES($1,$2,$3,$4) RETURNING id,username,display_name,active,is_system_admin").bind(new).bind(v.username).bind(v.display_name).bind(hash).fetch_one(&mut *tx).await?;
 audit(&mut tx,Some(u.id),audit_action::USERS_CREATE,Some(new),&id.0,serde_json::json!({})).await?;tx.commit().await?;Ok(row)
 }.await,&id)
}
#[utoipa::path(patch,path="/api/v1/admin/users/{id}",request_body=UpdateUser,responses((status=200,body=User)))]
pub async fn update_user(
    State(s): State<AppState>,
    Extension(id): Extension<RequestId>,
    h: HeaderMap,
    Path(target): Path<Uuid>,
    Json(v): Json<UpdateUser>,
) -> Response {
    response(async{
 let(mut tx,u)=transaction(&s,&h,true).await?;admin(&u)?;text(&v.display_name,100)?;
 let old:User=sqlx::query_as("SELECT id,username,display_name,active,is_system_admin FROM users WHERE id=$1").bind(target).fetch_optional(&mut *tx).await?.ok_or_else(missing)?;
 if old.active&&old.is_system_admin&&(!v.active||!v.is_system_admin){let count:i64=sqlx::query_scalar("SELECT count(*) FROM users WHERE active AND is_system_admin").fetch_one(&mut *tx).await?;if count<=1{return Err(Failure(axum::http::StatusCode::CONFLICT,error_code::LAST_ADMIN,message::LAST_ADMIN));}}
 if !v.active {
  let exists:bool=sqlx::query_scalar("SELECT to_regclass('knowledge_bases') IS NOT NULL").fetch_one(&mut *tx).await?;
  if exists {let owns:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM knowledge_bases WHERE owner_id=$1)").bind(target).fetch_one(&mut *tx).await?;if owns{return Err(Failure(axum::http::StatusCode::CONFLICT,error_code::OWNER_TRANSFER_REQUIRED,message::OWNER_TRANSFER_REQUIRED));}}
 }
 let row=sqlx::query_as::<_,User>("UPDATE users SET display_name=$2,active=$3,is_system_admin=$4 WHERE id=$1 RETURNING id,username,display_name,active,is_system_admin").bind(target).bind(v.display_name).bind(v.active).bind(v.is_system_admin).fetch_one(&mut *tx).await?;
 if !v.active||old.is_system_admin!=v.is_system_admin{sqlx::query("UPDATE sessions SET revoked_at=now() WHERE user_id=$1").bind(target).execute(&mut *tx).await?;}
 audit(&mut tx,Some(u.id),audit_action::USERS_UPDATE,Some(target),&id.0,serde_json::json!({"active":v.active})).await?;tx.commit().await?;Ok(row)
 }.await,&id)
}
#[utoipa::path(post,path="/api/v1/admin/users/{id}/reset-password",request_body=Password,responses((status=200,body=serde_json::Value)))]
pub async fn reset_password(
    State(s): State<AppState>,
    Extension(id): Extension<RequestId>,
    h: HeaderMap,
    Path(target): Path<Uuid>,
    Json(v): Json<Password>,
) -> Response {
    response(
        async {
            let (mut tx, u) = transaction(&s, &h, true).await?;
            admin(&u)?;
            let hash = hash_password(&v.password).map_err(|_| invalid())?;
            if sqlx::query("UPDATE users SET password_hash=$2 WHERE id=$1")
                .bind(target)
                .bind(hash)
                .execute(&mut *tx)
                .await?
                .rows_affected()
                == 0
            {
                return Err(missing());
            }
            sqlx::query("UPDATE sessions SET revoked_at=now() WHERE user_id=$1")
                .bind(target)
                .execute(&mut *tx)
                .await?;
            audit(
                &mut tx,
                Some(u.id),
                audit_action::USERS_RESET_PASSWORD,
                Some(target),
                &id.0,
                serde_json::json!({}),
            )
            .await?;
            tx.commit().await?;
            Ok(serde_json::json!({"ok":true}))
        }
        .await,
        &id,
    )
}
#[utoipa::path(get,path="/api/v1/admin/groups",responses((status=200,body=Vec<Group>)))]
pub async fn groups(
    State(s): State<AppState>,
    Extension(id): Extension<RequestId>,
    h: HeaderMap,
) -> Response {
    response(
        async {
            let (mut tx, u) = transaction(&s, &h, false).await?;
            admin(&u)?;
            Ok(
                sqlx::query_as::<_, Group>("SELECT id,name FROM groups ORDER BY name,id")
                    .fetch_all(&mut *tx)
                    .await?,
            )
        }
        .await,
        &id,
    )
}
#[utoipa::path(post,path="/api/v1/admin/groups",request_body=NewGroup,responses((status=200,body=Group)))]
pub async fn create_group(
    State(s): State<AppState>,
    Extension(id): Extension<RequestId>,
    h: HeaderMap,
    Json(v): Json<NewGroup>,
) -> Response {
    response(
        async {
            let (mut tx, u) = transaction(&s, &h, true).await?;
            admin(&u)?;
            text(&v.name, 100)?;
            let new = Uuid::new_v4();
            let row = sqlx::query_as::<_, Group>(
                "INSERT INTO groups(id,name) VALUES($1,$2) RETURNING id,name",
            )
            .bind(new)
            .bind(v.name)
            .fetch_one(&mut *tx)
            .await?;
            audit(
                &mut tx,
                Some(u.id),
                audit_action::GROUPS_CREATE,
                Some(new),
                &id.0,
                serde_json::json!({}),
            )
            .await?;
            tx.commit().await?;
            Ok(row)
        }
        .await,
        &id,
    )
}
#[utoipa::path(get,path="/api/v1/admin/groups/{id}/members",responses((status=200,body=Vec<User>)))]
pub async fn members(
    State(s): State<AppState>,
    Extension(id): Extension<RequestId>,
    h: HeaderMap,
    Path(group): Path<Uuid>,
) -> Response {
    response(async{let(mut tx,u)=transaction(&s,&h,false).await?;admin(&u)?;Ok(sqlx::query_as::<_,User>("SELECT u.id,u.username,u.display_name,u.active,u.is_system_admin FROM users u JOIN group_members m ON m.user_id=u.id WHERE m.group_id=$1 ORDER BY u.username").bind(group).fetch_all(&mut *tx).await?)}.await,&id)
}
async fn membership(
    s: AppState,
    id: RequestId,
    h: HeaderMap,
    group: Uuid,
    user: Uuid,
    add: bool,
) -> Response {
    response(async{let(mut tx,u)=transaction(&s,&h,true).await?;admin(&u)?;
 if add {sqlx::query("INSERT INTO group_members(group_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING").bind(group).bind(user).execute(&mut *tx).await?;}else{sqlx::query("DELETE FROM group_members WHERE group_id=$1 AND user_id=$2").bind(group).bind(user).execute(&mut *tx).await?;}
 audit(&mut tx,Some(u.id),if add{audit_action::GROUPS_ADD_MEMBER}else{audit_action::GROUPS_REMOVE_MEMBER},Some(group),&id.0,serde_json::json!({})).await?;tx.commit().await?;Ok(serde_json::json!({"ok":true}))}.await,&id)
}
#[utoipa::path(put,path="/api/v1/admin/groups/{id}/members/{user_id}",responses((status=200,body=serde_json::Value)))]
pub async fn add_member(
    State(s): State<AppState>,
    Extension(id): Extension<RequestId>,
    h: HeaderMap,
    Path((g, u)): Path<(Uuid, Uuid)>,
) -> Response {
    membership(s, id, h, g, u, true).await
}
#[utoipa::path(delete,path="/api/v1/admin/groups/{id}/members/{user_id}",responses((status=200,body=serde_json::Value)))]
pub async fn remove_member(
    State(s): State<AppState>,
    Extension(id): Extension<RequestId>,
    h: HeaderMap,
    Path((g, u)): Path<(Uuid, Uuid)>,
) -> Response {
    membership(s, id, h, g, u, false).await
}
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/v1/admin/users", get(users).post(create_user))
        .route("/api/v1/admin/users/{id}", patch(update_user))
        .route(
            "/api/v1/admin/users/{id}/reset-password",
            post(reset_password),
        )
        .route("/api/v1/admin/groups", get(groups).post(create_group))
        .route("/api/v1/admin/groups/{id}/members", get(members))
        .route(
            "/api/v1/admin/groups/{id}/members/{user_id}",
            put(add_member).delete(remove_member),
        )
}
