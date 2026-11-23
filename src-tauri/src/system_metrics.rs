use std::sync::Mutex;

#[derive(Clone, Copy)]
struct SystemCpuCounters {
    idle: u64,
    kernel: u64,
    user: u64,
}

#[derive(Default)]
pub struct SystemCpuSampler {
    previous: Mutex<Option<SystemCpuCounters>>,
}

impl SystemCpuSampler {
    /// Returns total Windows system CPU utilization over the interval since the
    /// previous sample. The first call seeds the counters and returns `None`.
    #[cfg(windows)]
    pub fn sample_percent(&self) -> Option<f64> {
        let current = read_system_cpu_counters()?;
        let mut previous = self.previous.lock().ok()?;
        let prior = previous.replace(current)?;

        let idle_delta = current.idle.checked_sub(prior.idle)?;
        let kernel_delta = current.kernel.checked_sub(prior.kernel)?;
        let user_delta = current.user.checked_sub(prior.user)?;
        // Windows kernel time includes idle time. Summing kernel + user gives
        // total processor time; subtracting idle yields busy processor time.
        let total_delta = kernel_delta.saturating_add(user_delta);
        if total_delta == 0 || idle_delta > total_delta {
            return None;
        }

        Some((((total_delta - idle_delta) as f64 / total_delta as f64) * 100.0).clamp(0.0, 100.0))
    }

    /// Windows system counters are not exposed by this command on other targets.
    #[cfg(not(windows))]
    pub fn sample_percent(&self) -> Option<f64> {
        None
    }
}

#[cfg(windows)]
fn read_system_cpu_counters() -> Option<SystemCpuCounters> {
    use windows::Win32::Foundation::FILETIME;
    use windows::Win32::System::Threading::GetSystemTimes;

    fn ticks(value: FILETIME) -> u64 {
        (u64::from(value.dwHighDateTime) << 32) | u64::from(value.dwLowDateTime)
    }

    let mut idle = FILETIME::default();
    let mut kernel = FILETIME::default();
    let mut user = FILETIME::default();
    unsafe {
        GetSystemTimes(Some(&mut idle), Some(&mut kernel), Some(&mut user)).ok()?;
    }

    Some(SystemCpuCounters {
        idle: ticks(idle),
        kernel: ticks(kernel),
        user: ticks(user),
    })
}
