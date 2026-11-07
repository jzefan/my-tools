use base64::prelude::*;
use std::path::PathBuf;

fn typing_db_path() -> Result<PathBuf, String> {
    let dir = dirs::data_dir()
        .ok_or_else(|| "无法定位数据目录".to_string())?
        .join("doc-tools");
    std::fs::create_dir_all(&dir).map_err(|err| format!("无法创建数据目录: {err}"))?;
    Ok(dir.join("typing.sqlite"))
}

pub fn validate_sqlite_blob(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() < 512 || bytes.len() > 16 * 1024 * 1024 {
        return Err("数据库大小无效".to_string());
    }
    if !bytes.starts_with(b"SQLite format 3\0") {
        return Err("不是有效的 SQLite 数据库".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn typing_load_database() -> Result<Option<String>, String> {
    let path = typing_db_path()?;
    if !path.exists() {
        return Ok(None);
    }
    let bytes = std::fs::read(&path).map_err(|err| format!("无法读取词库: {err}"))?;
    validate_sqlite_blob(&bytes)?;
    Ok(Some(BASE64_STANDARD.encode(bytes)))
}

#[tauri::command]
pub fn typing_save_database(data: String) -> Result<(), String> {
    let bytes = BASE64_STANDARD
        .decode(data.trim())
        .map_err(|_| "无法解析数据库".to_string())?;
    validate_sqlite_blob(&bytes)?;
    let path = typing_db_path()?;
    let temporary = path.with_extension("sqlite.tmp");
    std::fs::write(&temporary, &bytes).map_err(|err| format!("无法写入词库: {err}"))?;
    std::fs::rename(&temporary, &path).map_err(|err| format!("无法保存词库: {err}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_sqlite_blob;

    #[test]
    fn rejects_short_or_foreign_bytes() {
        assert!(validate_sqlite_blob(b"hello").is_err());
        let mut foreign = vec![0_u8; 600];
        foreign[..4].copy_from_slice(b"not ");
        assert!(validate_sqlite_blob(&foreign).is_err());
    }

    #[test]
    fn accepts_sqlite_header() {
        let mut bytes = b"SQLite format 3\0".to_vec();
        bytes.resize(512, 0);
        assert!(validate_sqlite_blob(&bytes).is_ok());
    }
}
