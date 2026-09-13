//! What this machine actually has.
//!
//! Until now the app sized models against `design/core/machine.mjs`, a fixed
//! RTX 4070 / 32GB profile whose own header said "nothing here pretends to
//! have detected anything". It was honest about being a placeholder and
//! dishonest in effect: every recommendation, every "this fits" and every
//! suggested context length was computed from somebody else's computer.
//!
//! The rule this module follows is the one that placeholder broke. **Every
//! field is either measured or `None`.** There is no default VRAM, no assumed
//! GPU, no "probably 8GB". A machine whose GPU cannot be identified reports a
//! GPU of `None`, and the interface says it does not know rather than picking
//! a number that will be wrong for somebody.
//!
//! How each fact is obtained, and what it costs to be wrong:
//!
//! - **RAM and cores** come from the OS and are reliable everywhere.
//! - **VRAM** is the number that decides whether a model fits, and it is the
//!   hardest to get portably. `nvidia-smi` is asked first because it is exact
//!   and present wherever CUDA is. Failing that, on Windows, the display
//!   driver's registry entry carries an adapter memory figure. Failing that,
//!   `None` — and a recommendation that needs VRAM is not offered rather than
//!   computed from a guess.
//!
//! Nothing here shells out to anything that is not a first-party system tool,
//! and every call has a timeout: a hardware probe that hangs takes the whole
//! window's startup with it.

use std::process::{Command, Stdio};
use std::time::Duration;

use serde::Serialize;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// A GPU, as far as anything could tell.
#[derive(Debug, Clone, Serialize)]
pub struct Gpu {
    /// "nvidia", "amd", "intel", "apple", or "unknown".
    pub vendor: String,
    pub name: String,
    /// Total device memory. `None` when nothing could measure it — never a
    /// guess, because this is the number that decides what fits.
    pub vram_bytes: Option<u64>,
    /// Driver version, when the source that found the GPU also reported one.
    pub driver: Option<String>,
    /// How this was found, so a wrong number can be traced to its source.
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Hardware {
    pub os: String,
    pub arch: String,
    pub cpu_cores: Option<u32>,
    pub ram_bytes: Option<u64>,
    pub ram_free_bytes: Option<u64>,
    pub gpus: Vec<Gpu>,
    /// Set when something could not be determined, so the interface can say
    /// which part it is missing rather than showing a blank.
    pub notes: Vec<String>,
}

/// Run a command with a deadline, returning its stdout on success.
///
/// Spawned rather than `output()` so a tool that hangs — `nvidia-smi` on a
/// machine with a wedged driver does — cannot hold the probe forever.
fn run(program: &str, args: &[&str], timeout: Duration) -> Option<String> {
    let mut cmd = Command::new(program);
    cmd.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd.spawn().ok()?;
    let deadline = std::time::Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return None;
                }
                break;
            }
            Ok(None) => {
                if std::time::Instant::now() > deadline {
                    let _ = child.kill();
                    return None;
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(_) => return None,
        }
    }
    let out = child.wait_with_output().ok()?;
    String::from_utf8(out.stdout).ok()
}

/// NVIDIA, exactly, when the tool is there.
fn nvidia() -> Vec<Gpu> {
    let Some(text) = run(
        "nvidia-smi",
        &[
            "--query-gpu=name,memory.total,driver_version",
            "--format=csv,noheader,nounits",
        ],
        Duration::from_secs(4),
    ) else {
        return Vec::new();
    };

    text.lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|line| {
            let mut parts = line.split(',').map(str::trim);
            let name = parts.next()?.to_string();
            // nounits gives mebibytes as a bare number.
            let vram = parts
                .next()
                .and_then(|m| m.parse::<u64>().ok())
                .map(|mib| mib * 1024 * 1024);
            let driver = parts.next().map(str::to_string).filter(|d| !d.is_empty());
            Some(Gpu {
                vendor: "nvidia".into(),
                name,
                vram_bytes: vram,
                driver,
                source: "nvidia-smi".into(),
            })
        })
        .collect()
}

/// Whatever Windows knows about the display adapters.
///
/// Used when `nvidia-smi` is absent, which is every AMD and Intel machine.
/// PowerShell's CIM query is the only first-party way to reach this without a
/// dependency; `wmic` is deprecated and gone from recent Windows.
///
/// The memory figure here is the adapter's `AdapterRAM`, which is a 32-bit
/// field: it is wrong above 4GB and reports garbage on some drivers. So it is
/// read, and then *discarded* unless it is plausible — a wrong VRAM number is
/// worse than none, because it silently changes what the app says will fit.
#[cfg(windows)]
fn windows_adapters() -> Vec<Gpu> {
    let script = "Get-CimInstance Win32_VideoController | \
        ForEach-Object { \"$($_.Name)|$($_.AdapterRAM)|$($_.DriverVersion)\" }";
    let Some(text) = run(
        "powershell",
        &["-NoProfile", "-NonInteractive", "-Command", script],
        Duration::from_secs(8),
    ) else {
        return Vec::new();
    };

    text.lines()
        .filter(|l| l.contains('|'))
        .filter_map(|line| {
            let mut parts = line.split('|');
            let name = parts.next()?.trim().to_string();
            if name.is_empty() {
                return None;
            }
            let raw = parts.next().and_then(|v| v.trim().parse::<i64>().ok());
            // AdapterRAM overflows a signed 32-bit field, so anything at or
            // above 4GiB is unreliable and anything negative is nonsense.
            // Discarded rather than clamped: a clamp would report 4GB for a
            // 24GB card, which reads as a measurement.
            let vram = match raw {
                Some(v) if v > 0 && v < 4 * 1024 * 1024 * 1024 => Some(v as u64),
                _ => None,
            };
            let driver = parts.next().map(|d| d.trim().to_string()).filter(|d| !d.is_empty());
            let lower = name.to_lowercase();
            let vendor = if lower.contains("nvidia") || lower.contains("geforce") || lower.contains("quadro") {
                "nvidia"
            } else if lower.contains("amd") || lower.contains("radeon") {
                "amd"
            } else if lower.contains("intel") {
                "intel"
            } else {
                "unknown"
            };
            Some(Gpu {
                vendor: vendor.into(),
                name,
                vram_bytes: vram,
                driver,
                source: "Win32_VideoController".into(),
            })
        })
        .collect()
}

#[cfg(not(windows))]
fn windows_adapters() -> Vec<Gpu> {
    Vec::new()
}

/// Apple silicon shares memory with the system, so there is no separate VRAM.
#[cfg(target_os = "macos")]
fn apple_gpu() -> Vec<Gpu> {
    let Some(text) = run("sysctl", &["-n", "machdep.cpu.brand_string"], Duration::from_secs(3))
    else {
        return Vec::new();
    };
    if !text.contains("Apple") {
        return Vec::new();
    }
    vec![Gpu {
        vendor: "apple".into(),
        name: text.trim().to_string(),
        // Unified memory: the GPU can address system RAM, so a separate figure
        // would be inventing a distinction the hardware does not have.
        vram_bytes: None,
        driver: None,
        source: "sysctl".into(),
    }]
}

#[cfg(not(target_os = "macos"))]
fn apple_gpu() -> Vec<Gpu> {
    Vec::new()
}

#[cfg(windows)]
fn memory() -> (Option<u64>, Option<u64>) {
    let script = "$o = Get-CimInstance Win32_OperatingSystem; \
        \"$($o.TotalVisibleMemorySize)|$($o.FreePhysicalMemory)\"";
    let Some(text) = run(
        "powershell",
        &["-NoProfile", "-NonInteractive", "-Command", script],
        Duration::from_secs(8),
    ) else {
        return (None, None);
    };
    let line = text.lines().find(|l| l.contains('|')).unwrap_or("");
    let mut parts = line.split('|');
    // Both figures are in kibibytes.
    let total = parts.next().and_then(|v| v.trim().parse::<u64>().ok()).map(|k| k * 1024);
    let free = parts.next().and_then(|v| v.trim().parse::<u64>().ok()).map(|k| k * 1024);
    (total, free)
}

#[cfg(not(windows))]
fn memory() -> (Option<u64>, Option<u64>) {
    // /proc/meminfo on Linux; sysctl on macOS. Both report kibibytes for the
    // fields read here.
    #[cfg(target_os = "linux")]
    {
        let Ok(text) = std::fs::read_to_string("/proc/meminfo") else {
            return (None, None);
        };
        let field = |name: &str| -> Option<u64> {
            text.lines()
                .find(|l| l.starts_with(name))
                .and_then(|l| l.split_whitespace().nth(1))
                .and_then(|v| v.parse::<u64>().ok())
                .map(|k| k * 1024)
        };
        return (field("MemTotal:"), field("MemAvailable:"));
    }
    #[cfg(target_os = "macos")]
    {
        let total = run("sysctl", &["-n", "hw.memsize"], Duration::from_secs(3))
            .and_then(|v| v.trim().parse::<u64>().ok());
        // Free memory on macOS needs vm_stat arithmetic that is easy to get
        // subtly wrong, and nothing here needs it badly enough to risk a
        // number that looks measured.
        return (total, None);
    }
    #[allow(unreachable_code)]
    (None, None)
}

/// Probe the machine.
///
/// Never fails: an unknown is a `None` and a note saying which probe came back
/// empty, because "we could not tell" is a state the interface has to render
/// and an error is a state it would have to hide.
pub fn probe() -> Hardware {
    let (ram, ram_free) = memory();

    let mut gpus = nvidia();
    if gpus.is_empty() {
        gpus = apple_gpu();
    }
    if gpus.is_empty() {
        gpus = windows_adapters();
    }

    let mut notes = Vec::new();
    if gpus.is_empty() {
        notes.push(
            "No GPU could be identified. Models will be sized for the processor only."
                .to_string(),
        );
    } else if gpus.iter().all(|g| g.vram_bytes.is_none()) {
        notes.push(
            "A GPU was found but its memory could not be measured, so nothing here \
             says how much of a model would fit on it."
                .to_string(),
        );
    }
    if ram.is_none() {
        notes.push("System memory could not be read.".to_string());
    }

    Hardware {
        // Just the OS. FAMILY is "windows" on Windows too, so pairing them
        // produced "windows windows".
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        cpu_cores: std::thread::available_parallelism().ok().map(|n| n.get() as u32),
        ram_bytes: ram,
        ram_free_bytes: ram_free,
        gpus,
        notes,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_probe_always_answers() {
        // On any machine, including one with no GPU and no tools, this returns
        // a profile rather than failing. The interface has to render something.
        let hw = probe();
        assert!(!hw.arch.is_empty());
        assert!(!hw.os.is_empty());
    }

    #[test]
    fn nothing_is_invented() {
        // Every optional field is either measured or absent. The test that
        // matters is that no branch above substitutes a plausible default.
        let hw = probe();
        for g in &hw.gpus {
            if let Some(v) = g.vram_bytes {
                assert!(v > 0, "a measured VRAM of zero is not a measurement");
                assert!(
                    v < 1024u64 * 1024 * 1024 * 1024,
                    "a terabyte of VRAM is a parsing bug, not a card"
                );
            }
            assert!(!g.source.is_empty(), "a GPU with no source cannot be traced");
        }
        if let Some(r) = hw.ram_bytes {
            assert!(r > 0);
        }
    }

    /// Not an assertion: a way to see what this machine reports.
    /// `cargo test --bins -- --nocapture prints_what_it_found`
    #[test]
    fn prints_what_it_found() {
        let hw = probe();
        println!("{}", serde_json::to_string_pretty(&hw).unwrap());
    }

    #[test]
    fn an_unmeasurable_machine_says_so() {
        // The note is the interface's only way to explain a missing number.
        let hw = probe();
        if hw.gpus.is_empty() {
            assert!(!hw.notes.is_empty(), "no GPU and nothing said about it");
        }
    }
}
