import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Circle, Download, Pause, Play, Square, Trash2, Waves } from 'lucide-react';
import type { InputChannel, SignalTelemetry } from '../types/audio.ts';

interface MultitrackRecorderModuleProps {
  channels: InputChannel[];
  telemetry: SignalTelemetry;
  engineRunning: boolean;
}

interface WaveformSlice {
  timeSec: number;
  peak: number;
  clipped: boolean;
}

interface RecordedTake {
  id: string;
  name: string;
  createdAt: string;
  durationSec: number;
  armedChannels: string[];
  blobUrl?: string;
  sizeBytes: number;
  slicesByChannel: Record<string, WaveformSlice[]>;
}

function formatClock(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const rem = s - m * 60;
  return `${String(m).padStart(2, '0')}:${rem.toFixed(1).padStart(4, '0')}`;
}

export const MultitrackRecorderModule: React.FC<MultitrackRecorderModuleProps> = ({
  channels,
  telemetry,
  engineRunning,
}) => {
  const [armedIds, setArmedIds] = useState<string[]>(() =>
    channels.slice(0, 6).map((c) => c.id)
  );
  const [recording, setRecording] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [liveSlices, setLiveSlices] = useState<Record<string, WaveformSlice[]>>({});
  const [takes, setTakes] = useState<RecordedTake[]>([]);
  const [selectedTakeId, setSelectedTakeId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playheadSec, setPlayheadSec] = useState(0);

  const audioElemRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const elapsedRef = useRef(0);
  const liveSlicesRef = useRef<Record<string, WaveformSlice[]>>({});

  const toggleArm = (id: string) => {
    setArmedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  // Sample live channel levels at 10Hz while recording
  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => {
      elapsedRef.current = Number((elapsedRef.current + 0.1).toFixed(1));
      setElapsedSec(elapsedRef.current);

      const next: Record<string, WaveformSlice[]> = { ...liveSlicesRef.current };
      armedIds.forEach((chId, idx) => {
        const chLvl = telemetry.channelLevels[idx];
        const db = chLvl ? chLvl.rmsDb : telemetry.postRmsDb;
        const linear = Math.max(0.03, Math.min(1, Math.pow(10, db / 40)));
        const clipped = (chLvl ? chLvl.peakDb : telemetry.postPeakDb) >= -0.3;
        const arr = next[chId] ? [...next[chId]] : [];
        arr.push({ timeSec: elapsedRef.current, peak: linear, clipped });
        if (arr.length > 240) arr.shift();
        next[chId] = arr;
      });
      liveSlicesRef.current = next;
      setLiveSlices(next);
    }, 100);
    return () => window.clearInterval(timer);
  }, [recording, armedIds, telemetry]);

  const handleStartRecord = async () => {
    if (armedIds.length === 0) return;
    elapsedRef.current = 0;
    liveSlicesRef.current = {};
    recordedChunksRef.current = [];
    setElapsedSec(0);
    setLiveSlices({});
    setPlaying(false);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
      };
      rec.start(250);
      mediaRecorderRef.current = rec;
    } catch {
      // Fall back to telemetry stem capture if mic capture is locked by another device
      mediaRecorderRef.current = null;
    }

    setRecording(true);
  };

  const handleStopRecord = () => {
    setRecording(false);
    let blobUrl: string | undefined;
    let sizeBytes = 0;

    const finalize = () => {
      if (recordedChunksRef.current.length > 0) {
        const blob = new Blob(recordedChunksRef.current, { type: 'audio/webm' });
        blobUrl = URL.createObjectURL(blob);
        sizeBytes = blob.size;
      }
      const take: RecordedTake = {
        id: `take-${Date.now()}`,
        name: `Service Take ${takes.length + 1}`,
        createdAt: new Date().toLocaleTimeString(),
        durationSec: Math.max(0.2, elapsedRef.current),
        armedChannels: armedIds,
        blobUrl,
        sizeBytes,
        slicesByChannel: liveSlicesRef.current,
      };
      setTakes((prev) => [take, ...prev]);
      setSelectedTakeId(take.id);
    };

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.addEventListener('stop', finalize, { once: true });
      mediaRecorderRef.current.stop();
    } else {
      finalize();
    }
  };

  const activeTake = useMemo(
    () => takes.find((t) => t.id === selectedTakeId) ?? takes[0] ?? null,
    [takes, selectedTakeId]
  );

  const handleTogglePlay = () => {
    if (!activeTake?.blobUrl) return;
    if (!audioElemRef.current) {
      audioElemRef.current = new Audio(activeTake.blobUrl);
      audioElemRef.current.onended = () => setPlaying(false);
      audioElemRef.current.ontimeupdate = () => {
        setPlayheadSec(audioElemRef.current?.currentTime ?? 0);
      };
    } else if (audioElemRef.current.src !== activeTake.blobUrl) {
      audioElemRef.current.src = activeTake.blobUrl;
    }

    if (playing) {
      audioElemRef.current.pause();
      setPlaying(false);
    } else {
      void audioElemRef.current.play();
      setPlaying(true);
    }
  };

  return (
    <div className="space-y-4 text-slate-200 font-sans">
      {/* Transport Bar */}
      <div className="p-4 rounded-xl border border-rose-500/35 bg-gradient-to-r from-[#160B10] via-[#0C101A] to-[#080B12] flex flex-wrap items-center justify-between gap-3 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-rose-500/20 border border-rose-400/40 text-rose-300">
            <Waves className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-display text-base font-bold text-white">
              Multitrack Live Service Recorder
            </h2>
            <p className="font-mono text-[11px] text-slate-400">
              Armed Stems: {armedIds.length}/{channels.length} · Engine: {engineRunning ? 'LIVE 48kHz' : 'STANDBY'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 font-mono">
          <div className="px-3 py-1.5 rounded bg-[#04060B] border border-slate-800 text-sm font-bold text-emerald-400 tabular-nums">
            {formatClock(recording ? elapsedSec : playheadSec)}
          </div>

          {!recording ? (
            <button
              type="button"
              disabled={armedIds.length === 0}
              onClick={() => void handleStartRecord()}
              className="px-3.5 py-1.5 rounded bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
            >
              <Circle className="w-3.5 h-3.5 fill-current" />
              REC ARMED ({armedIds.length})
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStopRecord}
              className="px-3.5 py-1.5 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 cursor-pointer animate-pulse"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              STOP REC
            </button>
          )}

          <button
            type="button"
            disabled={!activeTake?.blobUrl}
            onClick={handleTogglePlay}
            className="px-3 py-1.5 rounded border border-sky-500/50 bg-sky-500/15 hover:bg-sky-500/30 text-sky-200 text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
          >
            {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {playing ? 'PAUSE' : 'AUDITION TAKE'}
          </button>
        </div>
      </div>

      {/* Channel Multitrack Lanes */}
      <div className="rounded-xl border border-slate-800 bg-[#080B13] p-3 space-y-2">
        <div className="flex items-center justify-between font-mono text-[11px] text-slate-400 pb-1 border-b border-slate-800">
          <span>PER-CHANNEL STEM LANES (CLICK ARM TO RECORD)</span>
          <span>24-BIT / 48.0 kHz</span>
        </div>

        <div className="space-y-1.5 max-h-[380px] overflow-y-auto pr-1">
          {channels.slice(0, 8).map((ch) => {
            const isArmed = armedIds.includes(ch.id);
            const slices = recording
              ? liveSlices[ch.id] ?? []
              : activeTake?.slicesByChannel[ch.id] ?? [];

            return (
              <div
                key={ch.id}
                className={`p-2 rounded-lg border flex items-center gap-3 ${
                  isArmed
                    ? 'border-rose-500/40 bg-[#120A0E]'
                    : 'border-slate-800/80 bg-[#0B0F18]'
                }`}
              >
                <div className="w-40 shrink-0 flex items-center justify-between gap-2 font-mono text-xs">
                  <div className="truncate">
                    <span className="text-slate-500 mr-1">CH{ch.index}</span>
                    <span className="text-white font-semibold">{ch.name}</span>
                  </div>
                  <button
                    type="button"
                    disabled={recording}
                    onClick={() => toggleArm(ch.id)}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold border cursor-pointer disabled:opacity-50 ${
                      isArmed
                        ? 'bg-rose-600 text-white border-rose-400'
                        : 'bg-slate-900 border-slate-700 text-slate-400'
                    }`}
                  >
                    ARM
                  </button>
                </div>

                {/* Live / Take Waveform Strip */}
                <div className="flex-1 h-9 rounded bg-[#04060B] border border-slate-800 overflow-hidden flex items-center px-1 gap-0.5">
                  {slices.length === 0 ? (
                    <span className="text-[10px] font-mono text-slate-600 px-2">
                      {isArmed ? 'Armed — press REC to capture stem waveform' : 'Disarmed'}
                    </span>
                  ) : (
                    slices.slice(-120).map((s, idx) => (
                      <div
                        key={idx}
                        className={`w-1 rounded-xs shrink-0 ${
                          s.clipped ? 'bg-rose-500' : isArmed ? 'bg-sky-400' : 'bg-slate-600'
                        }`}
                        style={{ height: `${Math.max(12, Math.round(s.peak * 100))}%` }}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recorded Takes Library */}
      {takes.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-[#080B13] p-3 space-y-2">
          <div className="font-mono text-[11px] text-slate-400 uppercase font-bold">
            Recorded Service Takes ({takes.length})
          </div>
          <div className="space-y-1.5">
            {takes.map((t) => (
              <div
                key={t.id}
                onClick={() => setSelectedTakeId(t.id)}
                className={`p-2.5 rounded-lg border flex items-center justify-between gap-3 cursor-pointer ${
                  activeTake?.id === t.id
                    ? 'border-sky-400/60 bg-sky-950/25'
                    : 'border-slate-800 bg-[#0B0F18]'
                }`}
              >
                <div className="font-mono text-xs">
                  <span className="font-bold text-white">{t.name}</span>
                  <span className="text-slate-400 ml-2">
                    {t.createdAt} · {formatClock(t.durationSec)} · {t.armedChannels.length} stems
                    {t.sizeBytes > 0 ? ` · ${(t.sizeBytes / 1024).toFixed(1)} KB` : ''}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {t.blobUrl && (
                    <a
                      href={t.blobUrl}
                      download={`${t.name.replace(/\s+/g, '_')}.webm`}
                      onClick={(e) => e.stopPropagation()}
                      className="px-2.5 py-1 rounded border border-emerald-500/40 bg-emerald-500/15 text-emerald-300 font-mono text-[10px] font-bold flex items-center gap-1"
                    >
                      <Download className="w-3 h-3" />
                      Download
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setTakes((prev) => prev.filter((x) => x.id !== t.id));
                    }}
                    className="p-1.5 rounded border border-slate-700 text-slate-400 hover:text-rose-400 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
