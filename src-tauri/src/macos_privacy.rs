//! Make this process show up in System Settings → Full Disk Access.
//!
//! macOS records the *responsible* process, not whichever helper touched a
//! protected file. A dev binary launched from Cursor or Terminal is therefore
//! omitted, while system daemons such as `siriactionsd` appear on their own.
//! Development builds re-exec once with responsibility disclaimed, then read a
//! Full Disk Access protected file so this executable is listed, switch off.

#[cfg(target_os = "macos")]
use std::path::Path;

const DISCLAIM_ENV: &str = "DOC_TOOLS_TCC_DISCLAIMED";

pub fn prepare_privacy_identity() {
    #[cfg(target_os = "macos")]
    {
        become_responsible_process();
        register_for_full_disk_access();
    }
}

pub fn full_disk_access_granted() -> bool {
    #[cfg(target_os = "macos")]
    {
        let Some(home) = dirs::home_dir() else {
            return false;
        };
        return std::fs::File::open(
            home.join("Library/Application Support/com.apple.TCC/TCC.db"),
        )
        .is_ok();
    }
    #[cfg(not(target_os = "macos"))]
    false
}

pub fn register_for_full_disk_access() {
    #[cfg(target_os = "macos")]
    {
        let Some(home) = dirs::home_dir() else {
            return;
        };
        // Opening these is denied without Full Disk Access. The denial is what
        // puts the responsible executable into the list, unchecked.
        for path in [
            home.join("Library/Application Support/com.apple.TCC/TCC.db"),
            home.join("Library/Mail"),
            home.join("Library/Messages"),
            home.join("Library/Safari/Bookmarks.plist"),
        ] {
            let _ = std::fs::read_dir(&path);
            let _ = std::fs::File::open(&path);
        }
    }
}

/// Name macOS shows in the Full Disk Access list for this process.
pub fn privacy_client_name() -> String {
    let Ok(exe) = std::env::current_exe() else {
        return String::new();
    };
    for component in exe.components() {
        let name = component.as_os_str().to_string_lossy();
        if let Some(stem) = name.strip_suffix(".app") {
            if !stem.is_empty() {
                return stem.to_string();
            }
        }
    }
    exe.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

#[cfg(target_os = "macos")]
fn is_app_bundle(exe: &Path) -> bool {
    exe.components().any(|component| {
        component
            .as_os_str()
            .to_string_lossy()
            .ends_with(".app")
    })
}

#[cfg(target_os = "macos")]
fn become_responsible_process() {
    if std::env::var_os(DISCLAIM_ENV).is_some() {
        return;
    }
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    // A bundled app launched from Finder is already its own responsible process.
    if is_app_bundle(&exe) {
        return;
    }
    if disclaim_and_reexec(&exe) {
        // POSIX_SPAWN_SETEXEC replaces this process and does not return.
        return;
    }
}

#[cfg(target_os = "macos")]
fn disclaim_and_reexec(exe: &Path) -> bool {
    use std::ffi::{CString, c_char};
    use std::os::unix::ffi::OsStrExt;

    unsafe extern "C" {
        fn responsibility_spawnattrs_setdisclaim(
            attr: *mut libc::posix_spawnattr_t,
            disclaim: u32,
        ) -> i32;
    }

    fn c_os(value: &std::ffi::OsStr) -> Option<CString> {
        CString::new(value.as_bytes()).ok()
    }

    let Ok(exe_c) = CString::new(exe.as_os_str().as_bytes()) else {
        return false;
    };
    let mut args = Vec::new();
    for arg in std::env::args_os() {
        let Some(c) = c_os(&arg) else {
            return false;
        };
        args.push(c);
    }
    if args.is_empty() {
        args.push(exe_c.clone());
    }
    let mut argv: Vec<*mut c_char> = args.iter().map(|arg| arg.as_ptr() as *mut c_char).collect();
    argv.push(std::ptr::null_mut());

    let mut env_items = Vec::new();
    for (key, value) in std::env::vars_os() {
        if key == DISCLAIM_ENV {
            continue;
        }
        let mut pair = key.into_encoded_bytes();
        pair.push(b'=');
        pair.extend(value.as_bytes());
        let Ok(c) = CString::new(pair) else {
            continue;
        };
        env_items.push(c);
    }
    let Ok(marker) = CString::new(format!("{DISCLAIM_ENV}=1")) else {
        return false;
    };
    env_items.push(marker);
    let mut envp: Vec<*mut c_char> = env_items
        .iter()
        .map(|item| item.as_ptr() as *mut c_char)
        .collect();
    envp.push(std::ptr::null_mut());

    unsafe {
        let mut attr: libc::posix_spawnattr_t = std::ptr::null_mut();
        if libc::posix_spawnattr_init(&mut attr) != 0 {
            return false;
        }
        let mut flags: libc::c_short = 0;
        if libc::posix_spawnattr_getflags(&attr, &mut flags) != 0 {
            libc::posix_spawnattr_destroy(&mut attr);
            return false;
        }
        flags |= libc::POSIX_SPAWN_SETEXEC as libc::c_short;
        if libc::posix_spawnattr_setflags(&mut attr, flags) != 0
            || responsibility_spawnattrs_setdisclaim(&mut attr, 1) != 0
        {
            libc::posix_spawnattr_destroy(&mut attr);
            return false;
        }
        let mut pid: libc::pid_t = 0;
        // SETEXEC replaces this process. A successful call does not return.
        let rc = libc::posix_spawn(
            &mut pid,
            exe_c.as_ptr(),
            std::ptr::null(),
            &attr,
            argv.as_ptr(),
            envp.as_ptr(),
        );
        libc::posix_spawnattr_destroy(&mut attr);
        rc == 0
    }
}
