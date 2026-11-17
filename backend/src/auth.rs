use crate::{
    http::{AppState, RequestId, error},
    identity::*,
};
use axum::{
    Json, Router,
    extract::{Extension, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Postgres, Transaction};
use utoipa::ToSchema;
use uuid::Uuid;
#[derive(Clone)]
pub struct Security {
    pub origin: String,
    pub secure: bool,
    pub ttl: i32,
}
impl Default for Security {
    fn default() -> Self {
        Self {
            origin: "http://127.0.0.1:5173".into(),
            secure: false,
            ttl: 28800,
        }
    }
}
impl Security {
    pub fn from_env() -> std::result::Result<Self, String> {
        let origin = std::env::var("APP_BASE_URL").map_err(|_| "APP_BASE_URL required")?;
        let uri: axum::http::Uri = origin.parse().map_err(|_| "invalid APP_BASE_URL")?;
        if !matches!(uri.scheme_str(), Some("http" | "https"))
            || uri.authority().is_none()
            || uri.path_and_query().is_some_and(|p| p.as_str() != "/")
            || origin.ends_with('/')
        {
            return Err("APP_BASE_URL must be an origin without trailing slash".into());
        }
        let secure = uri.scheme_str() == Some("https");
        if !secure && !matches!(uri.host(), Some("localhost" | "127.0.0.1" | "[::1]")) {
            return Err("non-local deployment requires HTTPS".into());
        }
        let ttl = std::env::var("SESSION_TTL")
            .unwrap_or_else(|_| "28800".into())
            .parse::<i32>()
            .map_err(|_| "invalid SESSION_TTL")?;
        if !(60..=604800).contains(&ttl) {
            return Err("SESSION_TTL outside 60..604800".into());
        }
        Ok(Self {
            origin,
            secure,
            ttl,
        })
    }
}
#[derive(Debug)]
pub struct Failure(pub StatusCode, pub &'static str, pub &'static str);
pub type Result<T> = std::result::Result<T, Failure>;
impl From<sqlx::Error> for Failure {
    fn from(e: sqlx::Error) -> Self {
        if let sqlx::Error::Database(ref db) = e {
            if db.is_unique_violation() {
                return Self(StatusCode::CONFLICT, "CONFLICT", "记录已存在");
            }
            if db.is_foreign_key_violation() || db.is_check_violation() {
                return Self(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "VALIDATION_ERROR",
                    "引用或输入无效",
                );
            }
        }
        Self(
            StatusCode::INTERNAL_SERVER_ERROR,
            "INTERNAL_ERROR",
            "服务内部错误",
        )
    }
}
impl Failure {
    pub fn response(self, id: &RequestId) -> Response {
        error(self.0, self.1, self.2, id)
    }
}
pub fn invalid() -> Failure {
    Failure(
        StatusCode::UNPROCESSABLE_ENTITY,
        "VALIDATION_ERROR",
        "输入无效",
    )
}
pub fn denied() -> Failure {
    Failure(StatusCode::FORBIDDEN, "FORBIDDEN", "没有操作权限")
}
pub fn missing() -> Failure {
    Failure(StatusCode::NOT_FOUND, "NOT_FOUND", "资源不存在")
}
pub fn unauth() -> Failure {
    Failure(StatusCode::UNAUTHORIZED, "UNAUTHENTICATED", "请重新登录")
}
#[derive(Clone, Serialize, FromRow, ToSchema)]
pub struct Actor {
    pub id: Uuid,
    pub username: String,
    pub display_name: String,
    pub is_system_admin: bool,
    pub csrf_token: String,
}
fn session_token(headers: &HeaderMap) -> Result<String> {
    headers
        .get(header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| {
            v.split(';')
                .find_map(|p| p.trim().strip_prefix("wiki_session="))
        })
        .filter(|v| v.len() == 64)
        .map(str::to_owned)
        .ok_or_else(unauth)
}
pub fn origin(state: &AppState, headers: &HeaderMap) -> Result<()> {
    if headers.get(header::ORIGIN).and_then(|v| v.to_str().ok())
        != Some(state.security.origin.as_str())
    {
        return Err(denied());
    }
    Ok(())
}
pub async fn actor(tx: &mut Transaction<'_, Postgres>, headers: &HeaderMap) -> Result<Actor> {
    let token = session_token(headers)?;
    sqlx::query_as("SELECT u.id,u.username,u.display_name,u.is_system_admin,s.csrf_token FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND u.active").bind(token_hash(&token)).fetch_optional(&mut **tx).await?.ok_or_else(unauth)
}
pub async fn transaction<'a>(
    state: &'a AppState,
    headers: &HeaderMap,
    write: bool,
) -> Result<(Transaction<'a, Postgres>, Actor)> {
    let mut tx = state.pool.begin().await?;
    if write {
        origin(state, headers)?;
        guard(&mut tx).await?;
        let maintenance: bool = sqlx::query_scalar("SELECT maintenance FROM auth_guard WHERE id=1")
            .fetch_one(&mut *tx)
            .await?;
        if maintenance {
            return Err(Failure(
                StatusCode::SERVICE_UNAVAILABLE,
                "MAINTENANCE",
                "系统维护中，请稍后重试",
            ));
        }
    } else {
        sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
            .execute(&mut *tx)
            .await?;
    }
    let user = actor(&mut tx, headers).await?;
    if write
        && headers.get("x-csrf-token").and_then(|v| v.to_str().ok())
            != Some(user.csrf_token.as_str())
    {
        return Err(denied());
    }
    Ok((tx, user))
}
pub fn admin(actor: &Actor) -> Result<()> {
    if actor.is_system_admin {
        Ok(())
    } else {
        Err(denied())
    }
}
#[derive(Deserialize, ToSchema)]
pub struct Login {
    pub username: String,
    pub password: String,
}
fn cookie(token: &str, state: &AppState, age: i32) -> String {
    format!(
        "wiki_session={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={age}{}",
        if state.security.secure {
            "; Secure"
        } else {
            ""
        }
    )
}
#[utoipa::path(post,path="/api/v1/auth/login",request_body=Login,responses((status=200,body=Actor),(status=401,body=crate::http::ApiError),(status=429,body=crate::http::ApiError)))]
pub async fn login(
    State(state): State<AppState>,
    Extension(id): Extension<RequestId>,
    headers: HeaderMap,
    Json(input): Json<Login>,
) -> Response {
    let result=async{
  origin(&state,&headers)?;if input.username.is_empty()||input.username.len()>64||input.password.len()>256{return Err(invalid());}
  let mut tx=state.pool.begin().await?;guard(&mut tx).await?;
  for key in ["__global__",input.username.as_str()] {
   sqlx::query("INSERT INTO login_attempts(username) VALUES($1) ON CONFLICT DO NOTHING").bind(key).execute(&mut *tx).await?;
   sqlx::query("UPDATE login_attempts SET failures=0,window_start=now() WHERE username=$1 AND window_start<now()-interval '15 minutes'").bind(key).execute(&mut *tx).await?;
   let n:i32=sqlx::query_scalar("SELECT failures FROM login_attempts WHERE username=$1").bind(key).fetch_one(&mut *tx).await?;
   if n>=if key=="__global__"{100}else{5}{return Err(Failure(StatusCode::TOO_MANY_REQUESTS,"RATE_LIMITED","登录失败过多，请稍后重试"));}
  }
  let row:Option<(Uuid,String,bool)>=sqlx::query_as("SELECT id,password_hash,active FROM users WHERE username=$1").bind(&input.username).fetch_optional(&mut *tx).await?;
  let valid=if let Some((_,hash,active))=&row{*active&&verify_password(&input.password,hash)}else{let _=hash_password("dummy-password-for-timing");false};
  if !valid{
   sqlx::query("UPDATE login_attempts SET failures=failures+1 WHERE username IN($1,'__global__')").bind(&input.username).execute(&mut *tx).await?;
   audit(&mut tx,None,"auth.failed",None,&id.0,serde_json::json!({})).await?;tx.commit().await?;return Err(unauth());
  }
  let user_id=row.unwrap().0;let token=random_token();let csrf=random_token();
  sqlx::query("INSERT INTO sessions(id,user_id,token_hash,csrf_token,expires_at) VALUES($1,$2,$3,$4,now()+make_interval(secs=>$5))").bind(Uuid::new_v4()).bind(user_id).bind(token_hash(&token)).bind(&csrf).bind(f64::from(state.security.ttl)).execute(&mut *tx).await?;
  sqlx::query("DELETE FROM login_attempts WHERE username=$1").bind(&input.username).execute(&mut *tx).await?;
  audit(&mut tx,Some(user_id),"auth.login",Some(user_id),&id.0,serde_json::json!({})).await?;
  let user:Actor=sqlx::query_as("SELECT id,username,display_name,is_system_admin,$2::text AS csrf_token FROM users WHERE id=$1").bind(user_id).bind(csrf).fetch_one(&mut *tx).await?;
  tx.commit().await?;Ok::<_,Failure>((token,user))
 }.await;
    match result {
        Ok((token, user)) => {
            let mut r = Json(user).into_response();
            r.headers_mut().insert(
                header::SET_COOKIE,
                cookie(&token, &state, state.security.ttl).parse().unwrap(),
            );
            r
        }
        Err(e) => e.response(&id),
    }
}
#[utoipa::path(get,path="/api/v1/me",responses((status=200,body=Actor),(status=401,body=crate::http::ApiError)))]
pub async fn me(
    State(state): State<AppState>,
    Extension(id): Extension<RequestId>,
    headers: HeaderMap,
) -> Response {
    match transaction(&state, &headers, false).await {
        Ok((_, user)) => Json(user).into_response(),
        Err(e) => e.response(&id),
    }
}
#[utoipa::path(post,path="/api/v1/auth/logout",responses((status=204),(status=401,body=crate::http::ApiError)))]
pub async fn logout(
    State(state): State<AppState>,
    Extension(id): Extension<RequestId>,
    headers: HeaderMap,
) -> Response {
    let r = async {
        let (mut tx, user) = transaction(&state, &headers, true).await?;
        sqlx::query("UPDATE sessions SET revoked_at=now() WHERE token_hash=$1")
            .bind(token_hash(&session_token(&headers)?))
            .execute(&mut *tx)
            .await?;
        audit(
            &mut tx,
            Some(user.id),
            "auth.logout",
            Some(user.id),
            &id.0,
            serde_json::json!({}),
        )
        .await?;
        tx.commit().await?;
        Ok::<_, Failure>(())
    }
    .await;
    match r {
        Ok(()) => {
            let mut r = StatusCode::NO_CONTENT.into_response();
            r.headers_mut()
                .insert(header::SET_COOKIE, cookie("", &state, 0).parse().unwrap());
            r
        }
        Err(e) => e.response(&id),
    }
}
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/v1/auth/login", post(login))
        .route("/api/v1/auth/logout", post(logout))
        .route("/api/v1/me", get(me))
}
