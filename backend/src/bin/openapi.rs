use utoipa::OpenApi;
fn main() {
    println!(
        "{}",
        wiki_api::http::ApiDoc::openapi()
            .to_pretty_json()
            .expect("OpenAPI JSON")
    );
}
