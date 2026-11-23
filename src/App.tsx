import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ModuleId } from './types/audio.ts';
import { useConsoleSession } from './store/useConsoleSession.ts';
import { useAudioEngine } from './store/useAudioEngine.ts';
import { useHardwareManager } from './store/useHardwareManager.ts';
import { useMidiManager } from './store/useMidiManager.ts';
import { useKeyboardShortcutsManager } from './store/useKeyboardShortcutsManager.ts';
import { isDesktopApp } from './utils/appApi.ts';
import { checkDesktopUpdate } from './utils/appUpdater.ts';
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

  // 2. Physical Hardware Discovery + Unified Startup & Hot-Plug 1-to-1 Input Auto-Slotting
  const hardware = useHardwareManager({
    activeDevice: session.activeDevice,
    platform: session.platform,
    devices: session.devices,
    onRegisterDevices: session.handleRegisterDevices,
    onSelectDevice: session.handleSelectDevice,
    logAudit: session.logAudit,
    hydrated: session.hydrated,
    onSyncLiveInputsToChannels: session.handleReconcileLiveInputs,
  });

  // 3. Live Web Audio DSP Engine Runtime
  const audio = useAudioEngine({
    dsp: session.dsp,
    channels: session.channels,
    zones: session.zones,
    activeDevice: session.activeDevice,
    bufferSize: session.bufferSize,
    sampleRate: session.sampleRate,
    plugins: session.plugins,
    onSendWsTelemetry: (tel) => {
      const ws = session.desktopWsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'telemetry:frame', telemetry: tel }));
      }
    },
    logAudit: session.logAudit,
    onAddFinding: (finding) => session.setFindings((prev) => [finding, ...prev]),
  });

  // 4. Web MIDI Controller Hardware Integration
  const midi = useMidiManager({
    onUpdateDsp: session.setDsp,
    onUpdateChannels: session.setChannels,
    onUpdateEmergencyMute: session.setEmergencyMuted,
    logAudit: session.logAudit,
  });
  midiRef.current = midi;

  // 5. Global Keyboard Shortcuts & Tap Tempo Manager
  const shortcuts = useKeyboardShortcutsManager({
    onToggleEmergencyMute: session.handleToggleEmergencyMute,
    onToggleTotalBypass: session.handleToggleTotalBypass,
    onUndoLastDsp: session.handleUndoLastDsp,
    onToggleEngine: audio.handleToggleEngine,
    onToggleMonitor: audio.handleToggleMonitor,
    onMuteBand: () => session.handleBatchMute('band', true),
    onClearSolos: session.handleClearAllSolos,
    onSaveSnapshot: (label) => session.handleSaveVersion(label),
    onNavigateModule: (mod) => setActiveModule(mod as ModuleId),
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
    (id: string, patch: Parameters<typeof session.handleUpdateChannel>[1]) => {
      if (consoleLocked) return;
      session.handleUpdateChannel(id, patch);
    },
    [consoleLocked, session]
  );

  const guardedUpdateDsp = useCallback(
    (patch: Parameters<typeof session.handleUpdateDsp>[0]) => {
      if (consoleLocked) return;
      session.handleUpdateDsp(patch);
    },
    [consoleLocked, session]
  );

  const guardedSelectPreset = useCallback(
    (preset: Parameters<typeof session.handleSelectPreset>[0]) => {
      if (consoleLocked) return;
      session.handleSelectPreset(preset);
    },
    [consoleLocked, session]
  );

  const guardedAddChannel = useCallback(
    (name?: string, role?: string) => {
      if (consoleLocked) return;
      session.handleAddChannel(name, role);
    },
    [consoleLocked, session]
  );

  const guardedAddEqBand = useCallback(() => {
    if (consoleLocked) return;
    session.handleAddEqBand();
  }, [consoleLocked, session]);

  const handleResetAll = useCallback(() => {
    if (consoleLocked) return;
    session.handleResetDsp();
    session.handleClearAllSolos();
  }, [consoleLocked, session]);

  const handleUpdateObs = useCallback(
    (patch: Partial<typeof session.obsStatus>) => {
      session.setObsStatus((prev) => ({ ...prev, ...patch }));
    },
    [session.setObsStatus]
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
    audio.underrunRisk !== 'low';
  const consoleIsLimiting =
    Boolean(audio.telemetry.qualityGateEngaged) ||
    (audio.engineRunning && audio.telemetry.postPeakDb >= session.dsp.limiter.ceilingDb - 0.8);
  const consoleHasSignal = audio.engineRunning && audio.telemetry.postRmsDb > -56;

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
        audioCpuPct={audio.audioCpuPct}
        underrunRisk={audio.underrunRisk}
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
          />

          {/* CENTER PANEL: ALL 16 MODULES DELIVER THEIR CONTENT HERE */}
          <main className="flex-1 min-w-0 min-h-0 overflow-hidden flex flex-col">
            {audio.audioError && (
              <div className="mb-1.5 p-2.5 rounded-md border border-red-500/45 bg-red-500/10 text-xs text-red-300 shrink-0">
                {audio.audioError}
              </div>
            )}

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
                    outputDevices={hardware.outputDevices}
                    preferredStreamOutputDeviceId={hardware.preferredStreamOutputDeviceId}
                    onSelectStreamOutputDevice={hardware.handleSelectStreamOutputDevice}
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
                    audioCpuPct={audio.audioCpuPct}
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
            audioCpuPct={audio.audioCpuPct}
            underrunRisk={audio.underrunRisk}
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
