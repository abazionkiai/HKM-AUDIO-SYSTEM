use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

pub const APO_SHM_MAGIC: u32 = 0x484B_4D32; // "HKM2"
pub const APO_SHM_VERSION: u32 = 1;
pub const APO_SHM_GLOBAL_NAME: &str = "Global\\HKM_Audio_APO_Bridge_v1";
pub const APO_SHM_LOCAL_NAME: &str = "Local\\HKM_Audio_APO_Bridge_v1";

pub const APO_CLSID_STR: &str = "{7A4C2B91-6E1F-4B8D-9C3A-5D82E4F10A28}";
pub const APO_FRIENDLY_NAME: &str = "HKM Audio Dry-Suppress & Tap APO";

pub const RING_FRAMES: usize = 16384;
pub const RING_CHANNELS: usize = 2;
pub const RING_SAMPLES: usize = RING_FRAMES * RING_CHANNELS;
pub const APP_WATCHDOG_TIMEOUT_MS: u64 = 500;
pub const APO_ALIVE_TIMEOUT_MS: u64 = 1200;

/// Epoch milliseconds used consistently across audiodg.exe and desktop process watchdogs.
pub fn current_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Lock-free C-ABI shared-memory layout bridged between hkm_audio_apo.dll and HKM desktop engine.
#[repr(C)]
pub struct ApoBridgeShm {
    pub magic: AtomicU32,
    pub version: AtomicU32,
    pub app_heartbeat_ms: AtomicU64,
    pub apo_heartbeat_ms: AtomicU64,
    pub suppress_dry: AtomicU32,
    pub sample_rate: AtomicU32,
    pub channels: AtomicU32,
    pub _reserved: AtomicU32,
    pub write_pos: AtomicU64,
    pub read_pos: AtomicU64,
    pub samples: [f32; RING_SAMPLES],
}

impl ApoBridgeShm {
    pub fn init_header(&self) {
        self.version.store(APO_SHM_VERSION, Ordering::Relaxed);
        self.app_heartbeat_ms.store(0, Ordering::Relaxed);
        self.apo_heartbeat_ms.store(0, Ordering::Relaxed);
        self.suppress_dry.store(0, Ordering::Relaxed);
        self.sample_rate.store(48000, Ordering::Relaxed);
        self.channels.store(2, Ordering::Relaxed);
        self._reserved.store(0, Ordering::Relaxed);
        self.write_pos.store(0, Ordering::Relaxed);
        self.read_pos.store(0, Ordering::Relaxed);
        self.magic.store(APO_SHM_MAGIC, Ordering::Release);
    }

    pub fn is_valid(&self) -> bool {
        self.magic.load(Ordering::Acquire) == APO_SHM_MAGIC
            && self.version.load(Ordering::Acquire) == APO_SHM_VERSION
    }

    pub fn stamp_app_heartbeat(&self, now_ms: u64) {
        self.app_heartbeat_ms.store(now_ms, Ordering::Release);
    }

    pub fn stamp_apo_heartbeat(&self, now_ms: u64, sample_rate: u32, channels: u32) {
        if sample_rate > 0 {
            self.sample_rate.store(sample_rate, Ordering::Relaxed);
        }
        if channels > 0 {
            self.channels.store(channels, Ordering::Relaxed);
        }
        self.apo_heartbeat_ms.store(now_ms, Ordering::Release);
    }

    pub fn set_suppress_dry(&self, enabled: bool) {
        self.suppress_dry
            .store(if enabled { 1 } else { 0 }, Ordering::Release);
    }

    pub fn is_app_alive(&self, now_ms: u64, timeout_ms: u64) -> bool {
        let last = self.app_heartbeat_ms.load(Ordering::Acquire);
        last > 0 && now_ms.saturating_sub(last) <= timeout_ms
    }

    pub fn is_apo_alive(&self, now_ms: u64, timeout_ms: u64) -> bool {
        if !self.is_valid() {
            return false;
        }
        let last = self.apo_heartbeat_ms.load(Ordering::Acquire);
        last > 0 && now_ms.saturating_sub(last) <= timeout_ms
    }

    /// Fail-safe gate: returns true ONLY when dry suppression is explicitly requested AND
    /// the desktop app's heartbeat is fresh within APP_WATCHDOG_TIMEOUT_MS (500ms).
    /// Any crash, close, or hang immediately reverts APOProcess to bit-perfect unity passthrough.
    pub fn should_suppress_dry(&self, now_ms: u64) -> bool {
        self.is_valid()
            && self.suppress_dry.load(Ordering::Acquire) == 1
            && self.is_app_alive(now_ms, APP_WATCHDOG_TIMEOUT_MS)
    }

    /// Lock-free SPSC producer: pushes interleaved stereo frames (`frames.len() == num_frames * 2`).
    pub fn push_interleaved(&self, interleaved_stereo: &[f32]) {
        let num_frames = interleaved_stereo.len() / RING_CHANNELS;
        if num_frames == 0 || !self.is_valid() {
            return;
        }

        let mut wp = self.write_pos.load(Ordering::Relaxed);
        let rp = self.read_pos.load(Ordering::Acquire);

        // If producer is about to lap consumer, advance read_pos to keep newest audio.
        let buffered = wp.saturating_sub(rp) as usize;
        if buffered + num_frames >= RING_FRAMES {
            let new_rp = (wp + num_frames as u64).saturating_sub((RING_FRAMES - 1) as u64);
            self.read_pos.store(new_rp, Ordering::Release);
        }

        let base_ptr = self.samples.as_ptr() as *mut f32;
        for frame_idx in 0..num_frames {
            let ring_slot = ((wp as usize) % RING_FRAMES) * RING_CHANNELS;
            let src_idx = frame_idx * RING_CHANNELS;
            // Safety: SPSC invariant — only the APO thread writes to slots ahead of rp.
            unsafe {
                *base_ptr.add(ring_slot) = interleaved_stereo[src_idx];
                *base_ptr.add(ring_slot + 1) = interleaved_stereo[src_idx + 1];
            }
            wp = wp.wrapping_add(1);
        }

        self.write_pos.store(wp, Ordering::Release);
    }

    /// Lock-free SPSC consumer: pops up to `out_interleaved.len() / 2` stereo frames, returns frames read.
    pub fn pop_interleaved(&self, out_interleaved: &mut [f32]) -> usize {
        let max_frames = out_interleaved.len() / RING_CHANNELS;
        if max_frames == 0 || !self.is_valid() {
            return 0;
        }

        let wp = self.write_pos.load(Ordering::Acquire);
        let mut rp = self.read_pos.load(Ordering::Relaxed);
        let available = wp.saturating_sub(rp) as usize;
        let to_read = available.min(max_frames);
        if to_read == 0 {
            return 0;
        }

        let base_ptr = self.samples.as_ptr();
        for frame_idx in 0..to_read {
            let ring_slot = ((rp as usize) % RING_FRAMES) * RING_CHANNELS;
            let dst_idx = frame_idx * RING_CHANNELS;
            unsafe {
                out_interleaved[dst_idx] = *base_ptr.add(ring_slot);
                out_interleaved[dst_idx + 1] = *base_ptr.add(ring_slot + 1);
            }
            rp = rp.wrapping_add(1);
        }

        self.read_pos.store(rp, Ordering::Release);
        to_read
    }

    pub fn clear_ring(&self) {
        let wp = self.write_pos.load(Ordering::Acquire);
        self.read_pos.store(wp, Ordering::Release);
    }
}

#[cfg(windows)]
mod win_shm {
    use super::*;
    use std::ptr::{null, null_mut};
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS, HANDLE, HLOCAL, LocalFree};
    use windows::Win32::Security::Authorization::ConvertStringSecurityDescriptorToSecurityDescriptorW;
    use windows::Win32::Security::{PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES};
    use windows::Win32::System::Memory::{
        CreateFileMappingW, MapViewOfFile, OpenFileMappingW, UnmapViewOfFile, FILE_MAP_ALL_ACCESS,
        MEMORY_MAPPED_VIEW_ADDRESS, PAGE_READWRITE,
    };

    fn to_wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// Scoped SDDL grants full mapping access strictly to System (SY), Local Service / audiodg (LS),
    /// Admins (BA), and Authenticated Users (AU).
    unsafe fn create_mapping_with_acl(name: &str, size: u32) -> Option<(HANDLE, bool)> {
        let sddl = to_wide("D:(A;;GA;;;SY)(A;;GA;;;LS)(A;;GA;;;BA)(A;;GA;;;AU)");
        let mut sd = PSECURITY_DESCRIPTOR::default();
        let sa_ok = ConvertStringSecurityDescriptorToSecurityDescriptorW(
            PCWSTR(sddl.as_ptr()),
            1, // SDDL_REVISION_1
            &mut sd,
            None,
        )
        .is_ok();

        let sa = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: if sa_ok { sd.0 } else { null_mut() },
            bInheritHandle: false.into(),
        };

        let wide_name = to_wide(name);
        let handle_res = CreateFileMappingW(
            HANDLE(-1isize as *mut core::ffi::c_void),
            if sa_ok { Some(&sa) } else { None },
            PAGE_READWRITE,
            0,
            size,
            PCWSTR(wide_name.as_ptr()),
        );
        let last_err = GetLastError();

        if sa_ok && !sd.0.is_null() {
            let _ = LocalFree(Some(HLOCAL(sd.0)));
        }

        match handle_res {
            Ok(h) if !h.is_invalid() => Some((h, last_err != ERROR_ALREADY_EXISTS)),
            _ => None,
        }
    }

    pub struct SharedMemoryHandle {
        handle: HANDLE,
        view: MEMORY_MAPPED_VIEW_ADDRESS,
        pub is_global: bool,
    }

    unsafe impl Send for SharedMemoryHandle {}
    unsafe impl Sync for SharedMemoryHandle {}

    impl SharedMemoryHandle {
        /// Called by audiodg.exe (which holds SeCreateGlobalPrivilege): creates or attaches
        /// Global\HKM_Audio_APO_Bridge_v1 with restricted ACL so the desktop UI can attach.
        pub fn open_for_service() -> Option<Self> {
            let size = std::mem::size_of::<ApoBridgeShm>() as u32;
            unsafe {
                let (handle, is_global, newly_created) =
                    if let Some((h, created)) = create_mapping_with_acl(APO_SHM_GLOBAL_NAME, size) {
                        (h, true, created)
                    } else if let Some((h, created)) =
                        create_mapping_with_acl(APO_SHM_LOCAL_NAME, size)
                    {
                        (h, false, created)
                    } else {
                        return None;
                    };

                let view = MapViewOfFile(handle, FILE_MAP_ALL_ACCESS, 0, 0, size as usize);
                if view.Value.is_null() {
                    let _ = CloseHandle(handle);
                    return None;
                }

                let shm = &*(view.Value as *const ApoBridgeShm);
                if newly_created || !shm.is_valid() {
                    std::ptr::write_bytes(view.Value as *mut u8, 0, size as usize);
                    shm.init_header();
                }

                Some(Self {
                    handle,
                    view,
                    is_global,
                })
            }
        }

        /// Called by desktop app: prefers opening audiodg's Global\ mapping, or creates Global/Local fallback.
        pub fn open_for_client() -> Option<Self> {
            let size = std::mem::size_of::<ApoBridgeShm>() as u32;
            unsafe {
                let global_wide = to_wide(APO_SHM_GLOBAL_NAME);
                if let Ok(h) = OpenFileMappingW(FILE_MAP_ALL_ACCESS.0, false, PCWSTR(global_wide.as_ptr())) {
                    if !h.is_invalid() {
                        let view = MapViewOfFile(h, FILE_MAP_ALL_ACCESS, 0, 0, size as usize);
                        if !view.Value.is_null() {
                            return Some(Self {
                                handle: h,
                                view,
                                is_global: true,
                            });
                        }
                        let _ = CloseHandle(h);
                    }
                }
            }
            Self::open_for_service()
        }

        pub fn try_reattach_global(&mut self) -> bool {
            if self.is_global {
                return true;
            }
            let size = std::mem::size_of::<ApoBridgeShm>() as u32;
            unsafe {
                let global_wide = to_wide(APO_SHM_GLOBAL_NAME);
                if let Ok(h) = OpenFileMappingW(FILE_MAP_ALL_ACCESS.0, false, PCWSTR(global_wide.as_ptr())) {
                    if !h.is_invalid() {
                        let view = MapViewOfFile(h, FILE_MAP_ALL_ACCESS, 0, 0, size as usize);
                        if !view.Value.is_null() {
                            let _ = UnmapViewOfFile(self.view);
                            let _ = CloseHandle(self.handle);
                            self.handle = h;
                            self.view = view;
                            self.is_global = true;
                            return true;
                        }
                        let _ = CloseHandle(h);
                    }
                }
            }
            let _ = null::<PWSTR>();
            let _ = null::<u16>();
            false
        }

        pub fn shm(&self) -> &ApoBridgeShm {
            unsafe { &*(self.view.Value as *const ApoBridgeShm) }
        }
    }

    impl Drop for SharedMemoryHandle {
        fn drop(&mut self) {
            unsafe {
                if !self.view.Value.is_null() {
                    let _ = UnmapViewOfFile(self.view);
                }
                if !self.handle.is_invalid() {
                    let _ = CloseHandle(self.handle);
                }
            }
        }
    }
}

#[cfg(windows)]
pub use win_shm::SharedMemoryHandle;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fail_safe_reverts_after_500ms_timeout() {
        let shm_box: Box<ApoBridgeShm> = unsafe {
            let layout = std::alloc::Layout::new::<ApoBridgeShm>();
            let ptr = std::alloc::alloc_zeroed(layout) as *mut ApoBridgeShm;
            Box::from_raw(ptr)
        };
        shm_box.init_header();
        shm_box.set_suppress_dry(true);
        shm_box.stamp_app_heartbeat(10_000);

        assert!(shm_box.should_suppress_dry(10_200), "Active within 500ms");
        assert!(shm_box.should_suppress_dry(10_500), "Boundary at 500ms");
        assert!(
            !shm_box.should_suppress_dry(10_501),
            "Must fail-safe to passthrough after 500ms without heartbeat"
        );

        shm_box.stamp_app_heartbeat(10_501);
        assert!(shm_box.should_suppress_dry(10_501));
        shm_box.set_suppress_dry(false);
        assert!(!shm_box.should_suppress_dry(10_501));
    }

    #[test]
    fn ring_buffer_preserves_stereo_order_and_wraparound() {
        let shm_box: Box<ApoBridgeShm> = unsafe {
            let layout = std::alloc::Layout::new::<ApoBridgeShm>();
            let ptr = std::alloc::alloc_zeroed(layout) as *mut ApoBridgeShm;
            Box::from_raw(ptr)
        };
        shm_box.init_header();

        // Advance near end of ring to force wrap-around
        let chunk_frames = 512;
        let mut input = vec![0.0f32; chunk_frames * 2];
        let mut output = vec![0.0f32; chunk_frames * 2];

        for iter in 0..40u32 {
            for f in 0..chunk_frames {
                let v = (iter as f32) + (f as f32) * 0.001;
                input[f * 2] = v;
                input[f * 2 + 1] = -v;
            }
            shm_box.push_interleaved(&input);
            let read = shm_box.pop_interleaved(&mut output);
            assert_eq!(read, chunk_frames);
            assert_eq!(output[0], iter as f32);
            assert_eq!(output[1], -(iter as f32));
            assert!((output[(chunk_frames - 1) * 2] - ((iter as f32) + 0.511)).abs() < 1e-4);
        }
    }
}
