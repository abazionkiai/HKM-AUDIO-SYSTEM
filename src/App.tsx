import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ModuleId } from './types/audio.ts';
import { useConsoleSession } from './store/useConsoleSession.ts';
import { useAudioEngine } from './store/useAudioEngine.ts';
import { useHardwareManager } from './store/useHardwareManager.ts';
import { useMidiManager } from './store/useMidiManager.ts';
import { useKeyboardShortcutsManager } from './store/useKeyboardShortcutsManager.ts';
import { isDesktopApp } from './utils/appApi.ts';
import {
  NATIVE_DESKTOP_AUDIO_ID,
  isNativeDesktopInputId,
  openWindowsSoundSettings,
  setDesktopAudioSourceIsolation,
  type DesktopSourceIsolationStatus,
} from './utils/nativeDesktopAudio.ts';
import {
  deriveAutoChannelNameAndRole,
  isVirtualCableInputLabel,
} from './utils/audioNaming.ts';
import { checkDesktopUpdate } from './utils/appUpdater.ts';
import { liveAudioEngine } from './audio/liveAudioEngine.ts';
import { TopBar } from './components/TopBar.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { ConsoleInstrumentDeck } from './components/ConsoleInstrumentDeck.tsx';
import { CentralDspChainView } from './components/CentralDspChainView.tsx';
import { ConsoleLeftPanel } from './components/ConsoleLeftPanel.tsx';
import { ConsoleRightPanel } from './components/ConsoleRightPanel.tsx';
import { ConsoleBottomBar } from './components/ConsoleBottomBar.tsx';
import { FeedbackAnalyzerModule } from './components/FeedbackAnalyzerModule.tsx';
import { AcousticAnalyzerModule } from './components/AcousticAnalyzerModule.tsx';
import { SpeakerZonesModule } from './components/SpeakerZonesModule.tsx';
import { MicrophoneIntelligenceModule } from './components/MicrophoneIntelligenceModule.tsx';
import { InstrumentIntelligenceModule } from './components/InstrumentIntelligenceModule.tsx';
import { LivestreamObsModule } from './components/LivestreamObsModule.tsx';
import { AutomatedSoundCheckModule } from './components/AutomatedSoundCheckModule.tsx';
import { PresetsServiceModule } from './components/PresetsServiceModule.tsx';
import { AiEngineerModule } from './components/AiEngineerModule.tsx';
import { MidiMappingModule } from './components/MidiMappingModule.tsx';
import { HardwareDiagnosticsModule } from './components/HardwareDiagnosticsModule.tsx';
import { VirtualDiBassModule } from './components/VirtualDiBassModule.tsx';
import { RemoteCompanionView } from './components/RemoteCompanionView.tsx';
import { KeyboardShortcutManager } from './components/KeyboardShortcutManager.tsx';
import { UpdateNotificationModal } from './components/UpdateNotificationModal.tsx';
import { AppMenuBar, APP_VERSION, type UpdateCheckBannerState } from './components/AppMenuBar.tsx';
import { GainStagingAssistantModal } from './components/GainStagingAssistantModal.tsx';
import { GlobalSearchModal } from './components/GlobalSearchModal.tsx';
import { SignalJourneyModal } from './components/SignalJourneyModal.tsx';
import { MultitrackRecorderModule } from './components/MultitrackRecorderModule.tsx';
import { UniversalRoutingModule } from './components/UniversalRoutingModule.tsx';
import { validateDspConfig } from './utils/camillaDsp.ts';

export default function App() {
  const [remoteCompanionToken, setRemoteCompanionToken] = useState<string | null>(() => {
    if (isDesktopApp()) return null;
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('mode') === 'remote') {
        const tok = params.get('token');
        if (tok) return tok;
      }
    } catch {
      // ignore URL parse error
    }
    return null;
  });

  const [activeModule, setActiveModule] = useState<ModuleId>('dsp');
  const [selectedChannelId, setSelectedChannelId] = useState<string>('ch-1');
  const [consoleLocked, setConsoleLocked] = useState<boolean>(false);
  const [appVersion, setAppVersion] = useState<string>(APP_VERSION);
  const [showAboutModal, setShowAboutModal] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [showGainStaging, setShowGainStaging] = useState(false);
  const [showGlobalSearch, setShowGlobalSearch] = useState(false);
  const [signalJourneyChannelId, setSignalJourneyChannelId] = useState<string | null>(null);
  const [desktopSourceIsolationStatus, setDesktopSourceIsolationStatus] =
    useState<DesktopSourceIsolationStatus | null>(null);
  const sourceIsolationQueueRef = useRef<Promise<DesktopSourceIsolationStatus | null>>(Promise.resolve(null));

  const syncDesktopSourceIsolation = useCallback((enabled: boolean) => {
    const next = sourceIsolationQueueRef.current.then(() => setDesktopAudioSourceIsolation(enabled));
    sourceIsolationQueueRef.current = next.then(() => null, () => null);
    return next;
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowGlobalSearch((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  const [updateCheckState, setUpdateCheckState] = useState<UpdateCheckBannerState>({ status: 'idle' });
  const [availableUpdate, setAvailableUpdate] = useState<{
    version: string;
    notes?: string;
    onInstall: (onProgress?: (percent: number) => void) => Promise<void>;
  } | null>(null);

  const runUpdateCheck = useCallback(async (openModalIfFound: boolean) => {
    setUpdateCheckState({ status: 'checking' });
    const res = await checkDesktopUpdate();
    if (res.available && res.downloadAndInstall && res.version) {
      setAvailableUpdate({
        version: res.version,
        notes: res.notes,
        onInstall: res.downloadAndInstall,
      });
      setUpdateCheckState({ status: 'available', version: res.version });
      if (openModalIfFound) {
        setShowUpdateModal(true);
      }
      return;
    }
    if (res.error) {
      setUpdateCheckState({ status: 'error', message: res.error });
      return;
    }
    setUpdateCheckState({ status: 'up-to-date' });
  }, []);

  // Resolve exact native desktop version & proactively check for verified releases on launch
  useEffect(() => {
    if (!isDesktopApp()) return;
    let active = true;

    import('@tauri-apps/api/app')
      .then((appApi) => appApi.getVersion())
      .then((ver) => {
        if (active && ver) setAppVersion(ver);
      })
      .catch(() => {
        // fallback to build-time APP_VERSION
      });

    const timer = window.setTimeout(async () => {
      if (active) {
        await runUpdateCheck(true);
      }
    }, 3500);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [runUpdateCheck]);

  const midiRef = useRef<any>(null);
  const shortcutsRef = useRef<any>(null);

  const handleMidiMappingsLoaded = useCallback((mappings: any[]) => {
    midiRef.current?.updateAndPersistMidiMappings(mappings);
  }, []);

  const handleKeyboardShortcutsLoaded = useCallback((shortcutsList: any[]) => {
    shortcutsRef.current?.updateAndPersistShortcuts(shortcutsList);
  }, []);

  // 1. Console Session Store: holds mixer state, presets, configuration versions, and SQLite persistence
  const session = useConsoleSession({
    remoteCompanionToken,
    onMidiMappingsLoaded: handleMidiMappingsLoaded,
    onKeyboardShortcutsLoaded: handleKeyboardShortcutsLoaded,
  });

  const {
    desktopWsRef,
    setFindings,
    handleUpdateChannel,
    handleUpdateDsp,
    handleSelectPreset,
    handleAddChannel,
    handleAddEqBand,
    handleResetDsp,
    handleClearAllSolos,
    setChannels,
    logAudit,
    setObsStatus,
    handleSaveVersion,
    handleBatchMute,
    handleToggleEmergencyMute,
    handleToggleTotalBypass,
    handleUndoLastDsp,
    handleSelectDevice,
    handleRegisterDevices,
    handleReconcileLiveInputs,
  } = session;

  // 2. Physical Hardware Discovery + Unified Startup & Hot-Plug 1-to-1 Input Auto-Slotting
  const hardware = useHardwareManager({
    activeDevice: session.activeDevice,
    platform: session.platform,
    devices: session.devices,
    onRegisterDevices: handleRegisterDevices,
    onSelectDevice: handleSelectDevice,
    logAudit,
    hydrated: session.hydrated,
    onSyncLiveInputsToChannels: handleReconcileLiveInputs,
  });

  const handleSendWsTelemetry = useCallback(
    (tel: Parameters<NonNullable<Parameters<typeof useAudioEngine>[0]['onSendWsTelemetry']>>[0]) => {
      const ws = desktopWsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'telemetry:frame', telemetry: tel }));
      }
    },
    [desktopWsRef]
  );

  const handleAddAutoFinding = useCallback(
    (finding: Parameters<NonNullable<Parameters<typeof useAudioEngine>[0]['onAddFinding']>>[0]) => {
      setFindings((prev) => [finding, ...prev]);
    },
    [setFindings]
  );

  const handlePrepareBridgeStrip = useCallback(
    (mode: 'live-mic' | 'desktop-audio' | 'pink-noise') => {
      if (mode !== 'desktop-audio' && mode !== 'pink-noise') return;
      setChannels((prev) => {
        const ch0 = prev[0];
        if (!ch0 || ch0.hardwareInputId || ch0.faderDb > -47.5) return prev;
        return prev.map((c, idx) =>
          idx === 0 ? { ...c, faderDb: 0, gainDb: 24, mute: false } : c
        );
      });
    },
    [setChannels]
  );

  const handleInputsUnlocked = useCallback(() => {
    void hardware.refreshAudioDevices(false, 'slot-new');
  }, [hardware.refreshAudioDevices]);

  // 3. Live Web Audio DSP Engine Runtime
  const audio = useAudioEngine({
    dsp: session.dsp,
    channels: session.channels,
    zones: session.zones,
    activeDevice: session.activeDevice,
    bufferSize: session.bufferSize,
    sampleRate: session.sampleRate,
    plugins: session.plugins,
    needsSpectrumState: activeModule === 'feedback' || activeModule === 'virtual-di',
    onSendWsTelemetry: handleSendWsTelemetry,
    logAudit,
    onAddFinding: handleAddAutoFinding,
    onPrepareBridgeStrip: handlePrepareBridgeStrip,
    onInputsUnlocked: handleInputsUnlocked,
  });

  const desktopLoopbackMonitorActive = useMemo(
    () =>
      audio.engineRunning &&
      audio.monitorAudible &&
      (audio.audioSource === 'desktop-audio' ||
        session.channels.some((channel) => isNativeDesktopInputId(channel.hardwareInputId) && !channel.mute)),
    [audio.engineRunning, audio.monitorAudible, audio.audioSource, session.channels]
  );

  useEffect(() => {
    if (!isDesktopApp()) {
      liveAudioEngine.setTauriSourceIsolationActive(false);
      return;
    }
    if (!desktopLoopbackMonitorActive) {
      liveAudioEngine.setTauriSourceIsolationActive(false);
    }
    let cancelled = false;
    void syncDesktopSourceIsolation(desktopLoopbackMonitorActive)
      .then((status) => {
        if (cancelled) return;
        if (status) {
          setDesktopSourceIsolationStatus(status);
          liveAudioEngine.setTauriSourceIsolationActive(
            Boolean(desktopLoopbackMonitorActive && status.enabled && status.skippedSessions === 0)
          );
        } else {
          liveAudioEngine.setTauriSourceIsolationActive(false);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          liveAudioEngine.setTauriSourceIsolationActive(false);
          setDesktopSourceIsolationStatus({
            enabled: false,
            mutedSessions: 0,
            skippedSessions: 1,
            message: String(error),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [desktopLoopbackMonitorActive, syncDesktopSourceIsolation]);

  // 4. Web MIDI Controller Hardware Integration
  const midi = useMidiManager({
    onUpdateDsp: session.setDsp,
    onUpdateChannels: setChannels,
    onUpdateEmergencyMute: session.setEmergencyMuted,
    logAudit,
  });
  midiRef.current = midi;

  const handleMuteBandShortcut = useCallback(() => {
    handleBatchMute('band', true);
  }, [handleBatchMute]);

  const handleSaveSnapshotShortcut = useCallback(
    (label: string) => {
      handleSaveVersion(label);
    },
    [handleSaveVersion]
  );

  const handleNavigateModuleShortcut = useCallback((mod: string) => {
    setActiveModule(mod as ModuleId);
  }, []);

  // 5. Global Keyboard Shortcuts & Tap Tempo Manager
  const shortcuts = useKeyboardShortcutsManager({
    onToggleEmergencyMute: handleToggleEmergencyMute,
    onToggleTotalBypass: handleToggleTotalBypass,
    onUndoLastDsp: handleUndoLastDsp,
    onToggleEngine: audio.handleToggleEngine,
    onToggleMonitor: audio.handleToggleMonitor,
    onMuteBand: handleMuteBandShortcut,
    onClearSolos: handleClearAllSolos,
    onSaveSnapshot: handleSaveSnapshotShortcut,
    onNavigateModule: handleNavigateModuleShortcut,
  });
  shortcutsRef.current = shortcuts;

  const handleExitRemoteCompanion = () => {
    setRemoteCompanionToken(null);
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has('mode') || url.searchParams.has('token')) {
        url.searchParams.delete('mode');
        url.searchParams.delete('token');
        window.history.replaceState({}, '', url.toString());
      }
    } catch {
      // ignore URL mutation errors
    }
  };

  const handleApproveFinding = (id: string) => {
    const target = session.findings.find((f) => f.id === id);
    if (!target || !target.proposedPatch) return;
    const patch = target.proposedPatch;

    const nextDsp = { ...session.dsp, bypassed: false };
    if (typeof patch.hpfEnabled === 'boolean') nextDsp.hpfEnabled = patch.hpfEnabled;
    if (typeof patch.hpfHz === 'number') nextDsp.hpfHz = patch.hpfHz;
    if (patch.eqBandUpdate) {
      const idx = patch.eqBandUpdate.index ?? 1;
      nextDsp.eqBands = nextDsp.eqBands.map((b, i) =>
        i === idx ? { ...b, ...patch.eqBandUpdate, enabled: true } : b
      );
    }

    session.handleUpdateDsp(nextDsp);
    session.setFindings((prev) =>
      prev.map((f) =>
        f.id === id
          ? {
              ...f,
              status: 'verified',
              afterSnapshot: audio.telemetry.isRunning
                ? { rmsDb: audio.telemetry.postRmsDb, peakDb: audio.telemetry.postPeakDb }
                : undefined,
            }
          : f
      )
    );
    session.logAudit('Approved AI DSP Patch', `${target.title} → ${patch.description}`, 'ai-approved');
  };

  const pendingFindingsCount = session.findings.filter((f) => f.status === 'pending').length;

  const selectedChannel = useMemo(
    () => session.channels.find((c) => c.id === selectedChannelId) ?? session.channels[0],
    [selectedChannelId, session.channels]
  );

  const guardedUpdateChannel = useCallback(
    (id: string, patch: Parameters<typeof handleUpdateChannel>[1]) => {
      if (consoleLocked) return;
      handleUpdateChannel(id, patch);
    },
    [consoleLocked, handleUpdateChannel]
  );

  const guardedUpdateDsp = useCallback(
    (patch: Parameters<typeof handleUpdateDsp>[0]) => {
      if (consoleLocked) return;
      handleUpdateDsp(patch);
    },
    [consoleLocked, handleUpdateDsp]
  );

  const guardedSelectPreset = useCallback(
    (preset: Parameters<typeof handleSelectPreset>[0]) => {
      if (consoleLocked) return;
      handleSelectPreset(preset);
    },
    [consoleLocked, handleSelectPreset]
  );

  const guardedAddChannel = useCallback(
    (name?: string, role?: string) => {
      if (consoleLocked) return;
      handleAddChannel(name, role);
    },
    [consoleLocked, handleAddChannel]
  );

  const guardedAddEqBand = useCallback(() => {
    if (consoleLocked) return;
    handleAddEqBand();
  }, [consoleLocked, handleAddEqBand]);

  const handleResetAll = useCallback(() => {
    if (consoleLocked) return;
    handleResetDsp();
    handleClearAllSolos();
  }, [consoleLocked, handleResetDsp, handleClearAllSolos]);

  const handleUpdateObs = useCallback(
    (patch: Partial<typeof session.obsStatus>) => {
      setObsStatus((prev) => ({ ...prev, ...patch }));
    },
    [setObsStatus]
  );

  const dspValidation = useMemo(
    () => validateDspConfig(session.dsp, session.sampleRate, session.zones),
    [session.dsp, session.sampleRate, session.zones]
  );
  const consoleHasWarning =
    !dspValidation.valid ||
    dspValidation.warnings.length > 0 ||
    audio.telemetry.feedbackRisk.detected ||
    audio.telemetry.humRisk.detected ||
    pendingFindingsCount > 0 ||
    audio.schedulingRisk !== 'low';
  const consoleIsLimiting =
    Boolean(audio.telemetry.qualityGateEngaged) ||
    (audio.engineRunning && audio.telemetry.postPeakDb >= session.dsp.limiter.ceilingDb - 0.8);
  const consoleHasSignal = audio.engineRunning && audio.telemetry.postRmsDb > -56;

  useEffect(() => {
    if (activeModule === 'hardware' && isDesktopApp()) {
      void hardware.refreshDesktopAudioInfo();
    }
  }, [activeModule, hardware.refreshDesktopAudioInfo]);

  const activeOutputLabel = useMemo(() => {
    const matched =
      hardware.outputDevices.find((d) => d.deviceId === hardware.preferredOutputDeviceId) ??
      hardware.outputDevices[0];
    return matched?.label || 'System Default Speakers';
  }, [hardware.outputDevices, hardware.preferredOutputDeviceId]);

  const outputIsHeadphonesOrVirtual =
    /headphone|earphone|airpods|buds|bluetooth|cable|virtual|voicemeeter/i.test(activeOutputLabel);

  const openPhysicalMicChannels = useMemo(
    () =>
      session.channels.filter(
        (ch) =>
          Boolean(ch.hardwareInputId) &&
          !isNativeDesktopInputId(ch.hardwareInputId) &&
          !isVirtualCableInputLabel(ch.hardwareInputLabel || ch.name) &&
          !ch.mute &&
          ch.faderDb > -47.5
      ),
    [session.channels]
  );

  const showAcousticLoopbackWarning =
    audio.engineRunning &&
    audio.monitorAudible &&
    !session.emergencyMuted &&
    !hardware.singleSpeakerMode &&
    !outputIsHeadphonesOrVirtual &&
    openPhysicalMicChannels.length > 0;

  const handleMuteAllPhysicalMics = useCallback(() => {
    if (consoleLocked) return;
    setChannels((prev) =>
      prev.map((c) =>
        c.hardwareInputId &&
        !isNativeDesktopInputId(c.hardwareInputId) &&
        !isVirtualCableInputLabel(c.hardwareInputLabel || c.name)
          ? { ...c, mute: true }
          : c
      )
    );
    logAudit(
      'Muted Built-In / Physical Mics',
      'Muted physical microphone channels via Acoustic Loopback Guard to stop speaker feedback while keeping VB-Cable active.',
      'operator'
    );
  }, [consoleLocked, logAudit, setChannels]);

  const {
    outputDevices,
    preferredOutputDeviceId,
    handleSelectOutputDevice,
  } = hardware;

  const {
    setMonitorAudibleState,
    ensureEngineStarted,
  } = audio;

  const secondaryMonitorCandidate = useMemo(() => {
    const nonDefaultOutputs = outputDevices.filter(
      (d) =>
        d.deviceId &&
        d.deviceId !== 'default' &&
        d.deviceId !== 'communications' &&
        d.deviceId !== preferredOutputDeviceId
    );
    return (
      nonDefaultOutputs.find((d) => /headphone|usb|interface|focusrite|scarlett|behringer|motu|rme/i.test(d.label || '')) ??
      nonDefaultOutputs.find((d) => !/cable|virtual|voicemeeter|obs/i.test(d.label || '')) ??
      null
    );
  }, [outputDevices, preferredOutputDeviceId]);

  const handleRouteMonitorToSecondaryOutput = useCallback(async () => {
    if (consoleLocked || !secondaryMonitorCandidate?.deviceId) return;
    const ok = await handleSelectOutputDevice(secondaryMonitorCandidate.deviceId);
    if (!ok) return;
    setMonitorAudibleState(true);
    logAudit(
      'Routed MON to Secondary Output',
      `Isolated Desktop Audio monitor bus onto ${secondaryMonitorCandidate.label || 'Secondary Audio Output'} to break loopback.`,
      'operator'
    );
  }, [consoleLocked, handleSelectOutputDevice, logAudit, secondaryMonitorCandidate, setMonitorAudibleState]);

  const handleBrowserDspToSpeakers = useCallback(async () => {
    if (consoleLocked) return;

    // 1. Scan all available physical & virtual (VB-Cable) inputs + outputs
    const scanned = await hardware.refreshAudioDevices(true, 'slot-new');
    const allInputs = scanned.inputs.length > 0 ? scanned.inputs : hardware.inputDevices;
    const allOutputs = scanned.outputs.length > 0 ? scanned.outputs : outputDevices;

    // 2. Ensure Master PA output points to a physical speaker / headphone (NOT CABLE Input)
    const physicalSpeaker =
      allOutputs.find((d) => !/cable|virtual|voicemeeter|obs/i.test(d.label || '')) ??
      allOutputs[0];
    if (physicalSpeaker?.deviceId) {
      await handleSelectOutputDevice(physicalSpeaker.deviceId);
    }

    // 3. Find VB-Audio Virtual Cable (CABLE Output) or any virtual audio cable input
    const vbCableInput =
      allInputs.find((d) => /\b(cable\s*output|vb-?audio|virtual\s*cable|hi-?fi\s*cable)\b/i.test(d.label || '')) ??
      allInputs.find((d) => isVirtualCableInputLabel(d.label));

    if (!vbCableInput) {
      logAudit(
        'VB-Audio Virtual Cable Not Found',
        'Install VB-Audio Virtual Cable (CABLE Output / CABLE Input), then click Re-Scan so HKM imports CABLE Output as an input channel.',
        'operator'
      );
      if (isDesktopApp()) {
        void openWindowsSoundSettings('apps-volume');
      }
      return;
    }

    const vbLabel = vbCableInput.label || 'CABLE Output (VB-Audio Virtual Cable)';
    let hasVbChannel = false;
    let nextChannels = session.channels.map((ch) => {
      if (!ch.hardwareInputId) return ch;
      if (
        ch.hardwareInputId === vbCableInput.deviceId ||
        isVirtualCableInputLabel(ch.hardwareInputLabel || ch.name)
      ) {
        hasVbChannel = true;
        const derived = deriveAutoChannelNameAndRole(vbLabel, ch.index);
        return {
          ...ch,
          hardwareInputId: vbCableInput.deviceId,
          hardwareInputLabel: vbLabel,
          name: derived.name,
          role: derived.role,
          mute: false,
          faderDb: ch.faderDb <= -40 ? 0 : ch.faderDb,
          gainDb: ch.gainDb === 0 ? 24 : ch.gainDb,
        };
      }
      // Mute open built-in/physical laptop mics so built-in speakers don't squeal
      return { ...ch, mute: true };
    });

    if (!hasVbChannel) {
      const openIdx = nextChannels.findIndex((c) => !c.hardwareInputId);
      const targetIdx = openIdx >= 0 ? openIdx : 0;
      if (nextChannels[targetIdx]) {
        const derived = deriveAutoChannelNameAndRole(vbLabel, nextChannels[targetIdx].index);
        nextChannels = nextChannels.map((c, idx) =>
          idx === targetIdx
            ? {
                ...c,
                hardwareInputId: vbCableInput.deviceId,
                hardwareInputLabel: vbLabel,
                name: derived.name,
                role: derived.role,
                mute: false,
                faderDb: c.faderDb <= -40 ? 0 : c.faderDb,
                gainDb: 24,
              }
            : c
        );
      }
    }

    const vbCh = nextChannels.find(
      (c) =>
        c.hardwareInputId === vbCableInput.deviceId ||
        isVirtualCableInputLabel(c.hardwareInputLabel || c.name)
    );
    if (vbCh) {
      setSelectedChannelId(vbCh.id);
    }

    // 4. Use standard Live Console Inputs ('live-mic') pipeline where all physical & virtual channels run through DSP
    if (audio.audioSource !== 'live-mic') {
      audio.setAudioSource('live-mic');
    }
    setChannels(nextChannels);
    const started = await ensureEngineStarted(nextChannels);
    if (!started) return;

    setMonitorAudibleState(true);
    logAudit(
      'Configured VB-Cable Desktop Audio Channel',
      `Imported "${vbLabel}" onto CH${vbCh?.index ?? 1}, muted physical mics, and routed processed DSP output to ${physicalSpeaker?.label || 'Physical Speakers'}.`,
      'operator'
    );
  }, [
    audio,
    consoleLocked,
    ensureEngineStarted,
    handleSelectOutputDevice,
    hardware,
    logAudit,
    outputDevices,
    session.channels,
    setChannels,
    setMonitorAudibleState,
  ]);

  if (remoteCompanionToken) {
    return (
      <RemoteCompanionView
        token={remoteCompanionToken}
        onExitRemote={handleExitRemoteCompanion}
      />
    );
  }

  return (
    <div className="h-screen flex flex-col hw-chassis text-slate-100 overflow-hidden">
      <AppMenuBar
        appVersion={appVersion}
        isDesktop={isDesktopApp()}
        engineRunning={audio.engineRunning}
        monitorAudible={audio.monitorAudible}
        totalBypassed={session.dsp.bypassed}
        emergencyMuted={session.emergencyMuted}
        canUndo={session.undoStack.length > 0}
        navDockPosition={session.navDockPosition}
        updateState={updateCheckState}
        onNavigateModule={setActiveModule}
        onChangeDockPosition={session.setNavDockPosition}
        onSaveSnapshot={() => session.handleSaveVersion('Manual Menu Snapshot')}
        onUndoLastDsp={session.handleUndoLastDsp}
        onResetEqFlat={() =>
          guardedUpdateDsp({
            eqBands: session.dsp.eqBands.map((b) => ({ ...b, gainDb: 0 })),
          })
        }
        onClearAllSolos={session.handleClearAllSolos}
        onOpenShortcuts={() => shortcuts.setShowShortcutsModal(true)}
        onToggleEngine={audio.handleToggleEngine}
        onToggleMonitor={audio.handleToggleMonitor}
        onToggleTotalBypass={session.handleToggleTotalBypass}
        onToggleEmergencyMute={session.handleToggleEmergencyMute}
        onCheckForUpdates={() => void runUpdateCheck(true)}
        onOpenUpdateModal={() => setShowUpdateModal(true)}
        onOpenAbout={() => setShowAboutModal(true)}
        onOpenGlobalSearch={() => setShowGlobalSearch(true)}
        onOpenGainStaging={() => setShowGainStaging(true)}
        onOpenSignalJourney={() => setSignalJourneyChannelId(selectedChannel?.id ?? 'ch-1')}
      />
      <TopBar
        venueName={session.venueName}
        roomName={session.roomName}
        activeDevice={session.activeDevice}
        platform={session.platform}
        driver={session.driver}
        sampleRate={session.sampleRate}
        bufferSize={session.bufferSize}
        activePreset={session.activePreset}
        presets={session.presets}
        onSelectPreset={guardedSelectPreset}
        consoleLocked={consoleLocked}
        onToggleLock={() => setConsoleLocked((v) => !v)}
        engineRunning={audio.engineRunning}
        onToggleEngine={audio.handleToggleEngine}
        monitorAudible={audio.monitorAudible}
        onToggleMonitor={audio.handleToggleMonitor}
        emergencyMuted={session.emergencyMuted}
        onToggleEmergencyMute={session.handleToggleEmergencyMute}
        totalBypassed={session.dsp.bypassed}
        onToggleTotalBypass={session.handleToggleTotalBypass}
        consoleTheme={session.consoleTheme}
        onThemeChange={session.setConsoleTheme}
        audioSource={audio.audioSource}
        onSourceChange={audio.handleSourceChange}
        systemCpuPercent={audio.systemCpuPercent}
        schedulingRisk={audio.schedulingRisk}
        onOpenDiagnostics={() => setActiveModule('hardware')}
        tapTempo={shortcuts.tapTempo}
        onTapTempo={() => shortcuts.executeShortcutAction('tap-tempo', 'CLICK')}
        onOpenShortcuts={() => shortcuts.setShowShortcutsModal(true)}
        shortcutsArmed={shortcuts.shortcutsGlobalEnabled}
        inputDevices={hardware.inputDevices}
        outputDevices={hardware.outputDevices}
        activeOutputDeviceId={hardware.preferredOutputDeviceId}
        onSelectOutputDevice={hardware.handleSelectOutputDevice}
        dsp={session.dsp}
        onUpdateDsp={guardedUpdateDsp}
        agcGainDb={audio.telemetry.agcGainDb ?? 0}
        qualityScorePct={audio.telemetry.qualityScorePct ?? 100}
        qualityGateEngaged={audio.telemetry.qualityGateEngaged ?? false}
        qualityGateReason={audio.telemetry.qualityGateReason ?? null}
        activeSurgicalFilters={audio.telemetry.activeSurgicalFilters ?? []}
        onOpenGainStaging={() => setShowGainStaging(true)}
        onOpenSignalJourney={() => setSignalJourneyChannelId(selectedChannel?.id ?? 'ch-1')}
        desktopBridgeState={audio.desktopBridgeState}
        specializedDesktopInputs={hardware.specializedDesktopInputs}
        onSelectDesktopCaptureMethod={audio.setDesktopCaptureMethod}
        onSelectSpecializedDesktopDevice={audio.setSpecializedDesktopDevice}
      />

      {session.navDockPosition === 'top' && (
        <Sidebar
          activeModule={activeModule}
          onSelectModule={setActiveModule}
          telemetry={audio.telemetry}
          pendingFindingsCount={pendingFindingsCount}
          dockPosition={session.navDockPosition}
          onChangeDockPosition={session.setNavDockPosition}
        />
      )}

      {(session.emergencyMuted || session.dsp.bypassed) && (
        <div
          className={`shrink-0 px-4 py-1 border-b font-mono text-[11px] flex flex-wrap items-center justify-between gap-2 ${
            session.emergencyMuted
              ? 'bg-red-950/80 border-red-500/60 text-red-200'
              : 'bg-amber-950/70 border-amber-500/50 text-amber-200'
          }`}
        >
          <span className="font-semibold">
            {session.emergencyMuted && session.dsp.bypassed
              ? 'SAFETY OVERRIDE: GLOBAL EMERGENCY MUTE & TOTAL SIGNAL BYPASS BOTH ENGAGED'
              : session.emergencyMuted
                ? 'GLOBAL EMERGENCY MUTE ACTIVE — LIVE PA & MONITOR OUTPUTS SILENCED'
                : 'TOTAL SIGNAL BYPASS ACTIVE — DRY UNPROCESSED PASS-THROUGH (EQ/HPF/DYNAMICS BYPASSED)'}
          </span>
          <div className="flex items-center gap-2">
            {session.dsp.bypassed && (
              <button
                type="button"
                onClick={session.handleToggleTotalBypass}
                className="px-2 py-0.5 rounded border border-amber-400/60 bg-amber-500/20 text-amber-100 hover:bg-amber-500/35 text-[10px] font-semibold cursor-pointer"
              >
                RESTORE DSP
              </button>
            )}
            {session.emergencyMuted && (
              <button
                type="button"
                onClick={session.handleToggleEmergencyMute}
                className="px-2 py-0.5 rounded border border-red-400/60 bg-red-600 text-white hover:bg-red-500 text-[10px] font-semibold cursor-pointer"
              >
                UNMUTE PA
              </button>
            )}
          </div>
        </div>
      )}

      {hardware.hotPlugEndpoint && (
        <div className="shrink-0 px-4 py-1 border-b border-teal-500/50 bg-[#0D2126] text-teal-100 font-mono text-[11px] flex flex-wrap items-center justify-between gap-2">
          <span>
            NEW AUDIO HARDWARE DETECTED: <strong>{hardware.hotPlugEndpoint.name}</strong> → Auto-matched{' '}
            <strong>{hardware.hotPlugEndpoint.matchedLabel}</strong> ({hardware.hotPlugEndpoint.recommendedDriver} ·{' '}
            {hardware.hotPlugEndpoint.estimatedInputChannels}×{hardware.hotPlugEndpoint.estimatedOutputChannels})
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void hardware.handleBindDetectedEndpoint(hardware.hotPlugEndpoint!)}
              className="px-2.5 py-0.5 rounded bg-teal-500 hover:bg-teal-400 text-slate-950 font-semibold text-[10px] cursor-pointer"
            >
              AUTO-BIND &amp; RECALL
            </button>
            <button
              type="button"
              onClick={hardware.dismissHotPlug}
              className="px-2 py-0.5 rounded border border-teal-400/40 text-teal-200 hover:bg-teal-500/20 text-[10px] cursor-pointer"
            >
              DISMISS
            </button>
          </div>
        </div>
      )}

      {/* =========================================================================
          FIXED 3-COLUMN HARDWARE CONSOLE WORKBENCH (LEFT I/O | CENTER MODULE | RIGHT TELEMETRY)
          ========================================================================= */}
      {showAcousticLoopbackWarning && (
        <div className="shrink-0 px-4 py-1 border-b border-amber-500/60 bg-amber-950/75 text-amber-100 font-mono text-[11px] flex flex-wrap items-center justify-between gap-2">
          <span>
            ACOUSTIC LOOPBACK RISK: Mic channel(s) [
            <strong>{openPhysicalMicChannels.map((c) => `CH${c.index}`).join(', ')}</strong>] are
            open while <strong>{activeOutputLabel}</strong> (MON) is live — mute laptop mic to
            stop feedback.
          </span>
          <button
            type="button"
            disabled={consoleLocked}
            onClick={handleMuteAllPhysicalMics}
            className="px-2.5 py-0.5 rounded border border-amber-300/70 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-[10px] cursor-pointer disabled:opacity-45"
          >
            MUTE MIC (STOP LOOPBACK)
          </button>
        </div>
      )}
      {audio.engineRunning && audio.desktopBridgeState.selfLoopbackBlocked && (
        <div className="shrink-0 px-4 py-1 border-b font-mono text-[11px] flex flex-wrap items-center justify-between gap-2 bg-amber-950/80 border-amber-500/60 text-amber-100">
          <span>
            {`SELF-LOOPBACK FIREWALL: ${audio.desktopBridgeState.safetyReason}`}
          </span>
          <div className="flex items-center gap-2">
            {secondaryMonitorCandidate && (
              <button
                type="button"
                disabled={consoleLocked}
                onClick={() => void handleRouteMonitorToSecondaryOutput()}
                className="px-2.5 py-0.5 rounded border border-teal-300/60 bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-[10px] cursor-pointer disabled:opacity-45"
              >
                ROUTE MON TO {secondaryMonitorCandidate.label?.slice(0, 22) || 'SPEAKERS'}
              </button>
            )}
          </div>
        </div>
      )}
      <div className="flex-1 min-h-0 flex flex-row overflow-hidden">
        {session.navDockPosition === 'left' && (
          <Sidebar
            activeModule={activeModule}
            onSelectModule={setActiveModule}
            telemetry={audio.telemetry}
            pendingFindingsCount={pendingFindingsCount}
            dockPosition={session.navDockPosition}
            onChangeDockPosition={session.setNavDockPosition}
          />
        )}

        <div className="flex-1 min-w-0 min-h-0 flex flex-row gap-1.5 p-1.5 overflow-hidden">
          {/* FIXED LEFT PANEL: LIVE INPUTS & OUTPUTS */}
          <ConsoleLeftPanel
            inputDevices={hardware.inputDevices}
            outputDevices={hardware.outputDevices}
            channels={session.channels}
            selectedChannelId={selectedChannel?.id ?? 'ch-1'}
            preferredOutputDeviceId={hardware.preferredOutputDeviceId}
            preferredStreamOutputDeviceId={hardware.preferredStreamOutputDeviceId}
            zones={session.zones}
            telemetry={audio.telemetry}
            engineRunning={audio.engineRunning}
            locked={consoleLocked}
            desktopAudioStatus={hardware.desktopAudioStatus}
            desktopAudioSessions={hardware.desktopAudioSessions}
            singleSpeakerMode={hardware.singleSpeakerMode}
            onEnableBrowserDspSpeakers={() => void handleBrowserDspToSpeakers()}
            onSelectChannel={setSelectedChannelId}
            onUpdateChannel={guardedUpdateChannel}
            onAddChannel={guardedAddChannel}
            onSelectOutputDevice={(devId) => {
              if (!consoleLocked) void hardware.handleSelectOutputDevice(devId);
            }}
            onSelectStreamOutputDevice={(devId) => {
              if (!consoleLocked) void hardware.handleSelectStreamOutputDevice(devId);
            }}
            onScanAudioDevices={hardware.refreshAudioDevices}
            audioSource={audio.audioSource}
            desktopBridgeState={audio.desktopBridgeState}
            specializedDesktopInputs={hardware.specializedDesktopInputs}
            onActivateSystemAudioBridge={() => void handleBrowserDspToSpeakers()}
          />

          {/* CENTER PANEL: ALL 16 MODULES DELIVER THEIR CONTENT HERE */}
          <main className="flex-1 min-w-0 min-h-0 overflow-hidden flex flex-col">
            {[audio.audioError, hardware.outputRouteError]
              .filter((message): message is string => Boolean(message))
              .map((message) => (
                <div
                  key={message}
                  className="mb-1.5 p-2.5 rounded-md border border-red-500/45 bg-red-500/10 text-xs text-red-300 shrink-0"
                >
                  {message}
                </div>
              ))}

            {activeModule === 'dsp' && selectedChannel ? (
              <CentralDspChainView
                dsp={session.dsp}
                onUpdateDsp={guardedUpdateDsp}
                selectedChannel={selectedChannel}
                onUpdateChannel={guardedUpdateChannel}
                device={session.activeDevice}
                platform={session.platform}
                driver={session.driver}
                sampleRate={session.sampleRate}
                bufferSize={session.bufferSize}
                zones={session.zones}
                telemetry={audio.telemetry}
                engineRunning={audio.engineRunning}
                monitorAudible={audio.monitorAudible}
                onToggleMonitor={audio.handleToggleMonitor}
                emergencyMuted={session.emergencyMuted}
                locked={consoleLocked}
                audioSource={audio.audioSource}
                onAddEqBand={guardedAddEqBand}
              />
            ) : activeModule === 'console' ? (
              <ConsoleInstrumentDeck
                device={session.activeDevice}
                channels={session.channels}
                onUpdateChannel={guardedUpdateChannel}
                dsp={session.dsp}
                onUpdateDsp={guardedUpdateDsp}
                telemetry={audio.telemetry}
                presets={session.presets}
                activePreset={session.activePreset}
                onSelectPreset={guardedSelectPreset}
                emergencyMuted={session.emergencyMuted}
                onToggleEmergencyMute={session.handleToggleEmergencyMute}
                zones={session.zones}
                initialPhase="phase-1-stage"
                selectedChannelId={selectedChannel?.id ?? 'ch-1'}
                onSelectChannel={setSelectedChannelId}
                locked={consoleLocked}
                audioSource={audio.audioSource}
                onAddChannel={guardedAddChannel}
                onAddEqBand={guardedAddEqBand}
                onRemoveEqBand={session.handleRemoveEqBand}
              />
            ) : (
              <div className="flex-1 min-h-0 overflow-y-auto hw-panel rounded-lg p-3.5">
                {activeModule === 'feedback' ? (
                  <FeedbackAnalyzerModule
                    telemetry={audio.telemetry}
                    spectrum={audio.spectrum}
                    dsp={session.dsp}
                    onUpdateDsp={guardedUpdateDsp}
                    onLogVerification={(summary) =>
                      session.logAudit('Verified DSP Correction', summary, 'operator')
                    }
                  />
                ) : activeModule === 'acoustics' ? (
                  <AcousticAnalyzerModule
                    measurement={session.measurement}
                    onUpdateMeasurement={session.setMeasurement}
                    onExportRoomModeCut={(freqHz) => {
                      guardedUpdateDsp({
                        bypassed: false,
                        eqBands: session.dsp.eqBands.map((b, idx) =>
                          idx === 0
                            ? { ...b, label: 'Room Mode Cut', enabled: true, frequency: freqHz, gainDb: -3.5, q: 4.5 }
                            : b
                        ),
                      });
                      session.logAudit('Exported Room Mode Cut', `Applied -3.5 dB modal cut @ ${freqHz} Hz from REW Analyzer`, 'operator');
                    }}
                  />
                ) : activeModule === 'speakers' ? (
                  <SpeakerZonesModule
                    zones={session.zones}
                    onUpdateZone={(id, patch) => {
                      if (!consoleLocked) session.handleUpdateZone(id, patch);
                    }}
                    onAddZone={session.handleAddZone}
                    onRemoveZone={session.handleRemoveZone}
                    outputDevices={hardware.outputDevices}
                    onScanAudioDevices={hardware.refreshAudioDevices}
                    telemetry={audio.telemetry}
                    emergencyMuted={session.emergencyMuted}
                    onToggleEmergencyMute={session.handleToggleEmergencyMute}
                  />
                ) : activeModule === 'microphones' ? (
                  <MicrophoneIntelligenceModule
                    device={session.activeDevice}
                    dsp={session.dsp}
                    onUpdateDsp={guardedUpdateDsp}
                    channels={session.channels}
                    onUpdateChannel={guardedUpdateChannel}
                    telemetry={audio.telemetry}
                    onLogAction={(detail) => session.logAudit('Microphone Intelligence', detail, 'operator')}
                  />
                ) : activeModule === 'instruments' ? (
                  <InstrumentIntelligenceModule
                    device={session.activeDevice}
                    dsp={session.dsp}
                    onUpdateDsp={guardedUpdateDsp}
                    channels={session.channels}
                    onUpdateChannel={guardedUpdateChannel}
                    telemetry={audio.telemetry}
                    onLogAction={(detail) => session.logAudit('Instrument & Music Intelligence', detail, 'operator')}
                  />
                ) : activeModule === 'livestream' ? (
                  <LivestreamObsModule
                    broadcastDsp={session.broadcastDsp}
                    onUpdateBroadcastDsp={(patch) => {
                      if (!consoleLocked) session.setBroadcastDsp((prev) => ({ ...prev, ...patch }));
                    }}
                    obsStatus={session.obsStatus}
                    onUpdateObs={handleUpdateObs}
                    telemetry={audio.telemetry}
                    device={session.activeDevice}
                    processedOutputActive={audio.engineRunning && audio.monitorAudible && !session.emergencyMuted}
                    onEnableProcessedOutput={() => void handleBrowserDspToSpeakers()}
                  />
                ) : activeModule === 'soundcheck' ? (
                  <AutomatedSoundCheckModule
                    device={session.activeDevice}
                    channels={session.channels}
                    onUpdateChannel={guardedUpdateChannel}
                    dsp={session.dsp}
                    onUpdateDsp={guardedUpdateDsp}
                    broadcastDsp={session.broadcastDsp}
                    telemetry={audio.telemetry}
                    obsStatus={session.obsStatus}
                    measurement={session.measurement}
                    onStartEngine={audio.handleToggleEngine}
                    onLogAction={(detail) => session.logAudit('Automated Sound Check', detail, 'operator')}
                  />
                ) : activeModule === 'presets' ? (
                  <PresetsServiceModule
                    device={session.activeDevice}
                    dsp={session.dsp}
                    obsStatus={session.obsStatus}
                    onUpdateObs={handleUpdateObs}
                    presets={session.presets}
                    activePreset={session.activePreset}
                    onSelectPreset={guardedSelectPreset}
                    versions={session.versions}
                    onSaveVersion={session.handleSaveVersion}
                    onRollbackVersion={session.handleRollbackVersion}
                    onImportPresetJson={(imported) => {
                      session.setPresets((prev) => [imported, ...prev]);
                      guardedSelectPreset(imported);
                    }}
                  />
                ) : activeModule === 'virtual-di' ? (
                  <VirtualDiBassModule
                    device={session.activeDevice}
                    bassDi={session.bassDi}
                    onUpdateBassDi={(patch) => {
                      if (!consoleLocked) session.setBassDi((prev) => ({ ...prev, ...patch }));
                    }}
                    dsp={session.dsp}
                    onUpdateDsp={guardedUpdateDsp}
                    telemetry={audio.telemetry}
                    spectrum={audio.spectrum}
                    onLogAction={(detail) => session.logAudit('Virtual DI & Bass Processor', detail, 'operator')}
                  />
                ) : activeModule === 'ai-engineer' ? (
                  <AiEngineerModule
                    device={session.activeDevice}
                    platform={session.platform}
                    driver={session.driver}
                    dsp={session.dsp}
                    telemetry={audio.telemetry}
                    findings={session.findings}
                    onAddFinding={(f) => session.setFindings((prev) => [f, ...prev])}
                    onApproveFinding={handleApproveFinding}
                    onDismissFinding={(id) =>
                      session.setFindings((prev) =>
                        prev.map((f) => (f.id === id ? { ...f, status: 'dismissed' } : f))
                      )
                    }
                  />
                ) : activeModule === 'midi' ? (
                  <MidiMappingModule
                    platform={session.platform}
                    midiDevices={midi.midiDevices}
                    midiConnected={midi.midiConnected}
                    midiError={midi.midiError}
                    onRequestMidiAccess={midi.handleRequestMidiAccess}
                    mappings={midi.midiMappings}
                    onUpdateMappings={midi.updateAndPersistMidiMappings}
                    learningId={midi.midiLearningId}
                    onSetLearningId={midi.setMidiLearningId}
                    lastPacket={midi.lastMidiPacket}
                    dsp={session.dsp}
                    emergencyMuted={session.emergencyMuted}
                    shortcuts={shortcuts.keyboardShortcuts}
                    onUpdateShortcuts={shortcuts.updateAndPersistShortcuts}
                    shortcutsGlobalEnabled={shortcuts.shortcutsGlobalEnabled}
                    onToggleShortcutsGlobalEnabled={() => shortcuts.setShortcutsGlobalEnabled((v) => !v)}
                    capturingShortcutId={shortcuts.capturingShortcutId}
                    onSetCapturingShortcutId={shortcuts.setCapturingShortcutId}
                    onTriggerShortcutAction={shortcuts.executeShortcutAction}
                    lastTriggeredShortcut={shortcuts.lastTriggeredShortcut}
                    shortcutConflictNotice={shortcuts.shortcutConflictNotice}
                    tapTempo={shortcuts.tapTempo}
                  />
                ) : activeModule === 'routing' ? (
                  <UniversalRoutingModule
                    channels={session.channels}
                    onUpdateChannel={guardedUpdateChannel}
                    onAddChannel={guardedAddChannel}
                    onRemoveChannel={session.handleRemoveChannel}
                    onAddZone={session.handleAddZone}
                    onUpdateZone={session.handleUpdateZone}
                    onRemoveZone={session.handleRemoveZone}
                    inputDevices={hardware.inputDevices}
                    outputDevices={hardware.outputDevices}
                    preferredOutputDeviceId={hardware.preferredOutputDeviceId}
                    preferredStreamOutputDeviceId={hardware.preferredStreamOutputDeviceId}
                    onSelectOutputDevice={hardware.handleSelectOutputDevice}
                    onSelectStreamOutputDevice={hardware.handleSelectStreamOutputDevice}
                    onScanAudioDevices={hardware.refreshAudioDevices}
                    zones={session.zones}
                    dsp={session.dsp}
                    onOpenSignalJourney={(chId) => setSignalJourneyChannelId(chId)}
                  />
                ) : activeModule === 'recorder' ? (
                  <MultitrackRecorderModule
                    channels={session.channels}
                    telemetry={audio.telemetry}
                    engineRunning={audio.engineRunning}
                  />
                ) : (
                  <HardwareDiagnosticsModule
                    devices={session.devices}
                    desktopBuild={isDesktopApp()}
                    activeDevice={session.activeDevice}
                    onSelectDevice={session.handleSelectDevice}
                    platform={session.platform}
                    onSelectPlatform={session.handleSelectPlatform}
                    driver={session.driver}
                    onSelectDriver={session.handleSelectDriver}
                    sampleRate={session.sampleRate}
                    onSelectSampleRate={session.handleSelectSampleRate}
                    bufferSize={session.bufferSize}
                    onSelectBufferSize={session.handleSelectBufferSize}
                    plugins={session.plugins}
                    onTogglePlugin={session.handleTogglePlugin}
                    onLoadCustomPlugin={session.handleLoadCustomPlugin}
                    onUnloadPlugin={session.handleUnloadPlugin}
                    telemetry={audio.telemetry}
                    systemCpuPercent={audio.systemCpuPercent}
                    auditEvents={session.auditEvents}
                    remoteAccess={session.remoteAccess}
                    remoteClients={session.remoteClients}
                    lanInterfaces={session.lanInterfaces}
                    onUpdateRemoteAccess={session.handleUpdateRemoteAccess}
                    onRotateRemoteToken={session.handleRotateRemoteToken}
                    onDisconnectRemoteClient={session.handleDisconnectRemoteClient}
                    onOpenRemoteCompanion={(tok) => setRemoteCompanionToken(tok)}
                    detectedEndpoints={hardware.detectedEndpoints}
                    scanningHardware={hardware.scanningHardware}
                    onScanHardware={(reqPerm) => void hardware.runHardwareScan(Boolean(reqPerm), false)}
                    onBindDetectedEndpoint={(ep) => void hardware.handleBindDetectedEndpoint(ep)}
                    onClearHardwareCache={() => void hardware.handleClearHardwareCache()}
                    audioSource={audio.audioSource}
                    onSelectAudioSource={audio.handleSourceChange}
                    engineRunning={audio.engineRunning}
                    onToggleEngine={audio.handleToggleEngine}
                    desktopAudioStatus={hardware.desktopAudioStatus}
                    desktopAudioSessions={hardware.desktopAudioSessions}
                    desktopSourceIsolationStatus={desktopSourceIsolationStatus}
                    apoStatus={hardware.apoStatus}
                    singleSpeakerMode={hardware.singleSpeakerMode}
                    apoBusy={hardware.apoBusy}
                    apoMessage={hardware.apoMessage}
                    onRefreshDesktopAudio={() => void hardware.refreshDesktopAudioInfo()}
                    onToggleSingleSpeakerMode={(en, epId) =>
                      void hardware.handleToggleSingleSpeakerMode(en, epId)
                    }
                    onInstallApo={(epId) => void hardware.handleInstallApo(epId)}
                    onUninstallApo={(epId) => void hardware.handleUninstallApo(epId)}
                    onEnableBrowserDspSpeakers={() => void handleBrowserDspToSpeakers()}
                    onOpenWindowsSoundMixer={() => void openWindowsSoundSettings('apps-volume')}
                    desktopBridgeState={audio.desktopBridgeState}
                    specializedDesktopInputs={hardware.specializedDesktopInputs}
                    onSelectDesktopCaptureMethod={audio.setDesktopCaptureMethod}
                    onSelectSpecializedDesktopDevice={audio.setSpecializedDesktopDevice}
                  />
                )}
              </div>
            )}
          </main>

          {/* FIXED RIGHT PANEL: SYSTEM TELEMETRY, PRESET RECALL & MASTER PREVIEW */}
          <ConsoleRightPanel
            dsp={session.dsp}
            onUpdateDsp={guardedUpdateDsp}
            telemetry={audio.telemetry}
            spectrum={audio.spectrum}
            systemCpuPercent={audio.systemCpuPercent}
            schedulingRisk={audio.schedulingRisk}
            bufferSize={session.bufferSize}
            sampleRate={session.sampleRate}
            driver={session.driver}
            platform={session.platform}
            appVersion={appVersion}
            engineRunning={audio.engineRunning}
            emergencyMuted={session.emergencyMuted}
            locked={consoleLocked}
            onToggleEmergencyMute={session.handleToggleEmergencyMute}
            onToggleTotalBypass={session.handleToggleTotalBypass}
            obsStatus={session.obsStatus}
            presets={session.presets}
            activePreset={session.activePreset}
            onSelectPreset={guardedSelectPreset}
            zones={session.zones}
            onNavigateModule={setActiveModule}
          />
        </div>

        {session.navDockPosition === 'right' && (
          <Sidebar
            activeModule={activeModule}
            onSelectModule={setActiveModule}
            telemetry={audio.telemetry}
            pendingFindingsCount={pendingFindingsCount}
            dockPosition={session.navDockPosition}
            onChangeDockPosition={session.setNavDockPosition}
          />
        )}
      </div>

      {session.navDockPosition === 'bottom' && (
        <Sidebar
          activeModule={activeModule}
          onSelectModule={setActiveModule}
          telemetry={audio.telemetry}
          pendingFindingsCount={pendingFindingsCount}
          dockPosition={session.navDockPosition}
          onChangeDockPosition={session.setNavDockPosition}
        />
      )}

      {/* FIXED BOTTOM HARDWARE CONTROL BAR */}
      <ConsoleBottomBar
        engineRunning={audio.engineRunning}
        dspBypassed={session.dsp.bypassed}
        onToggleTotalBypass={session.handleToggleTotalBypass}
        hasWarning={consoleHasWarning}
        consoleLocked={consoleLocked}
        onToggleLock={() => setConsoleLocked((v) => !v)}
        emergencyMuted={session.emergencyMuted}
        onToggleEmergencyMute={session.handleToggleEmergencyMute}
        onResetAll={handleResetAll}
        onOpenSystemInfo={() => setActiveModule('hardware')}
        isLimiting={consoleIsLimiting}
        hasSignal={consoleHasSignal}
      />

      {/* Global Keyboard Shortcut Manager Modal */}
      {shortcuts.showShortcutsModal && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Global Keyboard Shortcut Manager"
        >
          <div className="w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-xl border border-slate-700 bg-[#080B10] p-4 shadow-2xl">
            <KeyboardShortcutManager
              shortcuts={shortcuts.keyboardShortcuts}
              onUpdateShortcuts={shortcuts.updateAndPersistShortcuts}
              globalEnabled={shortcuts.shortcutsGlobalEnabled}
              onToggleGlobalEnabled={() => shortcuts.setShortcutsGlobalEnabled((v) => !v)}
              capturingId={shortcuts.capturingShortcutId}
              onSetCapturingId={shortcuts.setCapturingShortcutId}
              onTriggerAction={shortcuts.executeShortcutAction}
              lastTriggered={shortcuts.lastTriggeredShortcut}
              conflictNotice={shortcuts.shortcutConflictNotice}
              tapTempo={shortcuts.tapTempo}
              emergencyMuted={session.emergencyMuted}
              isModal
              onClose={() => shortcuts.setShowShortcutsModal(false)}
            />
          </div>
        </div>
      )}

      {/* In-App Desktop Auto-Update Notification Modal */}
      {showUpdateModal && availableUpdate && (
        <UpdateNotificationModal
          version={availableUpdate.version}
          notes={availableUpdate.notes}
          onInstall={availableUpdate.onInstall}
          onDismiss={() => setShowUpdateModal(false)}
        />
      )}

      {/* Pro Gain Staging Assistant Modal */}
      <GainStagingAssistantModal
        open={showGainStaging}
        onClose={() => setShowGainStaging(false)}
        channels={session.channels}
        device={session.activeDevice}
        onUpdateChannel={session.handleUpdateChannel}
        onSelectChannel={() => setActiveModule('console')}
      />

      {/* Global Command & Patch Search Modal (Ctrl+K) */}
      <GlobalSearchModal
        open={showGlobalSearch}
        onClose={() => setShowGlobalSearch(false)}
        channels={session.channels}
        zones={session.zones}
        onNavigateModule={setActiveModule}
        onOpenSignalJourney={(chId) => setSignalJourneyChannelId(chId)}
      />

      {/* End-to-End Signal Journey Trace Modal */}
      <SignalJourneyModal
        open={Boolean(signalJourneyChannelId)}
        onClose={() => setSignalJourneyChannelId(null)}
        channel={session.channels.find((c) => c.id === signalJourneyChannelId) ?? null}
        device={session.activeDevice}
        dsp={session.dsp}
        zones={session.zones}
        onNavigateModule={setActiveModule}
      />

      {/* About Church Audio Intelligence Dialog */}
      {showAboutModal && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="About Church Audio Intelligence"
          onClick={() => setShowAboutModal(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-sky-500/40 bg-[#0A0F18] p-5 shadow-2xl space-y-4 font-sans text-slate-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="font-display text-base font-bold text-white">
                  Church Audio Intelligence
                </h3>
                <p className="font-mono text-xs text-sky-400 font-semibold">
                  Version v{appVersion}
                </p>
              </div>
              <span className="px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-mono text-[10px] font-bold">
                {isDesktopApp() ? 'TAURI DESKTOP' : 'WEB CONSOLE'}
              </span>
            </div>

            <div className="space-y-2 text-xs text-slate-300 font-mono bg-[#06090F] p-3 rounded-lg border border-slate-800">
              <div className="flex justify-between">
                <span className="text-slate-500">DSP Engine:</span>
                <span>CamillaDSP v2.0 + WebAudio</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Hardware Device:</span>
                <span className="truncate max-w-[200px]">{session.activeDevice.model}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Update Endpoint:</span>
                <span>GitHub Releases (Signed)</span>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setShowAboutModal(false);
                  void runUpdateCheck(true);
                }}
                className="px-3 py-1.5 rounded-lg border border-sky-500/40 bg-sky-600/20 hover:bg-sky-600/35 text-sky-200 text-xs font-semibold cursor-pointer"
              >
                Check for Updates
              </button>
              <button
                type="button"
                onClick={() => setShowAboutModal(false)}
                className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Non-intrusive Keydown Trigger Feedback Toast */}
      {shortcuts.shortcutToast && !shortcuts.showShortcutsModal && (
        <div className="fixed bottom-4 right-4 z-40 pointer-events-none rounded-md border border-sky-400/50 bg-[#0D1119]/95 px-3 py-2 shadow-xl font-mono text-xs flex items-center gap-2.5">
          <span className="px-1.5 py-0.5 rounded-xs border border-sky-400/50 bg-sky-500/20 text-sky-300 font-bold">
            {shortcuts.shortcutToast.combo}
          </span>
          <span className="text-white font-semibold">{shortcuts.shortcutToast.label}</span>
        </div>
      )}
    </div>
  );
}
