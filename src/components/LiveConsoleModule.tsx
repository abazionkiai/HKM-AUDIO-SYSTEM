import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Circle,
  Play,
  Repeat,
  Save,
  ShieldAlert,
  Square,
  Trash2,
  Undo2,
  Info,
} from 'lucide-react';
import type {
  AutomationEvent,
  AutomationInitialState,
  AutomationSnapshot,
  DcaGroupName,
  DspConfig,
  HardwareDevice,
  InputChannel,
  ServicePreset,
  ServiceSegmentName,
  SignalTelemetry,
} from '../types/audio.ts';
import { liveAudioEngine } from '../audio/liveAudioEngine.ts';
import {
  ConsolePushButton,
  RotaryKnob,
  VerticalFader,
} from './StudioControls.tsx';

const SERVICE_SEGMENTS: ServiceSegmentName[] = [
  'Prelude',
  'Worship',
  'Sermon',
  'Altar Call',
  'Communion',
  'Benediction',
];

const LANE_COLORS = ['#38BDF8', '#10B981', '#F59E0B', '#A78BFA', '#F472B6', '#2DD4BF'];

function formatTimecode(ms: number): string {
  const clamped = Math.max(0, ms);
  const totalSec = Math.floor(clamped / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  const tenths = Math.floor((clamped % 1000) / 100);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
}

function resolveChannelIdForEvent(
  evt: Pick<AutomationEvent, 'channelId' | 'channelIndex'>,
  channels: InputChannel[]
): string | null {
  if (evt.channelId && channels.some((c) => c.id === evt.channelId)) {
    return evt.channelId;
  }
  if (
    typeof evt.channelIndex === 'number' &&
    evt.channelIndex >= 0 &&
    evt.channelIndex < channels.length
  ) {
    return channels[evt.channelIndex].id;
  }
  return null;
}

function evaluateAutomationAtTime(
  snapshot: AutomationSnapshot,
  channels: InputChannel[],
  timeMs: number
): {
  channelPatches: Record<string, { faderDb: number; mute: boolean }>;
  masterTrimDb: number;
  emergencyMuted: boolean;
} {
  const channelPatches: Record<string, { faderDb: number; mute: boolean }> = {};
  const initEntries = Object.entries(snapshot.initialState.channels);

  channels.forEach((ch, idx) => {
    const direct = snapshot.initialState.channels[ch.id];
    const fallback = !direct && initEntries[idx] ? initEntries[idx][1] : undefined;
    const base = direct ?? fallback;
    if (base) {
      channelPatches[ch.id] = { faderDb: base.faderDb, mute: base.mute };
    } else {
      channelPatches[ch.id] = { faderDb: ch.faderDb, mute: ch.mute };
    }
  });

  let masterTrimDb = snapshot.initialState.masterTrimDb;
  let emergencyMuted = snapshot.initialState.emergencyMuted;

  // Group events by resolved target + param
  const channelFaderBuckets: Record<string, AutomationEvent[]> = {};
  const channelMuteBuckets: Record<string, AutomationEvent[]> = {};
  const masterTrimEvents: AutomationEvent[] = [];
  const masterMuteEvents: AutomationEvent[] = [];

  for (const evt of snapshot.events) {
    if (evt.targetType === 'channel') {
      const targetId = resolveChannelIdForEvent(evt, channels);
      if (!targetId) continue;
      if (evt.param === 'faderDb') {
        if (!channelFaderBuckets[targetId]) channelFaderBuckets[targetId] = [];
        channelFaderBuckets[targetId].push(evt);
      } else if (evt.param === 'mute') {
        if (!channelMuteBuckets[targetId]) channelMuteBuckets[targetId] = [];
        channelMuteBuckets[targetId].push(evt);
      }
    } else if (evt.param === 'masterTrimDb') {
      masterTrimEvents.push(evt);
    } else if (evt.param === 'emergencyMute') {
      masterMuteEvents.push(evt);
    }
  }

  const interpolateScalar = (events: AutomationEvent[], baseVal: number): number => {
    if (events.length === 0) return baseVal;
    let prev: AutomationEvent | null = null;
    let next: AutomationEvent | null = null;
    for (let i = 0; i < events.length; i++) {
      if (events[i].offsetMs <= timeMs) {
        prev = events[i];
      } else {
        next = events[i];
        break;
      }
    }
    if (!prev) {
      return baseVal;
    }
    const prevVal = Number(prev.value);
    if (next && next.offsetMs - prev.offsetMs <= 180 && next.offsetMs > prev.offsetMs) {
      const t = (timeMs - prev.offsetMs) / (next.offsetMs - prev.offsetMs);
      const lerped = prevVal + (Number(next.value) - prevVal) * t;
      return Math.round(lerped * 10) / 10;
    }
    return prevVal;
  };

  const evaluateBool = (events: AutomationEvent[], baseVal: boolean): boolean => {
    let val = baseVal;
    for (let i = 0; i < events.length; i++) {
      if (events[i].offsetMs <= timeMs) {
        val = Boolean(events[i].value);
      } else {
        break;
      }
    }
    return val;
  };

  Object.keys(channelPatches).forEach((chId) => {
    const fEvents = channelFaderBuckets[chId];
    const mEvents = channelMuteBuckets[chId];
    if (fEvents && fEvents.length > 0) {
      channelPatches[chId].faderDb = interpolateScalar(
        fEvents,
        channelPatches[chId].faderDb
      );
    }
    if (mEvents && mEvents.length > 0) {
      channelPatches[chId].mute = evaluateBool(mEvents, channelPatches[chId].mute);
    }
  });

  if (masterTrimEvents.length > 0) {
    masterTrimDb = interpolateScalar(masterTrimEvents, masterTrimDb);
  }
  if (masterMuteEvents.length > 0) {
    emergencyMuted = evaluateBool(masterMuteEvents, emergencyMuted);
  }

  return { channelPatches, masterTrimDb, emergencyMuted };
}

interface AutomationFramePayload {
  channelPatches?: Record<string, { faderDb?: number; mute?: boolean }>;
  masterTrimDb?: number;
  emergencyMuted?: boolean;
}

interface LiveConsoleModuleProps {
  device: HardwareDevice;
  channels: InputChannel[];
  onUpdateChannel: (id: string, patch: Partial<InputChannel>) => void;
  dsp: DspConfig;
  onUpdateDsp: (patch: Partial<DspConfig>) => void;
  telemetry: SignalTelemetry;
  presets?: ServicePreset[];
  activePreset?: ServicePreset;
  onSelectPreset?: (preset: ServicePreset) => void;
  emergencyMuted?: boolean;
  onToggleEmergencyMute?: () => void;
  onUndo?: () => void;
  canUndo?: boolean;
  onSaveVersion?: (summary: string) => void;
  automationSnapshots?: AutomationSnapshot[];
  onSaveAutomation?: (snapshot: AutomationSnapshot) => void;
  onUpdateAutomation?: (id: string, patch: Partial<AutomationSnapshot>) => void;
  onDeleteAutomation?: (id: string) => void;
  onApplyAutomationFrame?: (frame: AutomationFramePayload) => void;
  onLogAutomationEvent?: (action: string, detail: string) => void;
}

interface VuMeterDomRefs {
  fill: HTMLDivElement | null;
  peak: HTMLDivElement | null;
  clip: HTMLDivElement | null;
  readout: HTMLSpanElement | null;
  miniFill: HTMLDivElement | null;
}

interface MasterMeterDomRefs {
  preFill: HTMLDivElement | null;
  prePeak: HTMLDivElement | null;
  postLFill: HTMLDivElement | null;
  postLPeak: HTMLDivElement | null;
  postRFill: HTMLDivElement | null;
  postRPeak: HTMLDivElement | null;
}

function dbToPct(db: number): number {
  return Math.max(0, Math.min(100, ((db + 56) / 56) * 100));
}

function applyCssVuStyles(
  fillEl: HTMLDivElement | null,
  peakEl: HTMLDivElement | null,
  clipEl: HTMLDivElement | null,
  readoutEl: HTMLSpanElement | null,
  rmsDb: number,
  peakDb: number,
  muted: boolean
) {
  const pct = muted ? 0 : dbToPct(rmsDb);
  const peakPct = muted ? 0 : dbToPct(peakDb);
  const isHot = !muted && peakDb > -3;
  const isWarm = !muted && rmsDb > -14;

  if (fillEl) {
    fillEl.style.height = `${pct.toFixed(2)}%`;
    if (muted) {
      fillEl.style.filter = 'brightness(0.35)';
      fillEl.style.boxShadow = 'none';
    } else if (isHot) {
      fillEl.style.filter = 'brightness(1.28) saturate(1.2)';
      fillEl.style.boxShadow = '0 0 12px rgba(239, 68, 68, 0.72)';
    } else if (isWarm) {
      fillEl.style.filter = 'brightness(1.15) saturate(1.1)';
      fillEl.style.boxShadow = '0 0 9px rgba(245, 158, 11, 0.52)';
    } else {
      const intensity = 0.78 + (pct / 100) * 0.35;
      fillEl.style.filter = `brightness(${intensity.toFixed(2)})`;
      fillEl.style.boxShadow =
        pct > 8 ? '0 0 7px rgba(16, 185, 129, 0.42)' : 'none';
    }
  }

  if (peakEl) {
    peakEl.style.bottom = `${Math.max(0, Math.min(98.5, peakPct)).toFixed(2)}%`;
    peakEl.style.opacity = muted || peakPct < 2 ? '0' : '1';
    peakEl.style.backgroundColor = isHot
      ? '#FCA5A5'
      : isWarm
        ? '#FDE68A'
        : '#A7F3D0';
  }

  if (clipEl) {
    clipEl.style.backgroundColor = isHot ? '#EF4444' : '#1E293B';
    clipEl.style.boxShadow = isHot ? '0 0 8px rgba(239, 68, 68, 0.9)' : 'none';
  }

  if (readoutEl) {
    readoutEl.textContent = muted
      ? 'MUTE'
      : rmsDb <= -55
        ? '-∞'
        : rmsDb.toFixed(1);
    readoutEl.style.color = muted
      ? '#F87171'
      : isHot
        ? '#FCA5A5'
        : isWarm
          ? '#FCD34D'
          : '#38BDF8';
  }
}

export const LiveConsoleModule: React.FC<LiveConsoleModuleProps> = ({
  device,
  channels,
  onUpdateChannel,
  dsp,
  onUpdateDsp,
  telemetry,
  presets = [],
  activePreset,
  onSelectPreset,
  emergencyMuted = false,
  onToggleEmergencyMute,
  onUndo,
  canUndo = false,
  onSaveVersion,
  automationSnapshots = [],
  onSaveAutomation,
  onUpdateAutomation,
  onDeleteAutomation,
  onApplyAutomationFrame,
  onLogAutomationEvent,
}) => {
  const isStereoLimited = !device.capabilities.perChannelCapture;
  const activeBands = dsp.eqBands.filter((b) => b.enabled).length;

  // Automation Recording & Segment Loop State
  const [transportMode, setTransportMode] = useState<'idle' | 'recording' | 'playing'>('idle');
  const [selectedSegment, setSelectedSegment] = useState<ServiceSegmentName>('Worship');
  const [snapshotName, setSnapshotName] = useState<string>('Worship Chorus Build');
  const [loopEnabled, setLoopEnabled] = useState<boolean>(true);
  const [activeSnapshot, setActiveSnapshot] = useState<AutomationSnapshot | null>(null);
  const [hasUnsavedDraft, setHasUnsavedDraft] = useState<boolean>(false);
  const [recordedCounts, setRecordedCounts] = useState<{ faders: number; mutes: number }>({
    faders: 0,
    mutes: 0,
  });
  const [segmentFilter, setSegmentFilter] = useState<'All' | ServiceSegmentName>('All');
  const [loopCount, setLoopCount] = useState<number>(0);

  // Pro Console Desk State: Layer Switcher, Selected Fat-Channel & Talkback/Cue
  const [consoleLayer, setConsoleLayer] = useState<'mix' | 'eq-dyn' | 'aux' | 'dca'>('mix');
  const [selectedChannelId, setSelectedChannelId] = useState<string>(channels[0]?.id ?? '');
  const [talkbackActive, setTalkbackActive] = useState<boolean>(false);
  const [cueLevelDb, setCueLevelDb] = useState<number>(-9);

  const selectedChannel =
    channels.find((c) => c.id === selectedChannelId) ?? channels[0];
  const activeSoloCount = channels.filter((c) => c.solo).length;
  const dcaGroups: Exclude<DcaGroupName, 'None'>[] = [
    'DCA 1 · Vox',
    'DCA 2 · Band',
    'DCA 3 · Choir',
    'DCA 4 · Speech',
  ];

  const recStartMsRef = useRef<number>(0);
  const recInitialStateRef = useRef<AutomationInitialState | null>(null);
  const recordedEventsRef = useRef<AutomationEvent[]>([]);
  const prevObservedRef = useRef<{
    channels: Record<string, { faderDb: number; mute: boolean }>;
    masterTrimDb: number;
    emergencyMuted: boolean;
  }>({
    channels: {},
    masterTrimDb: dsp.inputTrimDb,
    emergencyMuted,
  });

  const playStartMsRef = useRef<number>(0);
  const playOffsetAnchorRef = useRef<number>(0);
  const lastLoopCycleRef = useRef<number>(0);
  const lastAppliedPlayFrameRef = useRef<string>('');
  const loopEnabledRef = useRef<boolean>(loopEnabled);
  loopEnabledRef.current = loopEnabled;
  const activeSnapshotRef = useRef<AutomationSnapshot | null>(activeSnapshot);
  activeSnapshotRef.current = activeSnapshot;

  const playheadLineRef = useRef<HTMLDivElement | null>(null);
  const timecodeRef = useRef<HTMLSpanElement | null>(null);

  const channelRefs = useRef<Record<string, VuMeterDomRefs>>({});
  const masterRefs = useRef<MasterMeterDomRefs>({
    preFill: null,
    prePeak: null,
    postLFill: null,
    postLPeak: null,
    postRFill: null,
    postRPeak: null,
  });

  // Mutable state snapshots read by the 60fps requestAnimationFrame loop without re-subscribing
  const latestStateRef = useRef({
    channels,
    dsp,
    telemetry,
    emergencyMuted,
  });
  latestStateRef.current = { channels, dsp, telemetry, emergencyMuted };

  const ballisticsRef = useRef<{
    rms: Record<string, number>;
    peak: Record<string, number>;
    masterPrePeak: number;
    masterPostLPeak: number;
    masterPostRPeak: number;
  }>({
    rms: {},
    peak: {},
    masterPrePeak: -56,
    masterPostLPeak: -56,
    masterPostRPeak: -56,
  });

  useEffect(() => {
    let rafId = 0;

    const tick = (nowMs: number) => {
      const { channels: curChannels, dsp: curDsp, telemetry: curTel, emergencyMuted: curMute } =
        latestStateRef.current;
      const fast = liveAudioEngine.sampleFastLevels();
      const isLive = fast.isRunning || curTel.isRunning;
      const basePre = fast.isRunning ? fast.preRmsDb : curTel.preRmsDb;
      const basePost = fast.isRunning ? fast.postRmsDb : curTel.postRmsDb;
      const basePostPeak = fast.isRunning ? fast.postPeakDb : curTel.postPeakDb;

      const anySolo = curChannels.some((c) => c.solo);
      const b = ballisticsRef.current;

      curChannels.forEach((ch) => {
        const refs = channelRefs.current[ch.id];
        const isSuppressed = ch.mute || (anySolo && !ch.solo);
        let targetRms = -96;

        if (isLive && !isSuppressed) {
          const sourceDrive = ch.solo ? basePre : basePost;
          const trimOffset = (ch.gainDb - 24) * 0.25 + ch.faderDb * 0.65;
          targetRms = Math.max(-56, Math.min(-0.4, sourceDrive + trimOffset));
        }

        const prevRms = b.rms[ch.id] ?? -96;
        // Fast attack (0.45), smooth VU release (0.14)
        const coeff = targetRms > prevRms ? 0.45 : 0.14;
        const smoothedRms = prevRms + (targetRms - prevRms) * coeff;
        b.rms[ch.id] = smoothedRms;

        const instantPeak = Math.min(-0.2, smoothedRms + 4.8);
        const prevPeak = b.peak[ch.id] ?? -56;
        const nextPeak =
          instantPeak >= prevPeak ? instantPeak : Math.max(-56, prevPeak - 0.16);
        b.peak[ch.id] = nextPeak;

        if (refs) {
          applyCssVuStyles(
            refs.fill,
            refs.peak,
            refs.clip,
            refs.readout,
            smoothedRms,
            nextPeak,
            isSuppressed
          );
          if (refs.miniFill) {
            const miniPct = isSuppressed ? 0 : dbToPct(smoothedRms);
            refs.miniFill.style.height = `${miniPct.toFixed(1)}%`;
            refs.miniFill.style.filter = `brightness(${(0.8 + (miniPct / 100) * 0.4).toFixed(2)})`;
          }
        }
      });

      // Master bus high-frequency CSS VU updates
      const preVal = isLive ? Math.max(-56, Math.min(-0.2, basePre)) : -56;
      const postLVal =
        isLive && !curMute
          ? Math.max(-56, Math.min(-0.2, basePost + (curDsp.bypassed ? 0 : curDsp.inputTrimDb * 0.15)))
          : -56;
      const postRVal =
        isLive && !curMute
          ? Math.max(-56, Math.min(-0.2, postLVal))
          : -56;

      b.masterPrePeak =
        preVal >= b.masterPrePeak ? preVal : Math.max(-56, b.masterPrePeak - 0.14);
      b.masterPostLPeak =
        Math.max(postLVal, isLive && !curMute ? basePostPeak : -56) >= b.masterPostLPeak
          ? Math.max(postLVal, isLive && !curMute ? basePostPeak : -56)
          : Math.max(-56, b.masterPostLPeak - 0.14);
      b.masterPostRPeak =
        postRVal >= b.masterPostRPeak ? postRVal : Math.max(-56, b.masterPostRPeak - 0.14);

      const m = masterRefs.current;
      applyCssVuStyles(m.preFill, m.prePeak, null, null, preVal, b.masterPrePeak, !isLive);
      applyCssVuStyles(
        m.postLFill,
        m.postLPeak,
        null,
        null,
        postLVal,
        b.masterPostLPeak,
        !isLive || curMute
      );
      applyCssVuStyles(
        m.postRFill,
        m.postRPeak,
        null,
        null,
        postRVal,
        b.masterPostRPeak,
        !isLive || curMute
      );

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, []);

  const registerChannelRef = (
    id: string,
    key: keyof VuMeterDomRefs,
    el: HTMLDivElement | HTMLSpanElement | null
  ) => {
    if (!channelRefs.current[id]) {
      channelRefs.current[id] = {
        fill: null,
        peak: null,
        clip: null,
        readout: null,
        miniFill: null,
      };
    }
    if (key === 'readout') {
      channelRefs.current[id].readout = el as HTMLSpanElement | null;
    } else {
      channelRefs.current[id][key] = el as HTMLDivElement | null;
    }
  };

  // Capture fader movements & mute toggles in real time while Recording is armed
  useEffect(() => {
    const nextSnapshot: Record<string, { faderDb: number; mute: boolean }> = {};
    channels.forEach((ch) => {
      nextSnapshot[ch.id] = { faderDb: ch.faderDb, mute: ch.mute };
    });

    if (transportMode !== 'recording') {
      prevObservedRef.current = {
        channels: nextSnapshot,
        masterTrimDb: dsp.inputTrimDb,
        emergencyMuted,
      };
      return;
    }

    const offsetMs = Math.max(0, Math.round(performance.now() - recStartMsRef.current));
    const prev = prevObservedRef.current;
    const added: AutomationEvent[] = [];

    channels.forEach((ch, idx) => {
      const prevCh = prev.channels[ch.id];
      if (!prevCh) return;
      if (Math.abs(ch.faderDb - prevCh.faderDb) >= 0.05) {
        added.push({
          id: `ae-${offsetMs}-${ch.id}-f-${Math.random().toString(36).slice(2, 6)}`,
          offsetMs,
          targetType: 'channel',
          channelId: ch.id,
          channelIndex: idx,
          channelName: ch.name,
          param: 'faderDb',
          value: ch.faderDb,
        });
      }
      if (ch.mute !== prevCh.mute) {
        added.push({
          id: `ae-${offsetMs}-${ch.id}-m-${Math.random().toString(36).slice(2, 6)}`,
          offsetMs,
          targetType: 'channel',
          channelId: ch.id,
          channelIndex: idx,
          channelName: ch.name,
          param: 'mute',
          value: ch.mute,
        });
      }
    });

    if (Math.abs(dsp.inputTrimDb - prev.masterTrimDb) >= 0.05) {
      added.push({
        id: `ae-${offsetMs}-master-f-${Math.random().toString(36).slice(2, 6)}`,
        offsetMs,
        targetType: 'master',
        channelName: 'Master Trim',
        param: 'masterTrimDb',
        value: dsp.inputTrimDb,
      });
    }

    if (emergencyMuted !== prev.emergencyMuted) {
      added.push({
        id: `ae-${offsetMs}-master-m-${Math.random().toString(36).slice(2, 6)}`,
        offsetMs,
        targetType: 'master',
        channelName: 'Safe Mute',
        param: 'emergencyMute',
        value: emergencyMuted,
      });
    }

    if (added.length > 0) {
      recordedEventsRef.current.push(...added);
      let faders = 0;
      let mutes = 0;
      for (const evt of recordedEventsRef.current) {
        if (evt.param === 'faderDb' || evt.param === 'masterTrimDb') faders++;
        else mutes++;
      }
      setRecordedCounts({ faders, mutes });
    }

    prevObservedRef.current = {
      channels: nextSnapshot,
      masterTrimDb: dsp.inputTrimDb,
      emergencyMuted,
    };
  }, [channels, dsp.inputTrimDb, emergencyMuted, transportMode]);

  // High-precision 60fps Automation Transport (Recording Timecode + Loop Playback)
  useEffect(() => {
    if (transportMode === 'idle') return;
    let rafId = 0;

    const step = () => {
      if (transportMode === 'recording') {
        const elapsed = Math.max(0, performance.now() - recStartMsRef.current);
        if (timecodeRef.current) {
          timecodeRef.current.textContent = `${formatTimecode(elapsed)} · REC`;
        }
        rafId = window.requestAnimationFrame(step);
        return;
      }

      const snap = activeSnapshotRef.current;
      if (!snap || snap.durationMs <= 0) {
        setTransportMode('idle');
        return;
      }

      const rawElapsed =
        playOffsetAnchorRef.current + (performance.now() - playStartMsRef.current);
      const duration = snap.durationMs;

      if (rawElapsed >= duration && !loopEnabledRef.current) {
        const finalState = evaluateAutomationAtTime(
          snap,
          latestStateRef.current.channels,
          duration
        );
        onApplyAutomationFrame?.(finalState);
        if (playheadLineRef.current) playheadLineRef.current.style.left = '100%';
        if (timecodeRef.current) {
          timecodeRef.current.textContent = `${formatTimecode(duration)} / ${formatTimecode(duration)}`;
        }
        setTransportMode('idle');
        return;
      }

      const cycle = Math.floor(rawElapsed / duration);
      const playMs = rawElapsed % duration;
      if (cycle !== lastLoopCycleRef.current) {
        lastLoopCycleRef.current = cycle;
        setLoopCount(cycle);
      }

      const pct = Math.max(0, Math.min(100, (playMs / duration) * 100));
      if (playheadLineRef.current) {
        playheadLineRef.current.style.left = `${pct.toFixed(2)}%`;
      }
      if (timecodeRef.current) {
        timecodeRef.current.textContent = `${formatTimecode(playMs)} / ${formatTimecode(duration)}`;
      }

      const evaluated = evaluateAutomationAtTime(
        snap,
        latestStateRef.current.channels,
        playMs
      );
      const signature = JSON.stringify(evaluated);
      if (signature !== lastAppliedPlayFrameRef.current) {
        lastAppliedPlayFrameRef.current = signature;
        onApplyAutomationFrame?.(evaluated);
      }

      rafId = window.requestAnimationFrame(step);
    };

    rafId = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(rafId);
  }, [transportMode, onApplyAutomationFrame]);

  const handleStartRecording = () => {
    const initChannels: Record<string, { faderDb: number; mute: boolean }> = {};
    channels.forEach((ch) => {
      initChannels[ch.id] = { faderDb: ch.faderDb, mute: ch.mute };
    });
    recInitialStateRef.current = {
      channels: initChannels,
      masterTrimDb: dsp.inputTrimDb,
      emergencyMuted,
    };
    prevObservedRef.current = {
      channels: initChannels,
      masterTrimDb: dsp.inputTrimDb,
      emergencyMuted,
    };
    recordedEventsRef.current = [];
    setRecordedCounts({ faders: 0, mutes: 0 });
    setHasUnsavedDraft(false);
    recStartMsRef.current = performance.now();
    if (playheadLineRef.current) playheadLineRef.current.style.left = '0%';
    setTransportMode('recording');
    onLogAutomationEvent?.(
      'Armed Console Automation Recording',
      `Segment: ${selectedSegment} · Capturing fader rides and mute toggles`
    );
  };

  const handleStopTransport = () => {
    if (transportMode === 'recording') {
      const durationMs = Math.max(1500, Math.round(performance.now() - recStartMsRef.current));
      const initialState = recInitialStateRef.current ?? {
        channels: Object.fromEntries(
          channels.map((ch) => [ch.id, { faderDb: ch.faderDb, mute: ch.mute }])
        ),
        masterTrimDb: dsp.inputTrimDb,
        emergencyMuted,
      };
      const draft: AutomationSnapshot = {
        id: `auto-${Date.now()}`,
        name: snapshotName.trim() || `${selectedSegment} Mix Pass`,
        segment: selectedSegment,
        createdAt: new Date().toISOString(),
        durationMs,
        loop: loopEnabled,
        deviceId: device.id,
        initialState,
        events: [...recordedEventsRef.current],
      };
      setActiveSnapshot(draft);
      setHasUnsavedDraft(true);
      setTransportMode('idle');
      setLoopCount(0);
      if (playheadLineRef.current) playheadLineRef.current.style.left = '0%';
      if (timecodeRef.current) {
        timecodeRef.current.textContent = `00:00.0 / ${formatTimecode(durationMs)}`;
      }
      onLogAutomationEvent?.(
        'Captured Automation Take',
        `${draft.segment}: ${draft.events.length} events over ${(durationMs / 1000).toFixed(1)}s`
      );
      return;
    }

    // Stop playback & reset playhead to 00:00.0
    setTransportMode('idle');
    playOffsetAnchorRef.current = 0;
    lastLoopCycleRef.current = 0;
    setLoopCount(0);
    if (playheadLineRef.current) playheadLineRef.current.style.left = '0%';
    if (timecodeRef.current && activeSnapshot) {
      timecodeRef.current.textContent = `00:00.0 / ${formatTimecode(activeSnapshot.durationMs)}`;
    }
  };

  const handlePlaySnapshot = (targetSnap?: AutomationSnapshot, forceLoop?: boolean) => {
    const snap = targetSnap ?? activeSnapshot;
    if (!snap) return;

    if (forceLoop !== undefined) {
      setLoopEnabled(forceLoop);
      loopEnabledRef.current = forceLoop;
    } else {
      setLoopEnabled(snap.loop);
      loopEnabledRef.current = snap.loop;
    }

    setActiveSnapshot(snap);
    activeSnapshotRef.current = snap;
    setSelectedSegment(snap.segment);
    setSnapshotName(snap.name);
    if (targetSnap) {
      setHasUnsavedDraft(false);
    }

    // Apply initial state immediately so segment begins cleanly
    const initialEval = evaluateAutomationAtTime(snap, channels, 0);
    lastAppliedPlayFrameRef.current = JSON.stringify(initialEval);
    onApplyAutomationFrame?.(initialEval);

    playOffsetAnchorRef.current = 0;
    lastLoopCycleRef.current = 0;
    setLoopCount(0);
    playStartMsRef.current = performance.now();
    if (playheadLineRef.current) playheadLineRef.current.style.left = '0%';
    setTransportMode('playing');
    onLogAutomationEvent?.(
      'Started Automation Playback',
      `${snap.segment}: ${snap.name} (${(forceLoop ?? snap.loop) ? 'LOOP' : '1X'})`
    );
  };

  const handleSaveCurrentSnapshot = () => {
    if (!activeSnapshot) return;
    const committed: AutomationSnapshot = {
      ...activeSnapshot,
      name: snapshotName.trim() || `${selectedSegment} Mix Pass`,
      segment: selectedSegment,
      loop: loopEnabled,
    };
    setActiveSnapshot(committed);
    setHasUnsavedDraft(false);
    onSaveAutomation?.(committed);
  };

  const handleScrubTimeline = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!activeSnapshot || transportMode === 'recording') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetMs = Math.round(ratio * activeSnapshot.durationMs);
    playOffsetAnchorRef.current = targetMs;
    playStartMsRef.current = performance.now();
    if (playheadLineRef.current) {
      playheadLineRef.current.style.left = `${(ratio * 100).toFixed(2)}%`;
    }
    if (timecodeRef.current) {
      timecodeRef.current.textContent = `${formatTimecode(targetMs)} / ${formatTimecode(activeSnapshot.durationMs)}`;
    }
    const evaluated = evaluateAutomationAtTime(activeSnapshot, channels, targetMs);
    lastAppliedPlayFrameRef.current = JSON.stringify(evaluated);
    onApplyAutomationFrame?.(evaluated);
  };

  const automatedChannelIds = useMemo(() => {
    const set = new Set<string>();
    const sourceEvents =
      transportMode === 'recording'
        ? recordedEventsRef.current
        : activeSnapshot?.events ?? [];
    for (const evt of sourceEvents) {
      const resolved = resolveChannelIdForEvent(evt, channels);
      if (resolved) set.add(resolved);
    }
    return set;
  }, [transportMode, recordedCounts, activeSnapshot, channels]);

  const timelineVisuals = useMemo(() => {
    if (!activeSnapshot || activeSnapshot.durationMs <= 0) {
      return { paths: [], mutes: [] };
    }
    const dur = activeSnapshot.durationMs;
    const faderGroups: Record<string, { label: string; points: { x: number; y: number }[] }> = {};
    const mutes: { id: string; xPct: number; muting: boolean; label: string }[] = [];

    for (const evt of activeSnapshot.events) {
      const xPct = Math.max(0, Math.min(100, (evt.offsetMs / dur) * 100));
      if (evt.param === 'faderDb' || evt.param === 'masterTrimDb') {
        const key = evt.targetType === 'master' ? 'master' : evt.channelId ?? `idx-${evt.channelIndex}`;
        if (!faderGroups[key]) {
          faderGroups[key] = {
            label: evt.channelName ?? key,
            points: [],
          };
        }
        const dbVal = Number(evt.value);
        // Map [-48, +10] -> [50, 6] SVG y-coordinates
        const norm = Math.max(0, Math.min(1, (dbVal + 48) / 58));
        const y = 50 - norm * 44;
        faderGroups[key].points.push({ x: xPct * 10, y });
      } else {
        mutes.push({
          id: evt.id,
          xPct,
          muting: Boolean(evt.value),
          label: `${evt.channelName ?? 'Channel'} ${evt.value ? 'MUTE' : 'UNMUTE'} @ ${formatTimecode(evt.offsetMs)}`,
        });
      }
    }

    const paths = Object.entries(faderGroups).map(([key, grp], idx) => {
      const pts = grp.points;
      const d =
        pts.length === 1
          ? `M 0 ${pts[0].y.toFixed(1)} L ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} L 1000 ${pts[0].y.toFixed(1)}`
          : pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ') +
            ` L 1000 ${pts[pts.length - 1].y.toFixed(1)}`;
      return {
        key,
        label: grp.label,
        color: LANE_COLORS[idx % LANE_COLORS.length],
        d,
      };
    });

    return { paths, mutes };
  }, [activeSnapshot]);

  const filteredSnapshots = useMemo(
    () =>
      segmentFilter === 'All'
        ? automationSnapshots
        : automationSnapshots.filter((s) => s.segment === segmentFilter),
    [automationSnapshots, segmentFilter]
  );

  return (
    <div className="space-y-4">
      {/* Console Chassis Header & Scene Recall Strip */}
      <div className="rounded-lg border border-slate-800 bg-gradient-to-b from-[#161D29] to-[#0E131C] p-3.5 shadow-lg">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-2.5 h-8 rounded-xs bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.6)]" />
            <div>
              <div className="flex items-center gap-2.5">
                <span className="font-mono text-[11px] font-bold text-sky-400">01</span>
                <h1 className="font-display text-lg font-semibold tracking-tight text-white">
                  CHURCH LIVE SOUND CONSOLE
                </h1>
                <span className="font-mono text-[10px] text-sky-300 uppercase">
                  · {device.manufacturer} {device.model}
                </span>
              </div>
              <p className="text-[11px] font-mono text-slate-400 mt-0.5">
                {device.capabilities.controlProtocol} ·{' '}
                {device.capabilities.perChannelFaderControl
                  ? 'Hardware-Linked Motor Faders'
                  : 'Software DSP Surface (Analog Console Preamps Manual)'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {presets.length > 0 && onSelectPreset && activePreset && (
              <div className="flex items-center gap-1.5 bg-[#090D14] border border-slate-800 rounded px-2 py-1">
                <span className="font-mono text-[10px] text-slate-400 uppercase">Scene</span>
                <select
                  aria-label="Console Scene Recall"
                  value={activePreset.id}
                  onChange={(e) => {
                    const found = presets.find((p) => p.id === e.target.value);
                    if (found) onSelectPreset(found);
                  }}
                  className="bg-transparent text-xs font-mono font-semibold text-sky-300 focus:outline-none cursor-pointer"
                >
                  {presets.map((p) => (
                    <option key={p.id} value={p.id} className="bg-[#0E131C] text-slate-100">
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {onUndo && (
              <button
                type="button"
                disabled={!canUndo}
                onClick={onUndo}
                className="px-2.5 py-1.5 rounded-xs border border-slate-700 bg-[#121722] text-[10px] font-mono font-semibold text-slate-300 hover:border-slate-500 disabled:opacity-35 flex items-center gap-1"
              >
                <Undo2 className="w-3 h-3" />
                <span>UNDO</span>
              </button>
            )}

            {onSaveVersion && (
              <button
                type="button"
                onClick={() =>
                  onSaveVersion(`Console snapshot (${activePreset?.name ?? 'Live Mix'})`)
                }
                className="px-2.5 py-1.5 rounded-xs border border-slate-700 bg-[#121722] text-[10px] font-mono font-semibold text-slate-200 hover:border-sky-500/60 flex items-center gap-1"
              >
                <Save className="w-3 h-3 text-sky-400" />
                <span>SAVE</span>
              </button>
            )}

            <ConsolePushButton
              label={dsp.bypassed ? 'DSP BYPASS' : 'DSP ACTIVE'}
              active={!dsp.bypassed}
              tone={dsp.bypassed ? 'amber' : 'emerald'}
              onClick={() => onUpdateDsp({ bypassed: !dsp.bypassed })}
            />

            {onToggleEmergencyMute && (
              <ConsolePushButton
                label={emergencyMuted ? 'PA MUTED' : 'SAFE MUTE'}
                active={emergencyMuted}
                tone="red"
                onClick={onToggleEmergencyMute}
              />
            )}
          </div>
        </div>

        {/* Connected Signal Flow Telemetry Bar */}
        <div className="mt-3 pt-3 border-t border-slate-800/90 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 overflow-x-auto text-[10px] font-mono whitespace-nowrap">
            <span className="px-2 py-1 rounded-xs bg-[#0A0D14] border border-slate-700 text-slate-200">
              1. {device.model} ({isStereoLimited ? 'Stereo USB' : `${channels.length}-ch`})
            </span>
            <span className="text-sky-500">──</span>
            <span
              className={`px-2 py-1 rounded-xs border ${
                dsp.hpfEnabled
                  ? 'bg-sky-500/10 border-sky-500/40 text-sky-300'
                  : 'bg-[#0A0D14] border-slate-800 text-slate-500'
              }`}
            >
              2. HPF {dsp.hpfEnabled ? `${dsp.hpfHz} Hz` : 'OFF'}
            </span>
            <span className="text-sky-500">──</span>
            <span className="px-2 py-1 rounded-xs bg-sky-500/10 border border-sky-500/40 text-sky-300">
              3. PEQ ({activeBands}/6)
            </span>
            <span className="text-sky-500">──</span>
            <span
              className={`px-2 py-1 rounded-xs border ${
                dsp.compressor.enabled
                  ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                  : 'bg-[#0A0D14] border-slate-800 text-slate-500'
              }`}
            >
              4. COMP {dsp.compressor.enabled ? `${dsp.compressor.ratio.toFixed(1)}:1` : 'OFF'}
            </span>
            <span className="text-sky-500">──</span>
            <span
              className={`px-2 py-1 rounded-xs border ${
                dsp.limiter.enabled
                  ? 'bg-amber-500/10 border-amber-500/40 text-amber-300'
                  : 'bg-[#0A0D14] border-slate-800 text-slate-500'
              }`}
            >
              5. LIMIT {dsp.limiter.enabled ? `${dsp.limiter.ceilingDb.toFixed(1)} dBFS` : 'OFF'}
            </span>
          </div>

          <div className="flex items-center gap-4 text-[11px] font-mono tabular-nums text-slate-300">
            <span>
              CLOCK:{' '}
              <strong className="text-emerald-400">
                {(telemetry.sampleRate / 1000).toFixed(1)} kHz
              </strong>
            </span>
            <span>
              PRE: <strong className="text-slate-100">{telemetry.isRunning ? `${telemetry.preRmsDb.toFixed(1)} dB` : '--'}</strong>
            </span>
            <span>
              POST: <strong className="text-sky-400">{telemetry.isRunning ? `${telemetry.postRmsDb.toFixed(1)} dB` : '--'}</strong>
            </span>
            <span>
              GR: <strong className="text-amber-400">-{telemetry.gainReductionDb.toFixed(1)} dB</strong>
            </span>
          </div>
        </div>
      </div>

      {/* Automation Transport & Service Segment Loop Deck */}
      <div className="rounded-lg border border-slate-800 bg-gradient-to-b from-[#131924] to-[#0B0F17] p-3.5 space-y-3 shadow-lg">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-2 pr-2 border-r border-slate-800">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  transportMode === 'recording'
                    ? 'bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.9)]'
                    : transportMode === 'playing'
                      ? 'bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.85)]'
                      : 'bg-slate-600'
                }`}
              />
              <div>
                <div className="font-mono text-[11px] font-semibold text-white uppercase tracking-wider">
                  Automation &amp; Segment Loop Engine
                </div>
                <div className="font-mono text-[10px] text-slate-400">
                  Tracks Fader Rides &amp; Mute Toggles Over Time
                </div>
              </div>
            </div>

            {/* Hardware Transport Buttons */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={transportMode === 'recording'}
                onClick={handleStartRecording}
                className={`px-2.5 py-1.5 rounded-xs border text-[10px] font-mono font-semibold flex items-center gap-1.5 transition-all ${
                  transportMode === 'recording'
                    ? 'bg-red-600 border-red-400 text-white shadow-[0_0_12px_rgba(239,68,68,0.6)]'
                    : 'bg-[#121722] border-red-500/40 text-red-400 hover:bg-red-500/15'
                }`}
              >
                <Circle className="w-3 h-3 fill-current" />
                <span>{transportMode === 'recording' ? 'RECORDING' : 'REC'}</span>
              </button>

              <button
                type="button"
                disabled={transportMode === 'recording' || !activeSnapshot}
                onClick={() => handlePlaySnapshot()}
                className={`px-2.5 py-1.5 rounded-xs border text-[10px] font-mono font-semibold flex items-center gap-1.5 transition-all disabled:opacity-35 ${
                  transportMode === 'playing'
                    ? 'bg-emerald-600 border-emerald-400 text-white shadow-[0_0_10px_rgba(16,185,129,0.5)]'
                    : 'bg-[#121722] border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/15'
                }`}
              >
                <Play className="w-3 h-3 fill-current" />
                <span>{transportMode === 'playing' ? 'PLAYING' : 'PLAY'}</span>
              </button>

              <button
                type="button"
                disabled={transportMode === 'idle' && !activeSnapshot}
                onClick={handleStopTransport}
                className="px-2.5 py-1.5 rounded-xs border border-slate-700 bg-[#121722] text-[10px] font-mono font-semibold text-slate-200 hover:border-slate-500 disabled:opacity-35 flex items-center gap-1"
              >
                <Square className="w-3 h-3 fill-current" />
                <span>STOP</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  const next = !loopEnabled;
                  setLoopEnabled(next);
                  loopEnabledRef.current = next;
                  if (activeSnapshot && !hasUnsavedDraft) {
                    onUpdateAutomation?.(activeSnapshot.id, { loop: next });
                  }
                }}
                className={`px-2.5 py-1.5 rounded-xs border text-[10px] font-mono font-semibold flex items-center gap-1 transition-all ${
                  loopEnabled
                    ? 'bg-amber-500/20 border-amber-400 text-amber-300 shadow-[0_0_8px_rgba(245,158,11,0.35)]'
                    : 'bg-[#121722] border-slate-700 text-slate-400 hover:border-slate-500'
                }`}
              >
                <Repeat className="w-3 h-3" />
                <span>{loopEnabled ? 'LOOP ON' : 'LOOP 1X'}</span>
              </button>
            </div>
          </div>

          {/* Segment Selector + Snapshot Title + Save */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 bg-[#080B11] border border-slate-800 rounded px-2 py-1">
              <span className="font-mono text-[10px] text-slate-400 uppercase">Segment</span>
              <select
                aria-label="Service Segment"
                value={selectedSegment}
                onChange={(e) => setSelectedSegment(e.target.value as ServiceSegmentName)}
                className="bg-transparent text-xs font-mono font-semibold text-amber-300 focus:outline-none cursor-pointer"
              >
                {SERVICE_SEGMENTS.map((seg) => (
                  <option key={seg} value={seg} className="bg-[#0E131C] text-slate-100">
                    {seg}
                  </option>
                ))}
              </select>
            </div>

            <input
              type="text"
              aria-label="Automation Snapshot Name"
              value={snapshotName}
              onChange={(e) => setSnapshotName(e.target.value)}
              placeholder="Segment snapshot label..."
              className="w-44 px-2.5 py-1 rounded bg-[#080B11] border border-slate-800 text-xs font-mono text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-sky-500/60"
            />

            <button
              type="button"
              disabled={!activeSnapshot || transportMode === 'recording'}
              onClick={handleSaveCurrentSnapshot}
              className={`px-2.5 py-1.5 rounded-xs border text-[10px] font-mono font-semibold flex items-center gap-1.5 transition-all disabled:opacity-35 ${
                hasUnsavedDraft
                  ? 'bg-sky-600 border-sky-400 text-white shadow-[0_0_10px_rgba(56,189,248,0.45)]'
                  : 'bg-[#121722] border-slate-700 text-sky-300 hover:border-sky-500/60'
              }`}
            >
              <Save className="w-3 h-3" />
              <span>{hasUnsavedDraft ? 'SAVE TAKE' : 'SAVE SNAPSHOT'}</span>
            </button>

            <div className="px-2.5 py-1 rounded bg-[#070A10] border border-slate-800 font-mono text-[11px] tabular-nums flex items-center gap-2">
              <span ref={timecodeRef} className="text-sky-300 font-semibold">
                {activeSnapshot
                  ? `00:00.0 / ${formatTimecode(activeSnapshot.durationMs)}`
                  : '00:00.0 / 00:00.0'}
              </span>
              {transportMode === 'playing' && loopEnabled && loopCount > 0 && (
                <span className="text-[10px] text-amber-400">#{loopCount + 1}</span>
              )}
            </div>
          </div>
        </div>

        {/* Automation Lane Timeline & Event Markers */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-3 items-stretch">
          <div className="xl:col-span-7 flex flex-col justify-between rounded border border-slate-800 bg-[#070A10] p-2.5">
            <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 mb-1.5">
              <span>
                {transportMode === 'recording'
                  ? `CAPTURING LIVE MOVES · ${recordedCounts.faders} FADER · ${recordedCounts.mutes} MUTE EVENTS`
                  : activeSnapshot
                    ? `LANE: ${activeSnapshot.segment.toUpperCase()} · ${activeSnapshot.name} (${activeSnapshot.events.length} EVENTS)`
                    : 'AUTOMATION LANE IDLE · PRESS REC AND MOVE FADERS OR TOGGLE MUTES'}
              </span>
              {activeSnapshot && (
                <span className="text-slate-500">CLICK LANE TO SCRUB</span>
              )}
            </div>

            <div
              onClick={handleScrubTimeline}
              className={`relative h-[58px] rounded-xs border border-slate-800/90 bg-[#05070B] overflow-hidden ${
                activeSnapshot && transportMode !== 'recording' ? 'cursor-pointer' : ''
              }`}
            >
              {/* Grid lines */}
              <div className="absolute inset-x-0 top-1/4 border-t border-slate-800/60 pointer-events-none" />
              <div className="absolute inset-x-0 top-1/2 border-t border-slate-800/80 pointer-events-none" />
              <div className="absolute inset-x-0 top-3/4 border-t border-slate-800/60 pointer-events-none" />

              {timelineVisuals.paths.length > 0 && (
                <svg
                  viewBox="0 0 1000 56"
                  preserveAspectRatio="none"
                  className="absolute inset-0 w-full h-full pointer-events-none"
                >
                  {timelineVisuals.paths.map((lane) => (
                    <path
                      key={lane.key}
                      d={lane.d}
                      fill="none"
                      stroke={lane.color}
                      strokeWidth="1.8"
                      strokeOpacity="0.9"
                    />
                  ))}
                </svg>
              )}

              {/* Mute toggle pins */}
              {timelineVisuals.mutes.map((m) => (
                <div
                  key={m.id}
                  title={m.label}
                  className="absolute top-0 bottom-0 w-[2px] pointer-events-none"
                  style={{
                    left: `${m.xPct}%`,
                    backgroundColor: m.muting ? 'rgba(239,68,68,0.85)' : 'rgba(16,185,129,0.85)',
                  }}
                >
                  <div
                    className="w-2 h-2 -ml-[3px] mt-0.5 rounded-full"
                    style={{ backgroundColor: m.muting ? '#EF4444' : '#10B981' }}
                  />
                </div>
              ))}

              {/* 60fps Playhead Needle */}
              <div
                ref={playheadLineRef}
                className="absolute top-0 bottom-0 w-[2px] bg-white shadow-[0_0_8px_rgba(255,255,255,0.9)] pointer-events-none will-change-[left]"
                style={{ left: '0%' }}
              />
            </div>

            {timelineVisuals.paths.length > 0 && (
              <div className="flex flex-wrap items-center gap-3 mt-1.5 text-[9px] font-mono text-slate-400">
                {timelineVisuals.paths.slice(0, 6).map((lane) => (
                  <span key={lane.key} className="flex items-center gap-1">
                    <span
                      className="w-2 h-2 rounded-xs inline-block"
                      style={{ backgroundColor: lane.color }}
                    />
                    <span>{lane.label}</span>
                  </span>
                ))}
                {timelineVisuals.mutes.length > 0 && (
                  <span className="text-slate-500">
                    · {timelineVisuals.mutes.length} MUTE PINS
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Saved Service Segment Snapshots Bank */}
          <div className="xl:col-span-5 rounded border border-slate-800 bg-[#070A10] p-2.5 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-300">
                Saved Segment Snapshots ({filteredSnapshots.length})
              </span>
              <select
                aria-label="Filter Snapshots by Service Segment"
                value={segmentFilter}
                onChange={(e) =>
                  setSegmentFilter(e.target.value as 'All' | ServiceSegmentName)
                }
                className="bg-[#0D1119] border border-slate-800 rounded px-1.5 py-0.5 text-[10px] font-mono text-slate-300 focus:outline-none"
              >
                <option value="All">All Segments</option>
                {SERVICE_SEGMENTS.map((seg) => (
                  <option key={seg} value={seg}>
                    {seg}
                  </option>
                ))}
              </select>
            </div>

            {filteredSnapshots.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-center px-3 py-3 text-[11px] font-mono text-slate-500 border border-dashed border-slate-800 rounded">
                Arm REC, adjust channel faders or mutes, then STOP &amp; SAVE TAKE to store a loopable service segment snapshot.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[112px] overflow-y-auto pr-1">
                {filteredSnapshots.map((snap) => {
                  const isActive = activeSnapshot?.id === snap.id;
                  const isPlayingThis = isActive && transportMode === 'playing';
                  return (
                    <div
                      key={snap.id}
                      className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded border text-[11px] font-mono transition-colors ${
                        isActive
                          ? 'bg-sky-500/10 border-sky-500/50 text-slate-100'
                          : 'bg-[#0B0F17] border-slate-800 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <button
                        type="button"
                        disabled={transportMode === 'recording'}
                        onClick={() => {
                          if (transportMode === 'playing') setTransportMode('idle');
                          setActiveSnapshot(snap);
                          activeSnapshotRef.current = snap;
                          setSelectedSegment(snap.segment);
                          setSnapshotName(snap.name);
                          setLoopEnabled(snap.loop);
                          loopEnabledRef.current = snap.loop;
                          setHasUnsavedDraft(false);
                          playOffsetAnchorRef.current = 0;
                          if (playheadLineRef.current) playheadLineRef.current.style.left = '0%';
                          if (timecodeRef.current) {
                            timecodeRef.current.textContent = `00:00.0 / ${formatTimecode(snap.durationMs)}`;
                          }
                        }}
                        className="min-w-0 flex-1 text-left cursor-pointer disabled:cursor-not-allowed"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="px-1 py-0.5 rounded-xs bg-amber-500/15 border border-amber-500/40 text-amber-300 text-[9px] uppercase shrink-0">
                            {snap.segment}
                          </span>
                          <span className="truncate font-semibold text-slate-100">
                            {snap.name}
                          </span>
                        </div>
                        <div className="text-[9px] text-slate-500 mt-0.5">
                          {(snap.durationMs / 1000).toFixed(1)}s · {snap.events.length} events
                        </div>
                      </button>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          title={isPlayingThis ? 'Restart Segment' : 'Play / Loop Segment'}
                          disabled={transportMode === 'recording'}
                          onClick={() => handlePlaySnapshot(snap, true)}
                          className={`px-2 py-1 rounded-xs border text-[9px] font-semibold flex items-center gap-1 ${
                            isPlayingThis
                              ? 'bg-emerald-600 border-emerald-400 text-white'
                              : 'bg-[#121722] border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/15'
                          }`}
                        >
                          <Repeat className="w-2.5 h-2.5" />
                          <span>{isPlayingThis ? 'LOOPING' : 'LOOP'}</span>
                        </button>
                        <button
                          type="button"
                          title="Delete Automation Snapshot"
                          onClick={() => {
                            if (activeSnapshot?.id === snap.id) {
                              if (transportMode === 'playing') setTransportMode('idle');
                              setActiveSnapshot(null);
                            }
                            onDeleteAutomation?.(snap.id);
                          }}
                          className="p-1 rounded-xs border border-slate-800 bg-[#121722] text-slate-400 hover:text-red-400 hover:border-red-500/40"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Console Desk: Physical I/O Bank + Channel Strips + Master Bus */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-stretch">
        {/* Left Physical I/O & Hardware Authority Rack */}
        <div className="xl:col-span-2 rounded-lg border border-slate-800 bg-[#0D1119] p-3 flex flex-col justify-between gap-3">
          <div>
            <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2.5">
              <span className="font-mono text-[10px] font-semibold tracking-wider text-slate-300 uppercase">
                Physical I/O
              </span>
              <span className="font-mono text-[10px] text-emerald-400">
                {device.capabilities.maxInputChannels} IN / {device.capabilities.maxOutputChannels} OUT
              </span>
            </div>

            {/* High-Frequency 60fps CSS Hardware Input VU Array */}
            <div className="grid grid-cols-4 gap-1.5 bg-[#070A10] border border-slate-800/90 rounded p-2">
              {channels.slice(0, 8).map((ch) => (
                <div key={ch.id} className="flex flex-col items-center gap-1">
                  <div className="relative w-3 h-[104px] rounded-xs bg-[#05080D] border border-slate-800 overflow-hidden">
                    <div
                      ref={(el) => registerChannelRef(ch.id, 'miniFill', el)}
                      className="absolute bottom-0 inset-x-0 will-change-[height,filter]"
                      style={{
                        height: '0%',
                        background:
                          'linear-gradient(to top, #10B981 0%, #34D399 58%, #F59E0B 78%, #EF4444 96%)',
                      }}
                    />
                    <div
                      className="absolute inset-0 pointer-events-none"
                      style={{
                        backgroundImage:
                          'repeating-linear-gradient(to top, transparent 0px, transparent 5px, rgba(5,8,13,0.9) 5px, rgba(5,8,13,0.9) 7px)',
                      }}
                    />
                  </div>
                  <span className="font-mono text-[9px] text-slate-500">
                    {String(ch.index).padStart(2, '0')}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="p-2.5 rounded border border-slate-800 bg-[#090D14] space-y-1.5 text-[11px] text-slate-400">
            <div className="flex items-center gap-1.5 font-semibold text-slate-200">
              <Info className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              <span>{device.tierLabel}</span>
            </div>
            <p className="leading-snug text-[10px] text-slate-400">
              {device.capabilities.limitationsNote}
            </p>
          </div>
        </div>

        {/* Center Hardware Channel Strip Bank + Fat-Channel Inspector */}
        <div className="xl:col-span-7 rounded-lg border border-slate-800 bg-[#0D1119] p-3 flex flex-col gap-3">
          {/* Console Layer Switcher + Active Solo / Cue Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
            <div className="flex items-center gap-1 p-0.5 rounded bg-[#070A10] border border-slate-800">
              {[
                { id: 'mix', label: 'MIX DESK' },
                { id: 'eq-dyn', label: 'EQ & DYN' },
                { id: 'aux', label: 'AUX SENDS' },
                { id: 'dca', label: 'DCA / GROUPS' },
              ].map((layer) => (
                <button
                  key={layer.id}
                  type="button"
                  onClick={() => setConsoleLayer(layer.id as typeof consoleLayer)}
                  className={`px-2.5 py-1 rounded-xs font-mono text-[10px] font-semibold transition-colors whitespace-nowrap ${
                    consoleLayer === layer.id
                      ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                      : 'text-slate-400 hover:text-slate-200 border border-transparent'
                  }`}
                >
                  {layer.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 font-mono text-[10px]">
              {activeSoloCount > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    channels.forEach((c) => {
                      if (c.solo) onUpdateChannel(c.id, { solo: false });
                    })
                  }
                  className="px-2 py-1 rounded-xs bg-amber-500/20 border border-amber-400 text-amber-300 font-semibold"
                >
                  CLEAR SOLOS ({activeSoloCount})
                </button>
              )}
              <span className="text-slate-400">
                SEL:{' '}
                <strong className="text-sky-300">
                  CH {String(selectedChannel?.index ?? 1).padStart(2, '0')} · {selectedChannel?.name}
                </strong>
              </span>
            </div>
          </div>

          {/* Selected Channel Fat-Channel Processor */}
          {selectedChannel && (
            <div className="rounded border border-slate-800 bg-[#080B11] p-2.5 grid grid-cols-1 lg:grid-cols-12 gap-3 items-center">
              <div className="lg:col-span-3 space-y-1.5">
                <div className="flex items-center justify-between font-mono text-[10px]">
                  <span className="text-sky-400 font-semibold">
                    FAT-CHANNEL · CH {String(selectedChannel.index).padStart(2, '0')}
                  </span>
                  <span className={selectedChannel.authority === 'hardware-linked' ? 'text-emerald-400' : 'text-sky-300'}>
                    {selectedChannel.authority === 'hardware-linked' ? 'HW-LINK' : 'SW-DSP'}
                  </span>
                </div>
                <div className="text-xs font-semibold text-white truncate">{selectedChannel.name}</div>
                <div className="grid grid-cols-3 gap-1">
                  <ConsolePushButton
                    label={selectedChannel.padDb ? '-20 PAD' : '0dB'}
                    active={selectedChannel.padDb}
                    tone="amber"
                    onClick={() =>
                      onUpdateChannel(selectedChannel.id, { padDb: !selectedChannel.padDb })
                    }
                  />
                  <ConsolePushButton
                    label={selectedChannel.polarityInverted ? '180° Ø' : '0° Ø'}
                    active={selectedChannel.polarityInverted}
                    tone="amber"
                    onClick={() =>
                      onUpdateChannel(selectedChannel.id, {
                        polarityInverted: !selectedChannel.polarityInverted,
                      })
                    }
                  />
                  <ConsolePushButton
                    label={selectedChannel.stereoLinked ? 'LINK' : 'MONO'}
                    active={selectedChannel.stereoLinked}
                    tone="sky"
                    onClick={() =>
                      onUpdateChannel(selectedChannel.id, {
                        stereoLinked: !selectedChannel.stereoLinked,
                      })
                    }
                  />
                </div>
                <select
                  aria-label="Channel DCA Assignment"
                  value={selectedChannel.dcaGroup}
                  onChange={(e) =>
                    onUpdateChannel(selectedChannel.id, {
                      dcaGroup: e.target.value as DcaGroupName,
                    })
                  }
                  className="w-full px-2 py-1 rounded bg-[#0D1119] border border-slate-800 text-[10px] font-mono text-slate-200 focus:outline-none"
                >
                  <option value="None">DCA: Unassigned</option>
                  {dcaGroups.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>

              <div className="lg:col-span-9 grid grid-cols-4 sm:grid-cols-8 gap-1.5 place-items-center">
                <RotaryKnob
                  label="EQ LOW"
                  value={selectedChannel.eqLowDb}
                  min={-12}
                  max={12}
                  step={0.5}
                  defaultValue={0}
                  unit="dB"
                  size={38}
                  accent="sky"
                  onChange={(v) => onUpdateChannel(selectedChannel.id, { eqLowDb: v })}
                />
                <RotaryKnob
                  label="EQ MID"
                  value={selectedChannel.eqMidDb}
                  min={-12}
                  max={12}
                  step={0.5}
                  defaultValue={0}
                  unit="dB"
                  size={38}
                  accent="sky"
                  onChange={(v) => onUpdateChannel(selectedChannel.id, { eqMidDb: v })}
                />
                <RotaryKnob
                  label="MID FRQ"
                  value={selectedChannel.eqMidFreqHz}
                  min={120}
                  max={6000}
                  step={20}
                  defaultValue={400}
                  size={38}
                  accent="amber"
                  formatValue={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`)}
                  onChange={(v) => onUpdateChannel(selectedChannel.id, { eqMidFreqHz: v })}
                />
                <RotaryKnob
                  label="EQ HI"
                  value={selectedChannel.eqHighDb}
                  min={-12}
                  max={12}
                  step={0.5}
                  defaultValue={0}
                  unit="dB"
                  size={38}
                  accent="sky"
                  onChange={(v) => onUpdateChannel(selectedChannel.id, { eqHighDb: v })}
                />
                <RotaryKnob
                  label="GATE"
                  value={selectedChannel.gateThresholdDb}
                  min={-70}
                  max={-10}
                  step={1}
                  defaultValue={-54}
                  unit="dB"
                  size={38}
                  accent="amber"
                  onChange={(v) => onUpdateChannel(selectedChannel.id, { gateThresholdDb: v })}
                />
                <RotaryKnob
                  label="COMP"
                  value={selectedChannel.compThresholdDb}
                  min={-40}
                  max={0}
                  step={1}
                  defaultValue={-18}
                  unit="dB"
                  size={38}
                  accent="emerald"
                  onChange={(v) => onUpdateChannel(selectedChannel.id, { compThresholdDb: v })}
                />
                <RotaryKnob
                  label="MON 1"
                  value={selectedChannel.auxSends.stageMon1Db}
                  min={-48}
                  max={6}
                  step={1}
                  defaultValue={-12}
                  unit="dB"
                  size={38}
                  accent="emerald"
                  onChange={(v) =>
                    onUpdateChannel(selectedChannel.id, {
                      auxSends: { ...selectedChannel.auxSends, stageMon1Db: v },
                    })
                  }
                />
                <RotaryKnob
                  label="STREAM"
                  value={selectedChannel.auxSends.streamBusDb}
                  min={-48}
                  max={6}
                  step={1}
                  defaultValue={0}
                  unit="dB"
                  size={38}
                  accent="sky"
                  onChange={(v) =>
                    onUpdateChannel(selectedChannel.id, {
                      auxSends: { ...selectedChannel.auxSends, streamBusDb: v },
                    })
                  }
                />
              </div>
            </div>
          )}

          {/* DCA Group Masters View OR Scrollable Channel Strips */}
          {consoleLayer === 'dca' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 flex-1">
              {dcaGroups.map((group) => {
                const members = channels.filter((c) => c.dcaGroup === group);
                const allMuted = members.length > 0 && members.every((m) => m.mute);
                const avgFader =
                  members.length > 0
                    ? Number(
                        (
                          members.reduce((acc, m) => acc + m.faderDb, 0) / members.length
                        ).toFixed(1)
                      )
                    : 0;
                return (
                  <div
                    key={group}
                    className="rounded-md border border-slate-800 bg-gradient-to-b from-[#151C28] to-[#0B0F17] p-3 flex flex-col justify-between gap-3"
                  >
                    <div>
                      <div className="font-mono text-[10px] text-sky-400 uppercase">
                        {members.length} ASSIGNED CHANNELS
                      </div>
                      <div className="text-sm font-semibold text-white mt-0.5">{group}</div>
                      <div className="text-[10px] font-mono text-slate-400 mt-1 truncate">
                        {members.length > 0
                          ? members.map((m) => `CH${m.index}`).join(' · ')
                          : 'No channels assigned'}
                      </div>
                    </div>

                    <div className="flex justify-center py-2 bg-[#080B11] rounded border border-slate-800">
                      <VerticalFader
                        label={`${group} Trim`}
                        value={avgFader}
                        min={-48}
                        max={10}
                        step={0.5}
                        defaultValue={0}
                        height={145}
                        disabled={members.length === 0}
                        accent={allMuted ? 'amber' : 'emerald'}
                        onChange={(nextVal) => {
                          const delta = nextVal - avgFader;
                          members.forEach((m) => {
                            const updated = Math.max(
                              -48,
                              Math.min(10, Number((m.faderDb + delta).toFixed(1)))
                            );
                            onUpdateChannel(m.id, { faderDb: updated });
                          });
                        }}
                      />
                    </div>

                    <ConsolePushButton
                      label={allMuted ? 'DCA MUTED' : 'DCA ACTIVE'}
                      active={allMuted}
                      tone="red"
                      disabled={members.length === 0}
                      onClick={() =>
                        members.forEach((m) => onUpdateChannel(m.id, { mute: !allMuted }))
                      }
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="overflow-x-auto pb-1">
              <div className="flex gap-2.5 min-w-max">
                {channels.map((ch) => {
                  const isLocked = ch.authority === 'observational';
                  const isSelected = selectedChannel?.id === ch.id;

                  return (
                    <div
                      key={ch.id}
                      onClick={() => setSelectedChannelId(ch.id)}
                      className={`w-[138px] shrink-0 rounded-md border bg-gradient-to-b from-[#151C28] via-[#10151F] to-[#0B0F17] p-2.5 flex flex-col justify-between gap-2.5 shadow-inner cursor-pointer transition-colors ${
                        isSelected
                          ? 'border-sky-400/70 shadow-[0_0_12px_rgba(56,189,248,0.16)]'
                          : 'border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      {/* Scribble Strip */}
                      <div className="rounded-xs bg-[#070A0F] border border-slate-800 px-2 py-1.5 text-center">
                        <div className="flex items-center justify-between font-mono text-[9px] text-slate-400">
                          <span>CH {String(ch.index).padStart(2, '0')}</span>
                          <div className="flex items-center gap-1">
                            {automatedChannelIds.has(ch.id) && (
                              <span
                                className={`px-1 rounded-xs text-[8px] font-bold ${
                                  transportMode === 'recording'
                                    ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                                    : transportMode === 'playing'
                                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                      : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                                }`}
                              >
                                AUTO
                              </span>
                            )}
                            <span
                              className={
                                ch.authority === 'hardware-linked'
                                  ? 'text-emerald-400'
                                  : 'text-sky-400'
                              }
                            >
                              {ch.authority === 'hardware-linked' ? 'HW-LINK' : 'SW-DSP'}
                            </span>
                          </div>
                        </div>
                        <div
                          className="text-xs font-semibold text-slate-100 truncate mt-0.5"
                          title={ch.name}
                        >
                          {ch.name}
                        </div>
                        <div className="text-[10px] text-slate-500 truncate">{ch.role}</div>
                      </div>

                      {/* Layer-Dependent Strip Encoders */}
                      {consoleLayer === 'mix' && (
                        <>
                          <div className="grid grid-cols-2 gap-1 py-1 border-y border-slate-800/80">
                            <RotaryKnob
                              label="GAIN"
                              value={ch.gainDb}
                              min={-12}
                              max={54}
                              step={1}
                              defaultValue={24}
                              unit="dB"
                              size={42}
                              accent="sky"
                              disabled={isLocked}
                              onChange={(next) => onUpdateChannel(ch.id, { gainDb: next })}
                            />
                            <RotaryKnob
                              label="HPF"
                              value={ch.hpfHz}
                              min={20}
                              max={300}
                              step={5}
                              defaultValue={100}
                              unit="Hz"
                              size={42}
                              accent="amber"
                              disabled={isLocked}
                              onChange={(next) => onUpdateChannel(ch.id, { hpfHz: next })}
                            />
                          </div>

                          <div className="flex items-center justify-between gap-1 px-0.5">
                            <RotaryKnob
                              label="PAN"
                              value={ch.pan}
                              min={-100}
                              max={100}
                              step={5}
                              defaultValue={0}
                              size={38}
                              accent="emerald"
                              disabled={isLocked}
                              formatValue={(v) =>
                                v === 0
                                  ? 'C'
                                  : v < 0
                                    ? `L${Math.abs(Math.round(v))}`
                                    : `R${Math.round(v)}`
                              }
                              onChange={(next) => onUpdateChannel(ch.id, { pan: next })}
                            />
                            <div className="flex flex-col gap-1.5 flex-1">
                              <ConsolePushButton
                                label="+48V"
                                active={ch.phantom48v}
                                tone="amber"
                                disabled={!device.capabilities.phantomPowerControl}
                                onClick={() =>
                                  onUpdateChannel(ch.id, { phantom48v: !ch.phantom48v })
                                }
                              />
                              <ConsolePushButton
                                label={ch.solo ? 'SOLO' : 'PFL'}
                                active={ch.solo}
                                tone="amber"
                                onClick={() => onUpdateChannel(ch.id, { solo: !ch.solo })}
                              />
                            </div>
                          </div>
                        </>
                      )}

                      {consoleLayer === 'eq-dyn' && (
                        <>
                          <div className="grid grid-cols-2 gap-1 py-1 border-y border-slate-800/80">
                            <RotaryKnob
                              label="EQ LOW"
                              value={ch.eqLowDb}
                              min={-12}
                              max={12}
                              step={0.5}
                              defaultValue={0}
                              unit="dB"
                              size={40}
                              accent="sky"
                              onChange={(next) => onUpdateChannel(ch.id, { eqLowDb: next })}
                            />
                            <RotaryKnob
                              label="EQ HI"
                              value={ch.eqHighDb}
                              min={-12}
                              max={12}
                              step={0.5}
                              defaultValue={0}
                              unit="dB"
                              size={40}
                              accent="sky"
                              onChange={(next) => onUpdateChannel(ch.id, { eqHighDb: next })}
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-1 pb-1 border-b border-slate-800/80">
                            <RotaryKnob
                              label="GATE"
                              value={ch.gateThresholdDb}
                              min={-70}
                              max={-10}
                              step={1}
                              defaultValue={-54}
                              unit="dB"
                              size={38}
                              accent="amber"
                              onChange={(next) =>
                                onUpdateChannel(ch.id, { gateThresholdDb: next })
                              }
                            />
                            <RotaryKnob
                              label="COMP"
                              value={ch.compThresholdDb}
                              min={-40}
                              max={0}
                              step={1}
                              defaultValue={-18}
                              unit="dB"
                              size={38}
                              accent="emerald"
                              onChange={(next) =>
                                onUpdateChannel(ch.id, { compThresholdDb: next })
                              }
                            />
                          </div>
                        </>
                      )}

                      {consoleLayer === 'aux' && (
                        <>
                          <div className="grid grid-cols-2 gap-1 py-1 border-y border-slate-800/80">
                            <RotaryKnob
                              label="MON 1"
                              value={ch.auxSends.stageMon1Db}
                              min={-48}
                              max={6}
                              step={1}
                              defaultValue={-12}
                              unit="dB"
                              size={40}
                              accent="emerald"
                              onChange={(next) =>
                                onUpdateChannel(ch.id, {
                                  auxSends: { ...ch.auxSends, stageMon1Db: next },
                                })
                              }
                            />
                            <RotaryKnob
                              label="MON 2"
                              value={ch.auxSends.stageMon2Db}
                              min={-48}
                              max={6}
                              step={1}
                              defaultValue={-12}
                              unit="dB"
                              size={40}
                              accent="emerald"
                              onChange={(next) =>
                                onUpdateChannel(ch.id, {
                                  auxSends: { ...ch.auxSends, stageMon2Db: next },
                                })
                              }
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-1 pb-1 border-b border-slate-800/80">
                            <RotaryKnob
                              label="STREAM"
                              value={ch.auxSends.streamBusDb}
                              min={-48}
                              max={6}
                              step={1}
                              defaultValue={0}
                              unit="dB"
                              size={38}
                              accent="sky"
                              onChange={(next) =>
                                onUpdateChannel(ch.id, {
                                  auxSends: { ...ch.auxSends, streamBusDb: next },
                                })
                              }
                            />
                            <RotaryKnob
                              label="SUBS"
                              value={ch.auxSends.subsDb}
                              min={-48}
                              max={6}
                              step={1}
                              defaultValue={-48}
                              unit="dB"
                              size={38}
                              accent="amber"
                              onChange={(next) =>
                                onUpdateChannel(ch.id, {
                                  auxSends: { ...ch.auxSends, subsDb: next },
                                })
                              }
                            />
                          </div>
                        </>
                      )}

                      {/* High-Frequency 60fps CSS Visual VU Meter + Long-Throw Vertical Fader */}
                      <div className="flex items-center justify-center gap-2.5 py-1.5 bg-[#080B11] rounded border border-slate-800/80 px-1.5">
                        <div className="flex flex-col items-center gap-1">
                          {/* Peak Clip LED */}
                          <div
                            ref={(el) => registerChannelRef(ch.id, 'clip', el)}
                            className="w-3.5 h-1.5 rounded-full bg-slate-800 transition-colors"
                            title="Channel Clip Indicator"
                          />
                          {/* CSS VU Meter Column */}
                          <div
                            aria-label={`${ch.name} RMS VU Meter`}
                            className="relative w-3.5 h-[154px] rounded-xs bg-[#05080D] border border-slate-800 overflow-hidden"
                          >
                            {/* Dynamic CSS Fill Height & Color Intensity */}
                            <div
                              ref={(el) => registerChannelRef(ch.id, 'fill', el)}
                              className="absolute bottom-0 inset-x-0 will-change-[height,filter,box-shadow]"
                              style={{
                                height: '0%',
                                background:
                                  'linear-gradient(to top, #059669 0%, #10B981 48%, #34D399 66%, #F59E0B 82%, #EF4444 96%)',
                              }}
                            />
                            {/* Segmented LED Grid Mask */}
                            <div
                              className="absolute inset-0 pointer-events-none"
                              style={{
                                backgroundImage:
                                  'repeating-linear-gradient(to top, transparent 0px, transparent 5px, rgba(5,8,13,0.92) 5px, rgba(5,8,13,0.92) 7px)',
                              }}
                            />
                            {/* Ballistic Peak-Hold Line */}
                            <div
                              ref={(el) => registerChannelRef(ch.id, 'peak', el)}
                              className="absolute inset-x-0 h-[2px] pointer-events-none will-change-[bottom,opacity]"
                              style={{ bottom: '0%', opacity: 0 }}
                            />
                          </div>
                          {/* Live RMS dB Telemetry Readout */}
                          <span
                            ref={(el) => registerChannelRef(ch.id, 'readout', el)}
                            className="font-mono text-[9px] tabular-nums text-sky-400 leading-none"
                          >
                            -∞
                          </span>
                        </div>

                        <VerticalFader
                          label={`${ch.name} Fader`}
                          value={ch.faderDb}
                          min={-48}
                          max={10}
                          step={0.5}
                          defaultValue={0}
                          height={166}
                          disabled={isLocked}
                          accent={ch.mute ? 'amber' : 'sky'}
                          onChange={(next) => onUpdateChannel(ch.id, { faderDb: next })}
                        />
                      </div>

                      {/* Mute Switch */}
                      <ConsolePushButton
                        label={ch.mute ? 'MUTED' : 'ON / LIVE'}
                        active={ch.mute}
                        tone="red"
                        onClick={() => onUpdateChannel(ch.id, { mute: !ch.mute })}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right Master Bus & Output Protection Section */}
        <div className="xl:col-span-3 rounded-lg border border-slate-800 bg-gradient-to-b from-[#141B27] to-[#0B0F17] p-3.5 flex flex-col justify-between gap-3">
          <div className="border-b border-slate-800 pb-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-semibold text-white uppercase tracking-wider">
                Master Bus &amp; Limiter
              </span>
              <span className="font-mono text-[10px] text-emerald-400">
                {telemetry.isRunning ? `${telemetry.estimatedLufs.toFixed(1)} LUFS` : 'STANDBY'}
              </span>
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              CamillaDSP Protective Output Stage
            </div>
          </div>

          {/* Master Rotary Controls */}
          <div className="grid grid-cols-3 gap-2 py-1">
            <RotaryKnob
              label="TRIM"
              value={dsp.inputTrimDb}
              min={-12}
              max={12}
              step={0.5}
              defaultValue={0}
              unit="dB"
              size={50}
              accent="sky"
              onChange={(next) => onUpdateDsp({ inputTrimDb: next })}
            />
            <RotaryKnob
              label="CEILING"
              value={dsp.limiter.ceilingDb}
              min={-6}
              max={0}
              step={0.2}
              defaultValue={-0.8}
              unit="dBFS"
              size={50}
              accent="amber"
              onChange={(next) =>
                onUpdateDsp({ limiter: { ...dsp.limiter, enabled: true, ceilingDb: next } })
              }
            />
            <RotaryKnob
              label="DELAY"
              value={dsp.masterDelayMs}
              min={0}
              max={120}
              step={0.5}
              defaultValue={0}
              unit="ms"
              size={50}
              accent="emerald"
              onChange={(next) => onUpdateDsp({ masterDelayMs: next })}
            />
          </div>

          {/* Twin 60fps Master CSS VU Meters + Master Fader */}
          <div className="flex items-center justify-around py-2.5 bg-[#080B11] border border-slate-800 rounded-md">
            {[
              { label: 'PRE', fillKey: 'preFill' as const, peakKey: 'prePeak' as const, color: 'text-slate-400' },
              { label: 'POST L', fillKey: 'postLFill' as const, peakKey: 'postLPeak' as const, color: 'text-sky-400' },
              { label: 'POST R', fillKey: 'postRFill' as const, peakKey: 'postRPeak' as const, color: 'text-sky-400' },
            ].map((m) => (
              <div key={m.label} className="flex flex-col items-center gap-1">
                <div className="relative w-3.5 h-[158px] rounded-xs bg-[#05080D] border border-slate-800 overflow-hidden">
                  <div
                    ref={(el) => {
                      masterRefs.current[m.fillKey] = el;
                    }}
                    className="absolute bottom-0 inset-x-0 will-change-[height,filter,box-shadow]"
                    style={{
                      height: '0%',
                      background:
                        'linear-gradient(to top, #059669 0%, #10B981 50%, #34D399 68%, #F59E0B 82%, #EF4444 96%)',
                    }}
                  />
                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      backgroundImage:
                        'repeating-linear-gradient(to top, transparent 0px, transparent 5px, rgba(5,8,13,0.92) 5px, rgba(5,8,13,0.92) 7px)',
                    }}
                  />
                  <div
                    ref={(el) => {
                      masterRefs.current[m.peakKey] = el;
                    }}
                    className="absolute inset-x-0 h-[2px] pointer-events-none will-change-[bottom,opacity]"
                    style={{ bottom: '0%', opacity: 0 }}
                  />
                </div>
                <span className={`font-mono text-[9px] ${m.color}`}>{m.label}</span>
              </div>
            ))}

            <VerticalFader
              label="Master Trim Fader"
              value={dsp.inputTrimDb}
              min={-24}
              max={12}
              step={0.5}
              defaultValue={0}
              height={158}
              accent="emerald"
              onChange={(next) => onUpdateDsp({ inputTrimDb: next })}
            />
          </div>

          {/* Protection Telemetry & Output Switches */}
          <div className="space-y-2">
            <div className="flex items-center justify-between px-2.5 py-1.5 rounded bg-[#080B11] border border-slate-800 text-[11px] font-mono">
              <span className="text-slate-400">OUTPUT PROTECTION</span>
              <span
                className={`flex items-center gap-1 font-semibold ${
                  telemetry.clippingEvents > 0 ? 'text-red-400' : 'text-emerald-400'
                }`}
              >
                {telemetry.clippingEvents > 0 ? (
                  <>
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>{telemetry.clippingEvents} CLIPS</span>
                  </>
                ) : (
                  <span>CLIP FREE</span>
                )}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              <ConsolePushButton
                label={dsp.polarityInverted ? 'Ø 180°' : '0° PHS'}
                active={dsp.polarityInverted}
                tone="amber"
                onClick={() => onUpdateDsp({ polarityInverted: !dsp.polarityInverted })}
              />
              <ConsolePushButton
                label={dsp.limiter.enabled ? 'LIMITER' : 'LIM OFF'}
                active={dsp.limiter.enabled}
                tone="emerald"
                onClick={() =>
                  onUpdateDsp({ limiter: { ...dsp.limiter, enabled: !dsp.limiter.enabled } })
                }
              />
              <ConsolePushButton
                label={talkbackActive ? 'TB LIVE' : 'TALKBACK'}
                active={talkbackActive}
                tone="sky"
                onClick={() => {
                  const next = !talkbackActive;
                  setTalkbackActive(next);
                  onLogAutomationEvent?.(
                    next ? 'Engaged Stage Talkback' : 'Released Stage Talkback',
                    `Cue monitor level ${cueLevelDb} dB`
                  );
                }}
              />
            </div>

            <div className="flex items-center justify-between px-2.5 py-1.5 rounded bg-[#080B11] border border-slate-800">
              <span className="font-mono text-[10px] text-slate-400">CUE / PFL MONITOR</span>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-sky-400 tabular-nums">{cueLevelDb} dB</span>
                <input
                  type="range"
                  aria-label="Cue Monitor Level"
                  min={-36}
                  max={6}
                  step={1}
                  value={cueLevelDb}
                  onChange={(e) => setCueLevelDb(Number(e.target.value))}
                  className="w-20 accent-sky-400 cursor-pointer"
                />
              </div>
            </div>

            {onToggleEmergencyMute && (
              <button
                type="button"
                onClick={onToggleEmergencyMute}
                className={`w-full py-2 rounded-xs border text-xs font-mono font-semibold flex items-center justify-center gap-1.5 transition-all ${
                  emergencyMuted
                    ? 'bg-red-600 border-red-400 text-white shadow-[0_0_12px_rgba(239,68,68,0.45)]'
                    : 'bg-[#121722] border-red-500/40 text-red-400 hover:bg-red-500/10'
                }`}
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>{emergencyMuted ? 'MASTER PA MUTED' : 'EMERGENCY SAFE MUTE'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

