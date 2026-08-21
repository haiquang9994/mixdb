use std::path::PathBuf;

use super::models::LocalShell;

/// Danh sách shell mở được trên máy này, thứ tự là thứ tự gợi ý — cái đầu tiên là mặc định.
pub fn detect() -> Vec<LocalShell> {
    let mut found = Vec::new();
    #[cfg(windows)]
    detect_windows(&mut found);
    #[cfg(not(windows))]
    detect_unix(&mut found);
    found
}

/// Đường dẫn của shell mặc định, cho một `TerminalTarget::Local { shell: None, .. }`.
pub fn default_shell() -> String {
    detect()
        .into_iter()
        .next()
        .map(|shell| shell.path)
        .unwrap_or_else(|| {
            if cfg!(windows) {
                "cmd.exe".to_string()
            } else {
                "/bin/sh".to_string()
            }
        })
}

/// Thêm một mục nếu file có thật và đường dẫn đó chưa nằm trong danh sách.
fn push_if_present(found: &mut Vec<LocalShell>, name: &str, path: PathBuf, args: Vec<String>) {
    if !path.is_file() {
        return;
    }
    let path = path.display().to_string();
    if found.iter().any(|shell| shell.path == path) {
        return;
    }
    found.push(LocalShell {
        name: name.to_string(),
        path,
        args,
    });
}

/// Tìm một chương trình trong `PATH`. Dùng cho `pwsh` và `wsl.exe`, hai thứ không có đường dẫn
/// cố định.
#[cfg(windows)]
fn on_path(exe: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(exe))
        .find(|candidate| candidate.is_file())
}

#[cfg(windows)]
fn detect_windows(found: &mut Vec<LocalShell>) {
    let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
    let system32 = PathBuf::from(&system_root).join("System32");

    push_if_present(
        found,
        "powershell",
        system32
            .join("WindowsPowerShell")
            .join("v1.0")
            .join("powershell.exe"),
        Vec::new(),
    );
    if let Some(pwsh) = on_path("pwsh.exe") {
        push_if_present(found, "pwsh", pwsh, Vec::new());
    }
    push_if_present(found, "cmd", system32.join("cmd.exe"), Vec::new());

    for base in ["ProgramFiles", "ProgramW6432", "LOCALAPPDATA"] {
        if let Ok(dir) = std::env::var(base) {
            let git_bash = PathBuf::from(&dir).join("Git").join("bin").join("bash.exe");
            push_if_present(found, "git-bash", git_bash, Vec::new());
        }
    }

    if let Some(wsl) = on_path("wsl.exe") {
        for distro in wsl_distros() {
            found.push(LocalShell {
                name: format!("wsl:{distro}"),
                path: wsl.display().to_string(),
                args: vec!["-d".to_string(), distro],
            });
        }
    }
}

/// Các bản phân phối WSL đã cài. Máy không có WSL thì `wsl.exe` thất bại và danh sách rỗng —
/// không phải lỗi để báo cho ai.
#[cfg(windows)]
fn wsl_distros() -> Vec<String> {
    let output = match std::process::Command::new("wsl.exe")
        .args(["-l", "-q"])
        .output()
    {
        Ok(output) if output.status.success() => output,
        _ => return Vec::new(),
    };
    parse_wsl_list(&output.stdout)
}

/// `wsl.exe -l -q` in UTF-16LE, có BOM, xuống dòng CRLF, và khi không có bản nào thì in một câu
/// tiếng Anh thay vì in rỗng.
///
/// Không gắn `#[cfg(windows)]` để test của nó chạy được ở mọi nơi — cái nó đọc là byte, không
/// phải là hệ điều hành.
#[cfg_attr(not(windows), allow(dead_code))]
fn parse_wsl_list(bytes: &[u8]) -> Vec<String> {
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
        .collect();
    String::from_utf16_lossy(&units)
        .lines()
        .map(|line| {
            line.trim_matches(|c: char| c == '\u{feff}' || c.is_whitespace())
                .to_string()
        })
        .filter(|line| !line.is_empty() && !line.starts_with("Windows Subsystem for Linux"))
        .collect()
}

#[cfg(not(windows))]
fn detect_unix(found: &mut Vec<LocalShell>) {
    if let Ok(shell) = std::env::var("SHELL") {
        let path = PathBuf::from(&shell);
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("sh")
            .to_string();
        push_if_present(found, &name, path, Vec::new());
    }
    for candidate in ["/bin/zsh", "/bin/bash", "/bin/sh"] {
        let path = PathBuf::from(candidate);
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("sh")
            .to_string();
        push_if_present(found, &name, path, Vec::new());
    }
}

#[cfg(test)]
mod tests {
    use super::parse_wsl_list;

    /// `wsl.exe -l -q` in ra UTF-16LE với CRLF — dựng lại đúng thế để test.
    fn utf16le(text: &str) -> Vec<u8> {
        text.encode_utf16().flat_map(|unit| unit.to_le_bytes()).collect()
    }

    #[test]
    fn reads_one_name_per_line() {
        let bytes = utf16le("Ubuntu\r\nDebian\r\n");
        assert_eq!(parse_wsl_list(&bytes), vec!["Ubuntu".to_string(), "Debian".to_string()]);
    }

    /// Tên có khoảng trắng là chuyện thường — `Ubuntu 22.04` không được cắt làm đôi.
    #[test]
    fn keeps_a_name_with_a_space_in_it() {
        let bytes = utf16le("Ubuntu 22.04\r\n");
        assert_eq!(parse_wsl_list(&bytes), vec!["Ubuntu 22.04".to_string()]);
    }

    #[test]
    fn drops_the_bom_and_the_blank_lines() {
        let bytes = utf16le("\u{feff}Ubuntu\r\n\r\n");
        assert_eq!(parse_wsl_list(&bytes), vec!["Ubuntu".to_string()]);
    }

    /// Máy không có bản phân phối nào thì `wsl.exe` in một câu tiếng Anh chứ không in danh sách
    /// rỗng. Câu đó không phải tên distro.
    #[test]
    fn is_not_fooled_by_the_no_distributions_message() {
        let bytes = utf16le("Windows Subsystem for Linux has no installed distributions.\r\n");
        assert!(parse_wsl_list(&bytes).is_empty());
    }
}
