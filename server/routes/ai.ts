import { Router } from 'express';
import { GoogleGenAI, Type } from '@google/genai';

export const aiRouter = Router();

function createGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in the server environment.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

aiRouter.post('/diagnose', async (req, res) => {
  try {
    const ai = createGeminiClient();
    const { telemetry, device, dsp, platform, driver, question } = req.body ?? {};

    const prompt = `You are a senior church acoustic & live sound engineer advising a sound operator.
Analyze the REAL measured signal telemetry, hardware capability boundaries, and active DSP configuration below.

HARDWARE PROFILE:
- Device: ${device?.manufacturer ?? 'Unknown'} ${device?.model ?? 'Mixer'} (${device?.tierLabel ?? 'Tier 1'})
- Platform & Driver: ${platform ?? 'windows'} / ${driver ?? 'WASAPI Exclusive'}
- Capabilities: perChannelFaderControl=${Boolean(device?.capabilities?.perChannelFaderControl)}, perChannelCapture=${Boolean(device?.capabilities?.perChannelCapture)}, stereoMixCapture=${Boolean(device?.capabilities?.stereoMixCapture)}
- Limitations: ${device?.capabilities?.limitationsNote ?? 'None specified'}

LIVE SIGNAL TELEMETRY:
- Source Mode: ${telemetry?.source ?? 'unknown'}
- Pre-DSP RMS / Peak: ${telemetry?.preRmsDb ?? -96} dBFS / ${telemetry?.prePeakDb ?? -96} dBFS
- Post-DSP RMS / Peak: ${telemetry?.postRmsDb ?? -96} dBFS / ${telemetry?.postPeakDb ?? -96} dBFS
- Estimated Loudness: ${telemetry?.estimatedLufs ?? -70} LUFS
- Feedback Risk: detected=${Boolean(telemetry?.feedbackRisk?.detected)}, freq=${telemetry?.feedbackRisk?.frequencyHz ?? 'none'} Hz, prominence=${telemetry?.feedbackRisk?.prominenceDb ?? 0} dB, persistence=${telemetry?.feedbackRisk?.persistenceSec ?? 0}s
- Mains Hum Risk: detected=${Boolean(telemetry?.humRisk?.detected)}, fundamental=${telemetry?.humRisk?.fundamentalHz ?? 'none'} Hz, 100Hz=${telemetry?.humRisk?.harmonic100Db ?? -96} dB, 150Hz=${telemetry?.humRisk?.harmonic150Db ?? -96} dB
- Low-Mid Mud Risk: detected=${Boolean(telemetry?.mudRisk?.detected)}, center=${telemetry?.mudRisk?.centerHz ?? 220} Hz, level=${telemetry?.mudRisk?.bandEnergyDb ?? -96} dB

ACTIVE DSP:
- Bypassed: ${Boolean(dsp?.bypassed)}
- HPF: ${dsp?.hpfEnabled ? `${dsp.hpfHz} Hz` : 'Disabled'}
- EQ Bands: ${JSON.stringify(dsp?.eqBands ?? [])}
- Compressor: enabled=${Boolean(dsp?.compressor?.enabled)}, thresh=${dsp?.compressor?.thresholdDb} dB, ratio=${dsp?.compressor?.ratio}:1
- Limiter Ceiling: ${dsp?.limiter?.ceilingDb ?? -1} dBFS

OPERATOR PROMPT: ${question || 'Perform a full evidence-based sound engineering diagnosis of the current signal and hardware state.'}

STRICT ENGINEERING RULES:
1. Never claim you can control physical faders or individual channels if perChannelFaderControl is false (e.g., Yamaha MG16XU stereo USB return).
2. Never blame EQ alone if physical microphone placement, DI ground lift, cable fault, or room reverberation is a primary suspect.
3. Propose at most ONE concrete, safe DSP adjustment (EQ band cut/boost or HPF change) within safe bounds (-12 to +6 dB, 20 to 16000 Hz) if justified by the measured evidence.
4. Explain clearly why and state confidence (0-100).`;

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            severity: { type: Type.STRING, description: 'One of: nominal, advisory, warning, critical' },
            category: { type: Type.STRING, description: 'One of: feedback, hum, acoustics, gain-staging, broadcast, hardware' },
            confidence: { type: Type.INTEGER },
            evidence: { type: Type.STRING },
            explanation: { type: Type.STRING },
            physicalChecks: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            proposedDspAction: {
              type: Type.OBJECT,
              properties: {
                shouldApply: { type: Type.BOOLEAN },
                description: { type: Type.STRING },
                hpfHz: { type: Type.NUMBER },
                eqFrequencyHz: { type: Type.NUMBER },
                eqGainDb: { type: Type.NUMBER },
                eqQ: { type: Type.NUMBER },
                eqLabel: { type: Type.STRING },
              },
            },
          },
        },
      },
    });

    const raw = (response.text ?? '{}').trim();
    const parsed = JSON.parse(raw);
    res.json({ ok: true, result: parsed });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AI diagnostic request failed.';
    res.status(500).json({ ok: false, error: message });
  }
});

aiRouter.post('/chat', async (req, res) => {
  try {
    const ai = createGeminiClient();
    const { message, context } = req.body ?? {};
    if (!message || typeof message !== 'string') {
      res.status(400).json({ ok: false, error: 'Message text is required.' });
      return;
    }

    const systemInstruction = `You are the AI Sound Engineer inside Church Audio Intelligence.
Always ground your answer in the live telemetry, connected hardware capabilities, and DSP state provided in context.
Be concise, practical, and explicit about hardware boundaries (for instance, if a console like the Yamaha MG16XU only sends stereo USB, state that individual mic faders must be adjusted physically on the mixer while master/bus DSP runs in CamillaDSP). Never fabricate measurements not present in the context.`;

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `SYSTEM CONTEXT:\n${JSON.stringify(context ?? {}, null, 2)}\n\nOPERATOR QUESTION:\n${message}`,
      config: {
        systemInstruction,
      },
    });

    res.json({ ok: true, reply: response.text ?? '' });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'AI assistant error.';
    res.status(500).json({ ok: false, error: errMsg });
  }
});
