//! Making the engine die with the host, however the host dies.
//!
//! `engine::stop` kills the server on a clean quit, and that covers the normal
//! case. It cannot cover the others: a panic, a crash, End Task in Task
//! Manager, a `taskkill /F` — in every one of those the host is gone before any
//! code of ours runs, and the `llama-server` it spawned keeps running with a
//! multi-gigabyte model resident. That was observed, not theorised: four
//! orphans, one per forced kill during a testing session, each holding several
//! gigabytes until they were found and killed by hand.
//!
//! Windows has exactly the right primitive. A job object with
//! `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` kills everything assigned to it when
//! the last handle to the job closes — and the kernel closes a dead process's
//! handles whether or not that process shut down tidily. So the host holds one
//! job handle for its whole life, every engine it spawns is assigned to that
//! job, and the engine cannot outlive the host by construction rather than by
//! remembering to clean up.
//!
//! This is deliberately a belt to `engine::stop`'s braces, not a replacement
//! for it: a clean quit should still stop the server promptly and report it,
//! rather than leaving it to process teardown.
//!
//! **Scope.** Windows only, which is what this milestone ships. The other
//! platforms get a no-op that says so rather than a stub that implies cover it
//! does not provide — see `adopt`'s return on those targets.

use std::process::Child;

#[cfg(windows)]
mod imp {
    use std::process::Child;
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    /// A handle to the job every engine process is assigned to.
    ///
    /// Held for the life of the host. The raw handle is only ever read here
    /// and the type is not `Clone`, so there is one owner and one close.
    pub struct Job(HANDLE);

    /* A HANDLE is a kernel object identifier, not a pointer into this
       process's memory: it is valid from any thread and the kernel serialises
       the calls that use it. The raw pointer type is what makes the compiler
       ask. */
    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}

    impl Job {
        /// Create the job, or `None` if the system would not give us one.
        pub fn create() -> Option<Job> {
            /* An anonymous job: no name, so nothing else on the machine can
               open it by name and assign processes of its own to it. */
            let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
            if handle.is_null() {
                return None;
            }

            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let ok = unsafe {
                SetInformationJobObject(
                    handle,
                    JobObjectExtendedLimitInformation,
                    std::ptr::addr_of!(info).cast(),
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                )
            };
            if ok == 0 {
                /* A job without the limit set would silently do nothing, which
                   is worse than not having one: it would read as cover. */
                unsafe { CloseHandle(handle) };
                return None;
            }
            Some(Job(handle))
        }

        /// Put a freshly spawned child in the job.
        pub fn adopt(&self, child: &Child) -> Result<(), String> {
            let ok = unsafe { AssignProcessToJobObject(self.0, child.as_raw_handle() as HANDLE) };
            if ok == 0 {
                return Err(format!(
                    "the engine could not be put in the host's job object (error {}); \
                     it will still be stopped on a clean quit, but not if this app is killed",
                    std::io::Error::last_os_error()
                ));
            }
            Ok(())
        }
    }

    impl Drop for Job {
        fn drop(&mut self) {
            /* Closing the last handle is what kills the job's processes. The
               kernel does this for us when the host dies; doing it here as
               well keeps the handle's lifetime honest. */
            unsafe { CloseHandle(self.0) };
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use std::process::Child;

    /// No job object outside Windows.
    ///
    /// The equivalents — a process group killed with `killpg`, or Linux's
    /// `PR_SET_PDEATHSIG` — are real but are not the same guarantee and are
    /// not exercised by this milestone, which ships Windows x64. Rather than a
    /// silent no-op that reads like cover, `adopt` reports that it did not
    /// take, and the caller logs it.
    pub struct Job;

    impl Job {
        pub fn create() -> Option<Job> {
            None
        }

        pub fn adopt(&self, _child: &Child) -> Result<(), String> {
            Err("this platform has no job object, so the engine is only stopped \
                 on a clean quit"
                .to_string())
        }
    }
}

pub use imp::Job;

/// Put `child` in `job` if there is one, and say what happened.
///
/// Returns `None` when the child is covered, or a sentence for the log when it
/// is not. A failure here never fails the launch: without the job the engine
/// behaves exactly as it did before, which is to say it is stopped on a clean
/// quit and orphaned on a kill. That is worth a line in the log and is not
/// worth refusing to run a model over.
pub fn adopt(job: Option<&Job>, child: &Child) -> Option<String> {
    match job {
        Some(j) => j.adopt(child).err(),
        None => Some(
            "no job object was created, so the engine will be orphaned if this app is killed"
                .to_string(),
        ),
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::os::windows::process::CommandExt;
    use std::process::Command;
    use std::time::{Duration, Instant};

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    /// A process that will outlive the test unless something kills it.
    fn sleeper() -> Child {
        Command::new("cmd")
            .args(["/c", "ping", "-n", "60", "127.0.0.1"])
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(std::process::Stdio::null())
            .spawn()
            .expect("could not spawn a test process")
    }

    /// Wait up to a second for a child to be reaped, so the test is not a race.
    fn died(child: &mut Child) -> bool {
        let until = Instant::now() + Duration::from_secs(5);
        while Instant::now() < until {
            if let Ok(Some(_)) = child.try_wait() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        false
    }

    /// The guarantee, stated as a test: closing the job's last handle kills
    /// what is in it. The host does not get to run code when it is killed, so
    /// this is the only thing standing between a `taskkill /F` and a
    /// `llama-server` left holding several gigabytes.
    #[test]
    fn closing_the_job_kills_what_was_put_in_it() {
        let job = Job::create().expect("this platform should give us a job object");
        let mut child = sleeper();
        assert_eq!(adopt(Some(&job), &child), None, "the child should be adopted");

        assert!(
            matches!(child.try_wait(), Ok(None)),
            "the child should still be running while the job is held"
        );

        /* What the kernel does for us when the host dies, done explicitly. */
        drop(job);

        assert!(died(&mut child), "the child outlived the job that owned it");
    }

    /// The counterfactual, so the test above is known to be testing something:
    /// the same process, not adopted, survives the same drop.
    #[test]
    fn a_process_outside_the_job_is_left_alone() {
        let job = Job::create().expect("this platform should give us a job object");
        let mut child = sleeper();
        drop(job);

        assert!(
            !died(&mut child),
            "an unadopted process should not be affected by the job closing"
        );
        let _ = child.kill();
        let _ = child.wait();
    }

    /// A job that could not take the limit is not handed back as if it had.
    #[test]
    fn a_job_is_only_returned_when_it_will_actually_kill() {
        /* There is no way to make CreateJobObjectW fail on a healthy machine,
           so this pins the shape of the contract rather than the failure: what
           comes back is either a job that kills, or nothing at all. `adopt`
           with nothing says so rather than reporting success. */
        let mut child = sleeper();
        let why = adopt(None, &child);
        assert!(why.is_some(), "no job must not read as adopted");
        assert!(
            why.as_deref().unwrap_or("").contains("orphaned"),
            "the reason should say what the consequence is, got {why:?}"
        );
        let _ = child.kill();
        let _ = child.wait();
    }
}
