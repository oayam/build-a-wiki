use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier, password_hash::SaltString};
use sha2::{Digest, Sha256};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;
// TODO(SEC-001): 正式部署前恢复12字符下限，并同步前端、测试和账号改密；见 docs/TODO.md。
const MIN_PASSWORD_CHARS: usize = 8;
pub fn hash_password(password: &str) -> Result<String, String> {
    if password.chars().count() < MIN_PASSWORD_CHARS || password.len() > 256 {
        return Err("密码至少8个字符，最多256字节（临时开发策略）".into());
    }
    let salt = SaltString::encode_b64(Uuid::new_v4().as_bytes()).map_err(|_| "密码处理失败")?;
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|_| "密码处理失败".into())
}
pub fn verify_password(password: &str, hash: &str) -> bool {
    PasswordHash::new(hash).is_ok_and(|h| {
        Argon2::default()
            .verify_password(password.as_bytes(), &h)
            .is_ok()
    })
}
pub fn token_hash(token: &str) -> String {
    format!("{:x}", Sha256::digest(token.as_bytes()))
}
pub fn random_token() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}
pub async fn guard(tx: &mut Transaction<'_, Postgres>) -> Result<(), sqlx::Error> {
    sqlx::query("SELECT id FROM auth_guard WHERE id=1 FOR UPDATE")
        .execute(&mut **tx)
        .await?;
    Ok(())
}
/// Only explicit non-secret fields are accepted; never persist arbitrary request bodies.
pub async fn audit(
    tx: &mut Transaction<'_, Postgres>,
    actor: Option<Uuid>,
    action: &str,
    resource: Option<Uuid>,
    request_id: &str,
    details: serde_json::Value,
) -> Result<(), sqlx::Error> {
    let mut safe = serde_json::Map::new();
    if let Some(map) = details.as_object() {
        for key in ["role", "active", "acl_version", "member_count", "owner_id"] {
            if let Some(value) = map.get(key) {
                safe.insert(key.into(), value.clone());
            }
        }
    }
    sqlx::query("INSERT INTO audit_events(id,actor_id,action,resource_type,resource_id,request_id,details) VALUES($1,$2,$3,$4,$5,$6,$7)").bind(Uuid::new_v4()).bind(actor).bind(action).bind(action.split('.').next().unwrap_or("system")).bind(resource).bind(request_id).bind(serde_json::Value::Object(safe)).execute(&mut **tx).await?;
    Ok(())
}
pub async fn bootstrap(
    pool: &sqlx::PgPool,
    username: &str,
    password: &str,
) -> Result<Uuid, String> {
    if username.trim() != username || username.is_empty() || username.len() > 64 {
        return Err("无效用户名".into());
    }
    let hash = hash_password(password)?;
    let mut tx = pool.begin().await.map_err(|_| "数据库错误")?;
    guard(&mut tx).await.map_err(|_| "数据库错误")?;
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users)")
        .fetch_one(&mut *tx)
        .await
        .map_err(|_| "数据库错误")?;
    if exists {
        return Err("初始化已关闭".into());
    }
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO users(id,username,display_name,password_hash,is_system_admin) VALUES($1,$2,$2,$3,true)").bind(id).bind(username).bind(hash).execute(&mut *tx).await.map_err(|_|"数据库错误")?;
    audit(
        &mut tx,
        Some(id),
        "system.bootstrap",
        Some(id),
        &Uuid::new_v4().to_string(),
        serde_json::json!({}),
    )
    .await
    .map_err(|_| "数据库错误")?;
    tx.commit().await.map_err(|_| "数据库错误")?;
    Ok(id)
}

#[cfg(test)]
mod password_policy_tests {
    use super::*;
    #[test]
    fn temporary_minimum_and_hash_verification() {
        assert!(hash_password("1234567").is_err());
        let hash = hash_password("test123.").unwrap();
        assert!(verify_password("test123.", &hash));
        assert!(!verify_password("wrong123", &hash));
        assert!(hash_password(&"a".repeat(257)).is_err());
    }
}
