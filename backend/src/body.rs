use crate::auth::{Result, invalid};
use serde_json::Value;
const BLOCKS: &[&str] = &[
    "paragraph",
    "heading",
    "blockquote",
    "bulletList",
    "orderedList",
    "taskList",
    "codeBlock",
    "horizontalRule",
    "table",
    "image",
];
pub fn validate(version: i32, body: &Value) -> Result<String> {
    if version != 1
        || serde_json::to_vec(body).map_err(|_| invalid())?.len() > 2 * 1024 * 1024
        || body.get("type").and_then(Value::as_str) != Some("doc")
    {
        return Err(invalid());
    }
    let mut text = Vec::new();
    node(body, 0, &mut text)?;
    Ok(text.join("\n"))
}
fn keys(v: &Value, allowed: &[&str]) -> Result<()> {
    let map = v.as_object().ok_or_else(invalid)?;
    if map.keys().any(|k| !allowed.contains(&k.as_str())) {
        return Err(invalid());
    }
    Ok(())
}
fn node(v: &Value, depth: usize, text: &mut Vec<String>) -> Result<()> {
    if depth > 64 {
        return Err(invalid());
    }
    keys(v, &["type", "content", "attrs", "marks", "text"])?;
    let t = v["type"].as_str().ok_or_else(invalid)?;
    let attrs = v.get("attrs");
    let allowed = match t {
        "heading" => &["level"][..],
        "orderedList" => &["start", "type"][..],
        "taskItem" => &["checked"][..],
        "codeBlock" => &["language"][..],
        "tableCell" | "tableHeader" => &["colspan", "rowspan", "colwidth", "align"][..],
        "image" => &["src", "alt", "title", "width", "height"][..],
        _ => &[][..],
    };
    if let Some(a) = attrs {
        keys(a, allowed)?;
    }
    match t {
        "taskItem" if v["attrs"].get("checked").is_some_and(|c| !c.is_boolean()) => {
            return Err(invalid());
        }
        "heading" => {
            if !v["attrs"]["level"]
                .as_i64()
                .is_some_and(|n| (1..=6).contains(&n))
            {
                return Err(invalid());
            }
        }
        "orderedList" => {
            if attrs
                .and_then(|a| a.get("start"))
                .is_some_and(|n| !n.as_i64().is_some_and(|n| (1..=1_000_000).contains(&n)))
            {
                return Err(invalid());
            }
        }
        "codeBlock" => {
            if attrs
                .and_then(|a| a.get("language"))
                .is_some_and(|a| !a.is_null() && !a.as_str().is_some_and(|s| s.len() < 100))
            {
                return Err(invalid());
            }
        }
        "image" => {
            let src = v["attrs"]["src"].as_str().ok_or_else(invalid)?;
            let id = src
                .strip_prefix("/api/v1/attachments/")
                .and_then(|s| s.strip_suffix("/download"))
                .ok_or_else(invalid)?;
            uuid::Uuid::parse_str(id).map_err(|_| invalid())?;
            for key in ["width", "height"] {
                if let Some(v) = attrs.and_then(|a| a.get(key))
                    && !v.is_null()
                    && !v.as_i64().is_some_and(|n| (1..=10000).contains(&n))
                {
                    return Err(invalid());
                }
            }
            for key in ["alt", "title"] {
                if attrs
                    .and_then(|a| a.get(key))
                    .is_some_and(|s| !s.is_null() && !s.as_str().is_some_and(|s| s.len() <= 1000))
                {
                    return Err(invalid());
                }
            }
        }
        "tableCell" | "tableHeader" => {
            for key in ["colspan", "rowspan"] {
                if !v["attrs"][key]
                    .as_i64()
                    .is_some_and(|n| (1..=100).contains(&n))
                {
                    return Err(invalid());
                }
            }
            if let Some(width) = attrs.and_then(|a| a.get("colwidth"))
                && !width.is_null()
                && !width.as_array().is_some_and(|a| {
                    a.len() <= 100
                        && a.iter()
                            .all(|n| n.as_i64().is_some_and(|n| (1..=10000).contains(&n)))
                })
            {
                return Err(invalid());
            }
            if attrs.and_then(|a| a.get("align")).is_some_and(|a| {
                !a.is_null() && !matches!(a.as_str(), Some("left" | "right" | "center"))
            }) {
                return Err(invalid());
            }
        }
        _ => {}
    }
    if let Some(marks) = v.get("marks") {
        if t != "text" {
            return Err(invalid());
        }
        for mark in marks.as_array().ok_or_else(invalid)? {
            keys(mark, &["type", "attrs"])?;
            let mt = mark["type"].as_str().ok_or_else(invalid)?;
            if !["bold", "italic", "strike", "code", "link", "underline"].contains(&mt) {
                return Err(invalid());
            }
            if mt == "link" {
                let a = mark.get("attrs").ok_or_else(invalid)?;
                keys(a, &["href", "target", "rel", "class", "title"])?;
                let href = a["href"].as_str().ok_or_else(invalid)?;
                if href.chars().any(|c| c.is_control() || c.is_whitespace())
                    || !(href
                        .strip_prefix("/api/v1/attachments/")
                        .and_then(|v| v.strip_suffix("/download"))
                        .is_some_and(|v| uuid::Uuid::parse_str(v).is_ok())
                        || ["https://", "http://", "mailto:"]
                            .iter()
                            .any(|prefix| href.starts_with(prefix)))
                {
                    return Err(invalid());
                }
                for key in ["target", "rel", "class", "title"] {
                    if let Some(value) = a.get(key)
                        && !value.is_null()
                        && !value.is_string()
                    {
                        return Err(invalid());
                    }
                }
                if a.get("target").is_some_and(|s| {
                    !s.is_null() && !matches!(s.as_str(), Some("_blank" | "_self"))
                }) {
                    return Err(invalid());
                }
            } else if let Some(a) = mark.get("attrs") {
                keys(a, &[])?;
            }
        }
    }
    if t == "text" {
        if v.get("content").is_some() || !v["text"].as_str().is_some_and(|s| !s.is_empty()) {
            return Err(invalid());
        }
        return Ok(());
    }
    if v.get("text").is_some() {
        return Err(invalid());
    }
    let empty = Vec::new();
    let children = match v.get("content") {
        Some(c) => c.as_array().ok_or_else(invalid)?,
        None => &empty,
    };
    let valid = match t {
        "doc" | "blockquote" | "tableCell" | "tableHeader" => {
            !children.is_empty()
                && children
                    .iter()
                    .all(|c| BLOCKS.contains(&c["type"].as_str().unwrap_or("")))
        }
        "paragraph" | "heading" => children
            .iter()
            .all(|c| matches!(c["type"].as_str(), Some("text" | "hardBreak"))),
        "codeBlock" => children.iter().all(|c| {
            c["type"] == "text"
                && c.get("marks")
                    .is_none_or(|m| m.as_array().is_some_and(Vec::is_empty))
        }),
        "bulletList" | "orderedList" => {
            !children.is_empty() && children.iter().all(|c| c["type"] == "listItem")
        }
        "taskList" => !children.is_empty() && children.iter().all(|c| c["type"] == "taskItem"),
        "listItem" | "taskItem" => {
            children.first().is_some_and(|c| c["type"] == "paragraph")
                && children
                    .iter()
                    .all(|c| BLOCKS.contains(&c["type"].as_str().unwrap_or("")))
        }
        "table" => !children.is_empty() && children.iter().all(|c| c["type"] == "tableRow"),
        "tableRow" => {
            !children.is_empty()
                && children
                    .iter()
                    .all(|c| matches!(c["type"].as_str(), Some("tableCell" | "tableHeader")))
        }
        "hardBreak" | "horizontalRule" | "image" => children.is_empty(),
        _ => false,
    };
    if !valid {
        return Err(invalid());
    }
    for child in children {
        node(child, depth + 1, text)?;
    }
    if matches!(t, "paragraph" | "heading" | "codeBlock") {
        text.push(
            children
                .iter()
                .map(|c| {
                    if c["type"] == "hardBreak" {
                        "\n"
                    } else {
                        c["text"].as_str().unwrap_or("")
                    }
                })
                .collect(),
        );
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn attachment_fixture() {
        let v: Value =
            serde_json::from_str(include_str!("../../fixtures/attachments-v1.json")).unwrap();
        assert!(validate(1, &v).is_ok());
        let mut bad = v;
        bad["content"][1]["attrs"]["width"] = serde_json::json!(-1);
        assert!(validate(1, &bad).is_err());
    }
    #[test]
    fn shared_fixture() {
        let f: Value = serde_json::from_str(include_str!("../../fixtures/body-v1.json")).unwrap();
        assert_eq!(
            validate(1, &f["body"]).unwrap(),
            f["text"].as_str().unwrap()
        );
    }
    #[test]
    fn validates_task_items_and_extracts_their_text() {
        let mut body = json!({"type":"doc","content":[{"type":"taskList","content":[
            {"type":"taskItem","attrs":{"checked":true},"content":[{"type":"paragraph","content":[{"type":"text","text":"已完成"}]}]},
            {"type":"taskItem","content":[{"type":"paragraph","content":[{"type":"text","text":"下一步"}]}]}
        ]}]});
        assert_eq!(validate(1, &body).unwrap(), "已完成\n下一步");
        body["content"][0]["content"][0]["attrs"]["checked"] = json!("true");
        assert!(validate(1, &body).is_err());
        body["content"][0]["content"][0] = json!({"type":"paragraph"});
        assert!(validate(1, &body).is_err());
    }
    #[test]
    fn rejects_invalid_content() {
        for b in [
            json!({"type":"script"}),
            json!({"type":"doc","content":[{"type":"text","text":"bad"}]}),
            json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"bad","marks":[{"type":"link","attrs":{"href":"javascript:alert(1)"}}]}]}]}),
        ] {
            assert!(validate(1, &b).is_err());
        }
        let b = json!({"type":"doc","content":[{"type":"paragraph"}]});
        assert!(validate(2, &b).is_err());
        let huge = json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"x".repeat(2*1024*1024)}]}]});
        assert!(validate(1, &huge).is_err());
        let mut deep = json!({"type":"paragraph"});
        for _ in 0..65 {
            deep = json!({"type":"blockquote","content":[deep]});
        }
        assert!(validate(1, &json!({"type":"doc","content":[deep]})).is_err());
    }
}
