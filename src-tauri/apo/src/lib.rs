#![cfg(windows)]
#![allow(non_snake_case)]

use apo_shared::{
    current_time_ms, SharedMemoryHandle, APO_CLSID_STR, APO_FRIENDLY_NAME, RING_CHANNELS,
};
use std::ffi::c_void;
use std::sync::atomic::{AtomicI32, AtomicU32, AtomicUsize, Ordering};
use windows::core::{implement, IUnknown, Interface, Result, BOOL, GUID, HRESULT, PCWSTR};
use windows::Win32::Foundation::{
    CLASS_E_CLASSNOTAVAILABLE, CLASS_E_NOAGGREGATION, E_ACCESSDENIED, E_FAIL, E_INVALIDARG,
    E_NOINTERFACE, E_OUTOFMEMORY, E_POINTER, HMODULE, MAX_PATH, S_FALSE, S_OK,
};
use windows::Win32::Media::Audio::Apo::{
    APO_CONNECTION_DESCRIPTOR, APO_CONNECTION_PROPERTY, APO_FLAG,
    APO_FLAG_BITSPERSAMPLE_MUST_MATCH, APO_FLAG_FRAMESPERSECOND_MUST_MATCH, APO_FLAG_INPLACE,
    APO_FLAG_SAMPLESPERFRAME_MUST_MATCH, APO_REG_PROPERTIES, BUFFER_SILENT, IAudioMediaType,
    IAudioProcessingObject, IAudioProcessingObjectConfiguration,
    IAudioProcessingObjectConfiguration_Impl, IAudioProcessingObjectRT,
    IAudioProcessingObjectRT_Impl, IAudioProcessingObject_Impl,
};
use windows::Win32::Media::Audio::{WAVEFORMATEX, WAVEFORMATEXTENSIBLE};
use windows::Win32::Media::KernelStreaming::WAVE_FORMAT_EXTENSIBLE;
use windows::Win32::Media::Multimedia::WAVE_FORMAT_IEEE_FLOAT;
use windows::Win32::System::Com::{CoTaskMemAlloc, IClassFactory, IClassFactory_Impl};
use windows::Win32::System::LibraryLoader::GetModuleFileNameW;
use windows::Win32::System::Registry::{
    RegCloseKey, RegCreateKeyExW, RegDeleteTreeW, RegSetValueExW, HKEY, HKEY_LOCAL_MACHINE,
    KEY_WRITE, REG_DWORD, REG_OPTION_NON_VOLATILE, REG_SZ,
};

// {7A4C2B91-6E1F-4B8D-9C3A-5D82E4F10A28}
pub const HKM_APO_CLSID: GUID = GUID::from_values(
    0x7A4C_2B91,
    0x6E1F,
    0x4B8D,
    [0x9C, 0x3A, 0x5D, 0x82, 0xE4, 0xF1, 0x0A, 0x28],
);

const KSDATAFORMAT_SUBTYPE_IEEE_FLOAT_GUID: GUID =
    GUID::from_u128(0x00000003_0000_0010_8000_00aa00389b71);

static OBJECT_COUNT: AtomicUsize = AtomicUsize::new(0);
static DLL_HMODULE: AtomicUsize = AtomicUsize::new(0);

#[implement(
    IAudioProcessingObject,
    IAudioProcessingObjectRT,
    IAudioProcessingObjectConfiguration
)]
struct HkmDrySuppressApo {
    shm: Option<SharedMemoryHandle>,
    sample_rate: AtomicU32,
    channels: AtomicU32,
    passthrough_gain_bits: AtomicU32,
    locked: AtomicI32,
}

impl Drop for HkmDrySuppressApo {
    fn drop(&mut self) {
        OBJECT_COUNT.fetch_sub(1, Ordering::AcqRel);
    }
}

impl HkmDrySuppressApo {
    fn new() -> Self {
        OBJECT_COUNT.fetch_add(1, Ordering::AcqRel);
        Self {
            shm: SharedMemoryHandle::open_for_service(),
            sample_rate: AtomicU32::new(48000),
            channels: AtomicU32::new(2),
            passthrough_gain_bits: AtomicU32::new(1.0f32.to_bits()),
            locked: AtomicI32::new(0),
        }
    }
}

unsafe fn is_supported_float_format(wfx: *const WAVEFORMATEX) -> Option<(u32, u32)> {
    if wfx.is_null() {
        return None;
    }
    let f = &*wfx;
    let tag = f.wFormatTag as u32;
    let channels = f.nChannels as u32;
    let rate = f.nSamplesPerSec;
    if channels == 0 || channels > 8 || rate < 8000 || rate > 384000 {
        return None;
    }
    if tag == WAVE_FORMAT_IEEE_FLOAT && f.wBitsPerSample == 32 {
        return Some((channels, rate));
    }
    if tag == WAVE_FORMAT_EXTENSIBLE && (f.cbSize as usize) >= 22 {
        let ext = &*(wfx as *const WAVEFORMATEXTENSIBLE);
        let sub_fmt = std::ptr::addr_of!(ext.SubFormat).read_unaligned();
        if sub_fmt == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT_GUID && f.wBitsPerSample == 32 {
            return Some((channels, rate));
        }
    }
    None
}

unsafe fn extract_wfx(desc: *const APO_CONNECTION_DESCRIPTOR) -> Option<(u32, u32)> {
    if desc.is_null() {
        return None;
    }
    let fmt = (*desc).pFormat.as_ref()?;
    let wfx = fmt.GetAudioFormat();
    is_supported_float_format(wfx)
}

impl IAudioProcessingObject_Impl for HkmDrySuppressApo_Impl {
    fn Reset(&self) -> Result<()> {
        self.passthrough_gain_bits
            .store(1.0f32.to_bits(), Ordering::Relaxed);
        Ok(())
    }

    fn GetLatency(&self) -> Result<i64> {
        Ok(0)
    }

    fn GetRegistrationProperties(&self) -> Result<*mut APO_REG_PROPERTIES> {
        unsafe {
            let mem = CoTaskMemAlloc(std::mem::size_of::<APO_REG_PROPERTIES>())
                as *mut APO_REG_PROPERTIES;
            if mem.is_null() {
                return Err(E_OUTOFMEMORY.into());
            }
            std::ptr::write_bytes(mem, 0, 1);
            let props = &mut *mem;
            props.clsid = HKM_APO_CLSID;
            props.Flags = APO_FLAG(
                APO_FLAG_INPLACE.0
                    | APO_FLAG_SAMPLESPERFRAME_MUST_MATCH.0
                    | APO_FLAG_FRAMESPERSECOND_MUST_MATCH.0
                    | APO_FLAG_BITSPERSAMPLE_MUST_MATCH.0,
            );
            for (i, ch) in APO_FRIENDLY_NAME.encode_utf16().enumerate() {
                if i + 1 < props.szFriendlyName.len() {
                    props.szFriendlyName[i] = ch;
                }
            }
            for (i, ch) in "HKM Audio System".encode_utf16().enumerate() {
                if i + 1 < props.szCopyrightInfo.len() {
                    props.szCopyrightInfo[i] = ch;
                }
            }
            props.u32MajorVersion = 1;
            props.u32MinorVersion = 0;
            props.u32MinInputConnections = 1;
            props.u32MaxInputConnections = 1;
            props.u32MinOutputConnections = 1;
            props.u32MaxOutputConnections = 1;
            props.u32MaxInstances = 16;
            props.u32NumAPOInterfaces = 1;
            props.iidAPOInterfaceList[0] = IAudioProcessingObject::IID;
            Ok(mem)
        }
    }

    fn Initialize(&self, _cbdatasize: u32, _pbydata: *const u8) -> Result<()> {
        Ok(())
    }

    fn IsInputFormatSupported(
        &self,
        poppositeformat: windows_core::Ref<'_, IAudioMediaType>,
        prequestedinputformat: windows_core::Ref<'_, IAudioMediaType>,
    ) -> Result<IAudioMediaType> {
        let Some(req) = prequestedinputformat.as_ref() else {
            return Err(E_POINTER.into());
        };
        unsafe {
            let wfx = req.GetAudioFormat();
            if let Some((ch, sr)) = is_supported_float_format(wfx) {
                if let Some(opp) = poppositeformat.as_ref() {
                    if let Some((opp_ch, opp_sr)) = is_supported_float_format(opp.GetAudioFormat())
                    {
                        if opp_ch != ch || opp_sr != sr {
                            return Ok(opp.clone());
                        }
                    }
                }
                return Ok(req.clone());
            }
        }
        Err(HRESULT(-2004287480i32).into()) // APOERR_FORMAT_NOT_SUPPORTED
    }

    fn IsOutputFormatSupported(
        &self,
        poppositeformat: windows_core::Ref<'_, IAudioMediaType>,
        prequestedoutputformat: windows_core::Ref<'_, IAudioMediaType>,
    ) -> Result<IAudioMediaType> {
        self.IsInputFormatSupported(poppositeformat, prequestedoutputformat)
    }

    fn GetInputChannelCount(&self) -> Result<u32> {
        Ok(self.channels.load(Ordering::Relaxed))
    }
}

impl IAudioProcessingObjectConfiguration_Impl for HkmDrySuppressApo_Impl {
    fn LockForProcess(
        &self,
        u32numinputconnections: u32,
        ppinputconnections: *const *const APO_CONNECTION_DESCRIPTOR,
        u32numoutputconnections: u32,
        ppoutputconnections: *const *const APO_CONNECTION_DESCRIPTOR,
    ) -> Result<()> {
        if u32numinputconnections != 1 || u32numoutputconnections != 1 {
            return Err(E_INVALIDARG.into());
        }
        if ppinputconnections.is_null() || ppoutputconnections.is_null() {
            return Err(E_POINTER.into());
        }
        unsafe {
            let in_desc = *ppinputconnections;
            let out_desc = *ppoutputconnections;
            if let Some((ch, sr)) = extract_wfx(in_desc) {
                self.channels.store(ch, Ordering::Relaxed);
                self.sample_rate.store(sr, Ordering::Relaxed);
            } else if let Some((ch, sr)) = extract_wfx(out_desc) {
                self.channels.store(ch, Ordering::Relaxed);
                self.sample_rate.store(sr, Ordering::Relaxed);
            } else {
                return Err(HRESULT(-2004287480i32).into());
            }
        }
        self.locked.store(1, Ordering::Release);
        Ok(())
    }

    fn UnlockForProcess(&self) -> Result<()> {
        self.locked.store(0, Ordering::Release);
        Ok(())
    }
}

impl IAudioProcessingObjectRT_Impl for HkmDrySuppressApo_Impl {
    fn APOProcess(
        &self,
        u32numinputconnections: u32,
        ppinputconnections: *const *const APO_CONNECTION_PROPERTY,
        u32numoutputconnections: u32,
        ppoutputconnections: *mut *mut APO_CONNECTION_PROPERTY,
    ) {
        if u32numinputconnections == 0
            || u32numoutputconnections == 0
            || ppinputconnections.is_null()
            || ppoutputconnections.is_null()
        {
            return;
        }

        unsafe {
            let in_conn = *ppinputconnections;
            let out_conn = *ppoutputconnections;
            if in_conn.is_null() || out_conn.is_null() {
                return;
            }

            let valid_frames = (*in_conn).u32ValidFrameCount as usize;
            let channels = self.channels.load(Ordering::Relaxed).max(1) as usize;
            let sr = self.sample_rate.load(Ordering::Relaxed).max(48000);
            let total_samples = valid_frames * channels;

            let in_silent = ((*in_conn).u32BufferFlags.0 & BUFFER_SILENT.0) != 0;
            let in_ptr = (*in_conn).pBuffer as *const f32;
            let out_ptr = (*out_conn).pBuffer as *mut f32;

            (*out_conn).u32ValidFrameCount = valid_frames as u32;

            let mut suppress = false;
            if let Some(shm_handle) = &self.shm {
                let shm = shm_handle.shm();
                let now_ms = current_time_ms();
                shm.stamp_apo_heartbeat(now_ms, sr, channels as u32);
                suppress = shm.should_suppress_dry(now_ms);

                if suppress && valid_frames > 0 && channels == RING_CHANNELS {
                    if in_silent || in_ptr.is_null() {
                        const ZERO_CHUNK: usize = 512;
                        let zeros = [0.0f32; ZERO_CHUNK * 2];
                        let mut rem = valid_frames;
                        while rem > 0 {
                            let step = rem.min(ZERO_CHUNK);
                            shm.push_interleaved(&zeros[..step * 2]);
                            rem -= step;
                        }
                    } else {
                        let slice = core::slice::from_raw_parts(in_ptr, total_samples);
                        shm.push_interleaved(slice);
                    }
                }
            }

            let target_gain = if suppress { 0.0f32 } else { 1.0f32 };
            let mut gain = f32::from_bits(self.passthrough_gain_bits.load(Ordering::Relaxed));

            if in_silent || in_ptr.is_null() {
                if !out_ptr.is_null() && out_ptr as *const f32 != in_ptr {
                    std::ptr::write_bytes(out_ptr, 0, total_samples);
                }
                (*out_conn).u32BufferFlags = (*in_conn).u32BufferFlags;
                self.passthrough_gain_bits
                    .store(target_gain.to_bits(), Ordering::Relaxed);
                return;
            }

            if out_ptr.is_null() {
                return;
            }

            let in_slice = core::slice::from_raw_parts(in_ptr, total_samples);
            let out_slice = core::slice::from_raw_parts_mut(out_ptr, total_samples);

            // Fast path: bit-perfect unity passthrough when idle or Desktop Audio dry suppression off
            if !suppress && (gain - 1.0).abs() < 1e-6 {
                if out_ptr as *const f32 != in_ptr {
                    out_slice.copy_from_slice(in_slice);
                }
                (*out_conn).u32BufferFlags = (*in_conn).u32BufferFlags;
                return;
            }

            // Fast path: settled zero gain while suppressing dry speaker feed
            if suppress && gain <= 1e-6 {
                out_slice.fill(0.0);
                (*out_conn).u32BufferFlags = BUFFER_SILENT;
                return;
            }

            // Smooth 5ms linear ramp between 1.0 and 0.0 to prevent clicks
            let step = (1.0f32 / 240.0f32) * (if suppress { -1.0 } else { 1.0 });
            for f in 0..valid_frames {
                gain = (gain + step).clamp(0.0, 1.0);
                let base = f * channels;
                for c in 0..channels {
                    out_slice[base + c] = in_slice[base + c] * gain;
                }
            }
            self.passthrough_gain_bits
                .store(gain.to_bits(), Ordering::Relaxed);
            (*out_conn).u32BufferFlags = (*in_conn).u32BufferFlags;
        }
    }

    fn CalcInputFrames(&self, u32outputframecount: u32) -> u32 {
        u32outputframecount
    }

    fn CalcOutputFrames(&self, u32inputframecount: u32) -> u32 {
        u32inputframecount
    }
}

#[implement(IClassFactory)]
struct HkmApoFactory;

impl IClassFactory_Impl for HkmApoFactory_Impl {
    fn CreateInstance(
        &self,
        punkouter: windows_core::Ref<'_, IUnknown>,
        riid: *const GUID,
        ppvobject: *mut *mut c_void,
    ) -> Result<()> {
        if ppvobject.is_null() {
            return Err(E_POINTER.into());
        }
        if punkouter.as_ref().is_some() {
            return Err(CLASS_E_NOAGGREGATION.into());
        }
        unsafe {
            let unk: IUnknown = HkmDrySuppressApo::new().into();
            unk.query(&*riid, ppvobject).ok()
        }
    }

    fn LockServer(&self, _flock: BOOL) -> Result<()> {
        Ok(())
    }
}

#[no_mangle]
pub unsafe extern "system" fn DllMain(
    hinst: HMODULE,
    reason: u32,
    _reserved: *mut c_void,
) -> BOOL {
    if reason == 1 {
        DLL_HMODULE.store(hinst.0 as usize, Ordering::Release);
    }
    BOOL(1)
}

#[no_mangle]
pub unsafe extern "system" fn DllGetClassObject(
    rclsid: *const GUID,
    riid: *const GUID,
    ppv: *mut *mut c_void,
) -> HRESULT {
    if rclsid.is_null() || riid.is_null() || ppv.is_null() {
        return E_POINTER;
    }
    *ppv = core::ptr::null_mut();
    if *rclsid != HKM_APO_CLSID {
        return CLASS_E_CLASSNOTAVAILABLE;
    }
    let factory: IClassFactory = HkmApoFactory.into();
    let res = factory.query(riid, ppv);
    if res.is_err() {
        E_NOINTERFACE
    } else {
        S_OK
    }
}

#[no_mangle]
pub unsafe extern "system" fn DllCanUnloadNow() -> HRESULT {
    if OBJECT_COUNT.load(Ordering::Acquire) == 0 {
        S_OK
    } else {
        S_FALSE
    }
}

fn to_wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

unsafe fn reg_set_sz(subkey: &str, name: Option<&str>, value: &str) -> bool {
    let subkey_w = to_wide(subkey);
    let mut hkey = HKEY::default();
    if RegCreateKeyExW(
        HKEY_LOCAL_MACHINE,
        PCWSTR(subkey_w.as_ptr()),
        Some(0),
        None,
        REG_OPTION_NON_VOLATILE,
        KEY_WRITE,
        None,
        &mut hkey,
        None,
    )
    .is_err()
    {
        return false;
    }
    let val_w = to_wide(value);
    let name_w = name.map(to_wide);
    let ok = RegSetValueExW(
        hkey,
        name_w
            .as_ref()
            .map_or(PCWSTR::null(), |v| PCWSTR(v.as_ptr())),
        Some(0),
        REG_SZ,
        Some(core::slice::from_raw_parts(
            val_w.as_ptr() as *const u8,
            val_w.len() * 2,
        )),
    )
    .is_ok();
    let _ = RegCloseKey(hkey);
    ok
}

unsafe fn reg_set_dword(subkey: &str, name: &str, value: u32) -> bool {
    let subkey_w = to_wide(subkey);
    let mut hkey = HKEY::default();
    if RegCreateKeyExW(
        HKEY_LOCAL_MACHINE,
        PCWSTR(subkey_w.as_ptr()),
        Some(0),
        None,
        REG_OPTION_NON_VOLATILE,
        KEY_WRITE,
        None,
        &mut hkey,
        None,
    )
    .is_err()
    {
        return false;
    }
    let name_w = to_wide(name);
    let bytes = value.to_le_bytes();
    let ok = RegSetValueExW(
        hkey,
        PCWSTR(name_w.as_ptr()),
        Some(0),
        REG_DWORD,
        Some(&bytes),
    )
    .is_ok();
    let _ = RegCloseKey(hkey);
    ok
}

#[no_mangle]
pub unsafe extern "system" fn DllRegisterServer() -> HRESULT {
    let hmod = HMODULE(DLL_HMODULE.load(Ordering::Acquire) as *mut c_void);
    let mut path_buf = [0u16; MAX_PATH as usize];
    let len = GetModuleFileNameW(Some(hmod), &mut path_buf) as usize;
    if len == 0 {
        return E_FAIL;
    }
    let dll_path = String::from_utf16_lossy(&path_buf[..len]);

    let clsid_key = format!("SOFTWARE\\Classes\\CLSID\\{APO_CLSID_STR}");
    let inproc_key = format!("{clsid_key}\\InprocServer32");
    let apo_key = format!("SOFTWARE\\Classes\\AudioEngine\\AudioProcessingObjects\\{APO_CLSID_STR}");

    if !reg_set_sz(&clsid_key, None, APO_FRIENDLY_NAME)
        || !reg_set_sz(&inproc_key, None, &dll_path)
        || !reg_set_sz(&inproc_key, Some("ThreadingModel"), "Both")
        || !reg_set_sz(&apo_key, Some("FriendlyName"), APO_FRIENDLY_NAME)
        || !reg_set_sz(&apo_key, Some("Copyright"), "HKM Audio System")
        || !reg_set_dword(&apo_key, "MajorVersion", 1)
        || !reg_set_dword(&apo_key, "MinorVersion", 0)
        || !reg_set_dword(
            &apo_key,
            "Flags",
            (APO_FLAG_INPLACE.0
                | APO_FLAG_SAMPLESPERFRAME_MUST_MATCH.0
                | APO_FLAG_FRAMESPERSECOND_MUST_MATCH.0
                | APO_FLAG_BITSPERSAMPLE_MUST_MATCH.0) as u32,
        )
        || !reg_set_dword(&apo_key, "MinInputConnections", 1)
        || !reg_set_dword(&apo_key, "MaxInputConnections", 1)
        || !reg_set_dword(&apo_key, "MinOutputConnections", 1)
        || !reg_set_dword(&apo_key, "MaxOutputConnections", 1)
        || !reg_set_dword(&apo_key, "MaxInstances", 16)
        || !reg_set_dword(&apo_key, "NumAPOInterfaces", 1)
        || !reg_set_sz(
            &apo_key,
            Some("APOInterface0"),
            "{FD7F2B29-24D0-4B5C-B177-592C39F9CA10}",
        )
    {
        return E_ACCESSDENIED;
    }

    S_OK
}

#[no_mangle]
pub unsafe extern "system" fn DllUnregisterServer() -> HRESULT {
    let clsid_key = to_wide(&format!("SOFTWARE\\Classes\\CLSID\\{APO_CLSID_STR}"));
    let apo_key = to_wide(&format!(
        "SOFTWARE\\Classes\\AudioEngine\\AudioProcessingObjects\\{APO_CLSID_STR}"
    ));
    let _ = RegDeleteTreeW(HKEY_LOCAL_MACHINE, PCWSTR(clsid_key.as_ptr()));
    let _ = RegDeleteTreeW(HKEY_LOCAL_MACHINE, PCWSTR(apo_key.as_ptr()));
    S_OK
}
