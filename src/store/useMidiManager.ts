import { useCallback, useEffect, useState } from 'react';
import type {
  AuditAuthority,
  DspConfig,
  InputChannel,
  MidiDeviceInfo,
  MidiMapping,
  MidiPacket,
} from '../types/audio.ts';
import { DEFAULT_MIDI_MAPPINGS, midiEngine, scaleMidiValue } from '../midi/midiEngine.ts';
import { appFetch } from '../utils/appApi.ts';
import { liveAudioEngine } from '../audio/liveAudioEngine.ts';

interface UseMidiManagerProps {
  onUpdateDsp: (updater: (prev: DspConfig) => DspConfig) => void;
  onUpdateChannels: (updater: (prev: InputChannel[]) => InputChannel[]) => void;
  onUpdateEmergencyMute: (updater: (prev: boolean) => boolean) => void;
  logAudit: (action: string, detail: string, authority?: AuditAuthority) => void;
}

export function useMidiManager({
  onUpdateDsp,
  onUpdateChannels,
  onUpdateEmergencyMute,
  logAudit,
}: UseMidiManagerProps) {
  const [midiDevices, setMidiDevices] = useState<MidiDeviceInfo[]>([]);
  const [midiConnected, setMidiConnected] = useState(false);
  const [midiError, setMidiError] = useState<string | null>(null);
  const [midiMappings, setMidiMappings] = useState<MidiMapping[]>(DEFAULT_MIDI_MAPPINGS);
  const [midiLearningId, setMidiLearningId] = useState<string | null>(null);
  const [lastMidiPacket, setLastMidiPacket] = useState<MidiPacket | null>(null);

  const updateAndPersistMidiMappings = useCallback((next: MidiMapping[]) => {
    setMidiMappings(next);
    appFetch('/api/midi-mappings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mappings: next }),
    }).catch(() => {});
  }, []);

  const handleRequestMidiAccess = async () => {
    setMidiError(null);
    const res = await midiEngine.requestAccess();
    if (!res.ok) {
      setMidiError(res.error || 'Unable to access Web MIDI hardware.');
      return;
    }
    setMidiDevices(res.devices);
    setMidiConnected(true);
    logAudit('Connected Web MIDI Host', `${res.devices.length} MIDI ports discovered`, 'operator');
  };

  useEffect(() => {
    const unsubDevices = midiEngine.subscribeDevices((devs) => {
      setMidiDevices(devs);
    });

    const unsubPackets = midiEngine.subscribePackets((packet) => {
      setLastMidiPacket(packet);

      if (midiLearningId) {
        setMidiMappings((prev) => {
          const next = prev.map((m) =>
            m.id === midiLearningId
              ? {
                  ...m,
                  deviceName: packet.deviceName,
                  channel: packet.channel,
                  messageType: packet.messageType,
                  controller: packet.controller,
                  lastRawValue: packet.rawValue,
                  lastUpdatedAt: packet.timestamp,
                }
              : m
          );
          appFetch('/api/midi-mappings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mappings: next }),
          }).catch(() => {});
          return next;
        });
        setMidiLearningId(null);
        return;
      }

      // Match active bindings and drive live parameters
      setMidiMappings((prev) =>
        prev.map((m) => {
          if (!m.enabled) return m;
          if (
            m.channel !== packet.channel ||
            m.messageType !== packet.messageType ||
            m.controller !== packet.controller
          ) {
            return m;
          }

          const val = scaleMidiValue(packet.rawValue, m);
          const isPressed = packet.rawValue > 63;

          if (m.target === 'dsp.inputTrimDb') {
            onUpdateDsp((d) => ({ ...d, inputTrimDb: val }));
          } else if (m.target === 'dsp.hpfHz') {
            onUpdateDsp((d) => ({ ...d, hpfEnabled: true, hpfHz: Math.round(val) }));
          } else if (m.target.startsWith('dsp.eqBand')) {
            const bandNum = Number(m.target.charAt(10)) - 1;
            onUpdateDsp((d) => ({
              ...d,
              eqBands: d.eqBands.map((b, i) =>
                i === bandNum ? { ...b, enabled: true, gainDb: val } : b
              ),
            }));
          } else if (m.target === 'dsp.compressor.thresholdDb') {
            onUpdateDsp((d) => ({
              ...d,
              compressor: { ...d.compressor, enabled: true, thresholdDb: Math.round(val) },
            }));
          } else if (m.target === 'dsp.limiter.ceilingDb') {
            onUpdateDsp((d) => ({
              ...d,
              limiter: { ...d.limiter, enabled: true, ceilingDb: val },
            }));
          } else if (m.target === 'dsp.bypassed') {
            if (m.mode === 'toggle' && isPressed) {
              onUpdateDsp((d) => {
                const nextBypass = !d.bypassed;
                midiEngine.sendFeedback(m.channel, m.messageType, m.controller, nextBypass ? 127 : 0);
                return { ...d, bypassed: nextBypass };
              });
            } else if (m.mode === 'momentary') {
              onUpdateDsp((d) => ({ ...d, bypassed: isPressed }));
            }
          } else if (m.target === 'master.emergencyMute') {
            if ((m.mode === 'toggle' && isPressed) || m.mode === 'momentary') {
              onUpdateEmergencyMute((prevMute) => {
                const nextMute = m.mode === 'toggle' ? !prevMute : isPressed;
                liveAudioEngine.setEmergencyMute(nextMute);
                midiEngine.sendFeedback(m.channel, m.messageType, m.controller, nextMute ? 127 : 0);
                return nextMute;
              });
            }
          } else if (m.target === 'channel.1.faderDb' || m.target === 'channel.2.faderDb') {
            const chIdx = m.target === 'channel.1.faderDb' ? 0 : 1;
            onUpdateChannels((chs) =>
              chs.map((c, i) => (i === chIdx ? { ...c, faderDb: val } : c))
            );
          } else if (m.target === 'channel.1.mute' || m.target === 'channel.2.mute') {
            const chIdx = m.target === 'channel.1.mute' ? 0 : 1;
            if ((m.mode === 'toggle' && isPressed) || m.mode === 'momentary') {
              onUpdateChannels((chs) =>
                chs.map((c, i) =>
                  i === chIdx ? { ...c, mute: m.mode === 'toggle' ? !c.mute : isPressed } : c
                )
              );
            }
          }

          return { ...m, lastRawValue: packet.rawValue, lastUpdatedAt: packet.timestamp };
        })
      );
    });

    return () => {
      unsubDevices();
      unsubPackets();
    };
  }, [midiLearningId, onUpdateChannels, onUpdateDsp, onUpdateEmergencyMute]);

  return {
    midiDevices,
    midiConnected,
    midiError,
    midiMappings,
    setMidiMappings,
    midiLearningId,
    setMidiLearningId,
    lastMidiPacket,
    handleRequestMidiAccess,
    updateAndPersistMidiMappings,
  };
}
