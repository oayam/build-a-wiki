use crate::constants::{
    attachment_status, audit_action, env, error_code, job_kind, media_type, message, protocol,
};
use crate::{
    auth::*,
    http::{AppState, RequestId},
    identity::audit,
    jobs,
    pages::{conflict, response},
    permissions::require,
};
use axum::{
    Router,
    body::Body,
    extract::{DefaultBodyLimit, Extension, Path, Query, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use http_body_util::BodyExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::FromRow;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use utoipa::ToSchema;
use uuid::Uuid;
#[derive(Deserialize)]
pub struct UploadQuery {
    pub request_id: Uuid,
    pub name: String,
    pub sha256: String,
}
#[derive(Serialize, FromRow, ToSchema)]
pub struct Attachment {
    pub id: Uuid,
    pub original_name: String,
    pub mime_type: String,
    pub size: i64,
    pub checksum: String,
}
pub fn max_bytes() -> u64 {
    std::env::var(env::UPLOAD_MAX_BYTES)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(50 * 1024 * 1024)
}
fn io_error() -> Failure {
    Failure(
        StatusCode::SERVICE_UNAVAILABLE,
        error_code::STORAGE_UNAVAILABLE,
        message::STORAGE_UNAVAILABLE,
    )
}
fn image_type(prefix: &[u8]) -> &'static str {
    if prefix.starts_with(b"\x89PNG\r\n\x1a\n") {
        media_type::PNG
    } else if prefix.starts_with(&[255, 216, 255]) {
        media_type::JPEG
    } else if prefix.starts_with(b"GIF87a") || prefix.starts_with(b"GIF89a") {
        media_type::GIF
    } else if prefix.starts_with(b"RIFF") && prefix.get(8..12) == Some(b"WEBP") {
        media_type::WEBP
    } else {
        media_type::OCTET_STREAM
    }
}
#[utoipa::path(post,operation_id="upload_attachment",path="/api/v1/pages/{id}/attachments",params(("request_id"=Uuid,Query),("name"=String,Query),("sha256"=String,Query)),request_body(content=String,content_type="application/octet-stream"),responses((status=200,body=Attachment)))]
pub async fn upload(
    State(s): State<AppState>,
    Extension(id): Extension<RequestId>,
    h: HeaderMap,
    Path(p): Path<Uuid>,
    Query(v): Query<UploadQuery>,
    mut body: Body,
) -> Response {
    response(async{
 if v.name.is_empty()||v.name.chars().count()>200||v.name.contains(['/', '\\'])||v.name.chars().any(char::is_control)||v.sha256.len()!=64||!v.sha256.bytes().all(|b|b.is_ascii_hexdigit()){return Err(invalid());}
 let(mut tx,u)=transaction(&s,&h,true).await?;require(&mut tx,&u,p,true,2).await?;
 let existing:Option<(Uuid,String,String,String)>=sqlx::query_as("SELECT id,status,original_name,checksum FROM attachments WHERE page_id=$1 AND uploader_id=$2 AND upload_id=$3").bind(p).bind(u.id).bind(v.request_id).fetch_optional(&mut *tx).await?;
 if let Some((a,status,name,checksum))=existing{if name!=v.name||checksum!=v.sha256{return Err(conflict(error_code::IDEMPOTENCY_CONFLICT,message::UPLOAD_IDEMPOTENCY_CONFLICT));}
 if status!=attachment_status::READY{return Err(conflict(error_code::UPLOAD_PENDING,message::UPLOAD_PENDING));}return Ok(sqlx::query_as::<_,Attachment>("SELECT id,original_name,mime_type,size,checksum FROM attachments WHERE id=$1").bind(a).fetch_one(&mut *tx).await?);}
 let a=Uuid::new_v4();let key=a.to_string();
 sqlx::query("INSERT INTO attachments(id,page_id,uploader_id,upload_id,storage_key,original_name,mime_type,checksum,status) VALUES($1,$2,$3,$4,$5,$6,'application/octet-stream',$7,'pending')").bind(a).bind(p).bind(u.id).bind(v.request_id).bind(&key).bind(&v.name).bind(&v.sha256).execute(&mut *tx).await?;
 jobs::enqueue(&mut tx,job_kind::EXPIRE_UPLOAD,&format!("upload:{a}"),serde_json::json!({"id":a}),3600).await?;tx.commit().await?;
 // Keep the write barrier while receiving bytes: maintenance waits for in-flight uploads.
 let(mut tx,u)=transaction(&s,&h,true).await?;require(&mut tx,&u,p,true,2).await?;
 let path=jobs::file_path(&s.attachment_dir,&key).map_err(|_|io_error())?;
 let work=async{
 let mut file=tokio::fs::OpenOptions::new().write(true).create_new(true).open(&path).await.map_err(|_|io_error())?;
 let mut size=0u64;let mut hash=Sha256::new();let mut prefix=Vec::new();
 while let Some(frame)=body.frame().await{let frame=frame.map_err(|_|invalid())?;if let Ok(bytes)=frame.into_data(){size+=bytes.len() as u64;if size>max_bytes(){return Err(Failure(StatusCode::PAYLOAD_TOO_LARGE,error_code::PAYLOAD_TOO_LARGE,message::PAYLOAD_TOO_LARGE));}
 if prefix.len()<16{prefix.extend(bytes.iter().take(16-prefix.len()));}hash.update(&bytes);file.write_all(&bytes).await.map_err(|_|io_error())?;}}
 if size==0||format!("{:x}",hash.finalize())!=v.sha256{return Err(invalid());}file.sync_all().await.map_err(|_|io_error())?;tokio::fs::File::open(&s.attachment_dir).await.map_err(|_|io_error())?.sync_all().await.map_err(|_|io_error())?;
 Ok((size as i64,image_type(&prefix)))
 };
 let (size,mime)=match tokio::time::timeout(std::time::Duration::from_secs(120),work).await {Ok(Ok(r))=>r,other=>{let _=jobs::remove(&s.attachment_dir,&key).await;return Err(other.ok().and_then(Result::err).unwrap_or_else(io_error));}};
 sqlx::query("UPDATE attachments SET status='ready',size=$2,mime_type=$3 WHERE id=$1").bind(a).bind(size).bind(mime).execute(&mut *tx).await?;audit(&mut tx,Some(u.id),audit_action::ATTACHMENTS_UPLOAD,Some(a),&id.0,serde_json::json!({})).await?;tx.commit().await?;
 Ok(Attachment{id:a,original_name:v.name,mime_type:mime.into(),size,checksum:v.sha256})
 }.await,&id)
}
#[utoipa::path(get,operation_id="list_attachments",path="/api/v1/pages/{id}/attachments",responses((status=200,body=Vec<Attachment>)))]
pub async fn list(
    State(s): State<AppState>,
    Extension(id): Extension<RequestId>,
    h: HeaderMap,
    Path(p): Path<Uuid>,
) -> Response {
    response(async{let(mut tx,u)=transaction(&s,&h,false).await?;require(&mut tx,&u,p,true,1).await?;Ok(sqlx::query_as::<_,Attachment>("SELECT id,original_name,mime_type,size,checksum FROM attachments WHERE page_id=$1 AND status='ready' ORDER BY created_at,id").bind(p).fetch_all(&mut *tx).await?)}.await,&id)
}
#[utoipa::path(get,operation_id="download_attachment",path="/api/v1/attachments/{id}/download",responses((status=200,description="Authorized bytes")))]
pub async fn download(
    State(s): State<AppState>,
    Extension(id): Extension<RequestId>,
    h: HeaderMap,
    Path(a): Path<Uuid>,
) -> Response {
    let result:Result<Response>=async{let(mut tx,u)=transaction(&s,&h,false).await?;let row:Option<(Uuid,String,String,String,i64)>=sqlx::query_as("SELECT page_id,storage_key,original_name,mime_type,size FROM attachments WHERE id=$1 AND status='ready'").bind(a).fetch_optional(&mut *tx).await?;let(p,key,name,mime,size)=row.ok_or_else(missing)?;require(&mut tx,&u,p,true,1).await?;
 let file=tokio::fs::File::open(jobs::file_path(&s.attachment_dir,&key).map_err(|_|io_error())?).await.map_err(|_|io_error())?;
 if u.is_system_admin{audit(&mut tx,Some(u.id),audit_action::ATTACHMENTS_ADMIN_READ,Some(a),&id.0,serde_json::json!({})).await?;tx.commit().await?;}
 let stream=futures_util::stream::try_unfold(file,|mut f|async move{let mut buffer=vec![0;65536];let n=f.read(&mut buffer).await?;buffer.truncate(n);Ok::<_,std::io::Error>(if n==0{None}else{Some((buffer,f))})});
 let encoded=name.as_bytes().iter().map(|b|format!("%{b:02X}")).collect::<String>();let disposition=if mime.starts_with("image/"){"inline"}else{"attachment"};
 Ok(([(header::CONTENT_TYPE,mime),(header::CONTENT_LENGTH,size.to_string()),(header::CONTENT_DISPOSITION,format!("{disposition}; filename=\"attachment\"; filename*=UTF-8''{encoded}")),(header::X_CONTENT_TYPE_OPTIONS,protocol::NO_SNIFF.into()),(header::CONTENT_SECURITY_POLICY,protocol::ATTACHMENT_CSP.into())],Body::from_stream(stream)).into_response())}.await;
    match result {
        Ok(r) => r,
        Err(e) => e.response(&id),
    }
}
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/v1/pages/{id}/attachments", post(upload).get(list))
        .route("/api/v1/attachments/{id}/download", get(download))
        .layer(DefaultBodyLimit::disable())
}
