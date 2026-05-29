import React, { useState, useRef, useEffect } from 'react';
import lamejs from 'lamejs';
import { wavToMp3 } from './wavToMp3';
import Soundfont from 'soundfont-player';
import { resolvePlayRange, playRangeForSave } from './playbackRange';

// Map standard Swaras to semitone offsets from the Tonic (Equal Temperament for simplicity)
const SWARA_MAP = {
  "-": null, // Blank/Rest
  "S": 0,
  "R1": 1, "R2": 2,
  "G2": 3, "G3": 4,
  "M1": 5, "M2": 6,
  "P": 7,
  "D1": 8, "D2": 9,
  "N2": 10, "N3": 11,
  "S^": 12
};

const SWARA_KEYS = Object.keys(SWARA_MAP);

const TONIC_FREQUENCIES = {
  "C3 (Katati 1)": 130.81,
  "C#3 (Katati 1.5)": 138.59,
  "D3 (Katati 2)": 146.83,
  "Eb3 (Katati 2.5)": 155.56,
};

export default function KalpanaswaraSequencer({ initialData, isEditing = false, onSave, onCancel }) {
  const [name, setName] = useState(initialData?.name || '');
  // Instrument options
  const INSTRUMENTS = [
    { label: 'Violin', value: 'violin' },
    { label: 'Guitar', value: 'guitar' },
    { label: 'Piano', value: 'piano' }
  ];
  // Tala options (beats per cycle)
  const TALAS = [
    { label: 'Aadi (8 beats)', value: 8 },
    { label: 'Rupaka (6 beats)', value: 6 },
    { label: 'Khanda Chapu (5 beats)', value: 5 },
    { label: 'Misra Chapu (7 beats)', value: 7 },
    { label: 'Custom', value: 'custom' }
  ];

  // State
  const [tonic, setTonic] = useState(initialData?.tonic || 130.81);
  const [bpm, setBpm] = useState(initialData?.bpm || 120);
  const [aksharasPerBeat, setAksharasPerBeat] = useState(initialData?.aksharasPerBeat || 4);
  const [beats, setBeats] = useState(initialData?.beats || 8);
  const [customBeats, setCustomBeats] = useState(initialData?.beats && ![5,6,7,8].includes(initialData.beats) ? initialData.beats : 8);
  const [instrument, setInstrument] = useState(initialData?.instrument || 'violin');
  
  const ultraCompact = true;
  const [insertBreaks, setInsertBreaks] = useState(initialData?.insertBreaks ?? true);
  const [defaultOctave, setDefaultOctave] = useState(initialData?.defaultOctave ?? 2);
  const totalNotes = beats * aksharasPerBeat;
  const [breakInterval, setBreakInterval] = useState(initialData?.breakInterval || (2 * aksharasPerBeat));
  const normalizeSeq = (rawSeq, total, defOctave = defaultOctave) => {
    const base = (Array.isArray(rawSeq) ? rawSeq : []);
    const out = base.map(it => typeof it === 'string' ? { swara: it, octave: defOctave } : ({ swara: it?.swara || '-', octave: it?.octave ?? defOctave }));
    if (out.length < total) {
      return out.concat(Array.from({ length: total - out.length }, () => ({ swara: '-', octave: defOctave })));
    }
    return out.slice(0, total);
  };

  const [sequence, setSequence] = useState(() => normalizeSeq(initialData?.sequence || [], Math.max(totalNotes, (initialData?.sequence?.length || 0)), defaultOctave));
  const [playStart, setPlayStart] = useState(initialData?.playStart ?? 1);
  const [playStop, setPlayStop] = useState(initialData?.playStop ?? null);

  const effectivePlayStop = playStop ?? sequence.length;
  const playRange = resolvePlayRange(playStart, effectivePlayStop, sequence.length);

  // Reset state when initialData changes (for editing)
  useEffect(() => {
    setName(initialData?.name || '');
    setTonic(initialData?.tonic || 130.81);
    setBpm(initialData?.bpm || 120);
    setAksharasPerBeat(initialData?.aksharasPerBeat || 4);
    setBeats(initialData?.beats || 8);
    setCustomBeats(initialData?.beats && ![5,6,7,8].includes(initialData.beats) ? initialData.beats : 8);
    setInstrument(initialData?.instrument || 'violin');
    setInsertBreaks(initialData?.insertBreaks ?? true);
    setDefaultOctave(initialData?.defaultOctave ?? 2);
    const initAk = (initialData?.aksharasPerBeat || 4);
    const total = (initialData?.beats || 8) * initAk;
    setBreakInterval(initialData?.breakInterval || (2 * initAk));
    const notes = initialData?.sequence || [];
    const desiredTotal = Math.max(total, notes.length || 0);
    setSequence(normalizeSeq(notes, desiredTotal, initialData?.defaultOctave ?? defaultOctave));
    setPlayStart(initialData?.playStart ?? 1);
    setPlayStop(initialData?.playStop ?? null);
    // eslint-disable-next-line
  }, [initialData]);

  useEffect(() => {
    setPlayStart((s) => Math.max(1, Math.min(s, sequence.length || 1)));
    setPlayStop((s) => (s == null ? null : Math.max(1, Math.min(s, sequence.length || 1))));
  }, [sequence.length]);

  // Keep breakInterval sensible when totalNotes changes
  useEffect(() => {
    setBreakInterval(prev => {
      const def = Math.max(1, 2 * aksharasPerBeat);
      if (!prev || prev <= 0) return Math.min(def, totalNotes);
      return Math.min(Math.max(1, prev), totalNotes) || Math.min(def, totalNotes);
    });
  }, [totalNotes, aksharasPerBeat]);
  // Use a ref to hold the audio context so it persists without causing re-renders
  const audioCtxRef = useRef(null);

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const handleCellWheel = (index, e) => {
    e.preventDefault();
    const dir = e.deltaY > 0 ? 1 : -1; // 1 means scroll down -> increase
    const item = sequence[index];
    const currentSwara = (typeof item === 'string') ? item : (item?.swara || '-');
    const currentOctRaw = (item && typeof item === 'object') ? (item.octave ?? defaultOctave) : defaultOctave;
    if (e.shiftKey) {
      // change swara sequentially
      const pos = SWARA_KEYS.indexOf(currentSwara);
      if (pos === -1) return;
      let next = (pos + dir) % SWARA_KEYS.length;
      if (next < 0) next += SWARA_KEYS.length;
      updateNote(index, SWARA_KEYS[next], 'swara');
    } else {
      // change octave (1..4)
      const nextOct = clamp(currentOctRaw + (dir * 1), 1, 4);
      updateNote(index, nextOct, 'octave');
    }
  };

  // Handle changing aksharas per beat
  const handleAksharasPerBeatChange = (e) => {
    const newAksharas = parseInt(e.target.value, 10);
    setAksharasPerBeat(newAksharas);
    const newTotal = beats * newAksharas;
    setSequence(prev => {
      const newSeq = Array.from({ length: newTotal }, (_, i) => {
        if (i < prev.length) return (typeof prev[i] === 'string') ? { swara: prev[i], octave: defaultOctave } : { swara: prev[i]?.swara || '-', octave: prev[i]?.octave ?? defaultOctave };
        return { swara: '-', octave: defaultOctave };
      });
      return newSeq;
    });
  };
  // Handle changing beats
  const handleBeatsChange = (e) => {
    let newBeats = e.target.value === 'custom' ? customBeats : parseInt(e.target.value, 10);
    setBeats(newBeats);
    const newTotal = newBeats * aksharasPerBeat;
    setSequence(prev => {
        const newSeq = Array.from({ length: newTotal }, (_, i) => {
          if (i < prev.length) return (typeof prev[i] === 'string') ? { swara: prev[i], octave: defaultOctave } : { swara: prev[i]?.swara || '-', octave: prev[i]?.octave ?? defaultOctave };
          return { swara: '-', octave: defaultOctave };
        });
        return newSeq;
    });
  };
  // Handle custom beats
  const handleCustomBeatsChange = (e) => {
    const val = parseInt(e.target.value, 10);
    setCustomBeats(val);
    setBeats(val);
    const newTotal = val * aksharasPerBeat;
    setSequence(prev => {
        const newSeq = Array.from({ length: newTotal }, (_, i) => {
          if (i < prev.length) return (typeof prev[i] === 'string') ? { swara: prev[i], octave: defaultOctave } : { swara: prev[i]?.swara || '-', octave: prev[i]?.octave ?? defaultOctave };
          return { swara: '-', octave: defaultOctave };
        });
        return newSeq;
    });
  };
  const updateNote = (index, value, field = 'swara') => {
    const newSeq = [...sequence];
    const current = newSeq[index];
    if (current && typeof current === 'object') {
      newSeq[index] = { ...current, [field]: value };
    } else {
      const baseSwara = (typeof current === 'string') ? current : '-';
      newSeq[index] = { swara: baseSwara, octave: defaultOctave, [field]: value };
    }
    setSequence(newSeq);
  };

  // The Web Audio Playback Engine using SoundFont
  const playPattern = async () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') await ctx.resume();
    // Map instrument to SoundFont name
    const instrumentMap = {
      violin: 'violin',
      guitar: 'acoustic_guitar_nylon',
      piano: 'acoustic_grand_piano',
    };
    const sfInstrument = instrumentMap[instrument] || 'acoustic_grand_piano';
    // Load instrument
    const player = await Soundfont.instrument(ctx, sfInstrument, { soundfont: 'MusyngKite' });
    const secondsPerBeat = 60.0 / bpm;
    const secondsPerAkshara = secondsPerBeat / aksharasPerBeat;
    const startTime = ctx.currentTime + 0.1;
    const { from, to, noteCount } = resolvePlayRange(playStart, effectivePlayStop, sequence.length);

    for (let index = from; index <= to; index++) {
      const item = sequence[index];
      const swara = typeof item === 'string' ? item : item?.swara;
      const rawOct = (item && typeof item === 'object' && item.octave != null) ? item.octave : defaultOctave;
      const octave = rawOct - 1;
      if (swara === '-') continue;
      const semitoneOffset = SWARA_MAP[swara];
      if (semitoneOffset == null) continue;
      const midiBase = 48 + (octave * 12);
      const midiNote = midiBase + semitoneOffset;
      const relativeIndex = index - from;
      const noteStartTime = startTime + (relativeIndex * secondsPerAkshara);
      player.play(midiNote, ctx.currentTime + (noteStartTime - ctx.currentTime), { duration: secondsPerAkshara });
    }
    if (noteCount > 0) {
      await new Promise((resolve) => setTimeout(resolve, (noteCount * secondsPerAkshara + 0.15) * 1000));
    }
  };

  const addAvartanam = () => {
    const extra = Array.from({ length: totalNotes }, () => ({ swara: '-', octave: defaultOctave }));
    setSequence(prev => [...prev, ...extra]);
  };

  const exportAudio = async (asMp3 = false) => {
    const secondsPerBeat = 60.0 / bpm;
    const secondsPerAkshara = secondsPerBeat / aksharasPerBeat;
    const { from, to, noteCount } = resolvePlayRange(playStart, effectivePlayStop, sequence.length);
    const totalDuration = noteCount * secondsPerAkshara;
    const offlineCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 44100 * totalDuration, 44100);
    for (let index = from; index <= to; index++) {
      const item = sequence[index];
      const relativeIndex = index - from;
      const swara = (typeof item === 'string') ? item : (item?.swara || '-');
      const rawOct = (item && typeof item === 'object') ? (item.octave ?? defaultOctave) : defaultOctave;
      const octave = rawOct - 1;
      if (swara === '-') return;
      const semitoneOffset = SWARA_MAP[swara];
      const frequency = tonic * Math.pow(2, semitoneOffset / 12) * Math.pow(2, octave);
      const noteStartTime = relativeIndex * secondsPerAkshara;
      const osc = offlineCtx.createOscillator();
      const gainNode = offlineCtx.createGain();
      if (instrument === 'violin') {
        osc.type = 'triangle';
      } else if (instrument === 'guitar') {
        osc.type = 'square';
      } else if (instrument === 'piano') {
        osc.type = 'sine';
      }
      osc.frequency.value = frequency;
      gainNode.gain.setValueAtTime(0, noteStartTime);
      gainNode.gain.linearRampToValueAtTime(0.8, noteStartTime + 0.05);
      gainNode.gain.setValueAtTime(0.8, noteStartTime + secondsPerAkshara - 0.05);
      gainNode.gain.linearRampToValueAtTime(0, noteStartTime + secondsPerAkshara);
      osc.connect(gainNode);
      gainNode.connect(offlineCtx.destination);
      osc.start(noteStartTime);
      osc.stop(noteStartTime + secondsPerAkshara);
    }
    const renderedBuffer = await offlineCtx.startRendering();
    const wavData = audioBufferToWav(renderedBuffer);
    if (asMp3) {
      const mp3Buffer = wavToMp3(wavData);
      const mp3Blob = new Blob([mp3Buffer], { type: 'audio/mp3' });
      const url = URL.createObjectURL(mp3Blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = 'kalamposer-pattern.mp3';
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const blob = new Blob([new DataView(wavData)], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = 'kalamposer-pattern.wav';
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const saveComposerState = () => {
    const range = playRangeForSave(playStart, effectivePlayStop, sequence.length);
    const state = { name, tonic, bpm, aksharasPerBeat, beats, instrument, sequence, defaultOctave, ...range };
    try {
      localStorage.setItem('kalamposer_composer_state', JSON.stringify(state));
      alert('Composer state saved locally.');
    } catch (err) {
      alert('Failed to save state: ' + err.message);
    }
  };

  const loadComposerState = () => {
    try {
      const raw = localStorage.getItem('kalamposer_composer_state')
        || localStorage.getItem('kalpanaswara_composer_state');
      if (!raw) { alert('No saved composer state found.'); return; }
      const s = JSON.parse(raw);
      setName(s.name || '');
      setTonic(s.tonic || 130.81);
      setBpm(s.bpm || 120);
      setAksharasPerBeat(s.aksharasPerBeat || 4);
      setBeats(s.beats || 8);
      setInstrument(s.instrument || 'violin');
      const totalLoad = (s.beats||8)*(s.aksharasPerBeat||4);
      const def = s.defaultOctave ?? defaultOctave ?? 2;
      setDefaultOctave(def);
      const loadedLen = Math.max(totalLoad, (s.sequence || []).length || 0);
      setSequence(normalizeSeq(s.sequence || [], loadedLen, def));
      setPlayStart(s.playStart ?? 1);
      setPlayStop(s.playStop ?? null);
    } catch (err) {
      alert('Failed to load saved state: ' + err.message);
    }
  };

  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        if (onSave) {
          const range = playRangeForSave(playStart, effectivePlayStop, sequence.length);
          onSave({ name, tonic, bpm, aksharasPerBeat, beats, instrument, sequence, defaultOctave, ...range });
        }
      }}
      style={{ fontFamily: 'inherit', width: '100%', maxWidth: 'none', margin: '0 auto' }}
    >
      {/* Controls Section */}
      <div style={{ display: 'flex', gap: '20px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <div>
          <label><strong>Sequence Name: </strong></label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Enter sequence name"
            style={{ width: '180px', padding: '4px' }}
            required
          />
        </div>
        <div>
          <label><strong>Tonic (Shruti): </strong></label>
          <select value={tonic} onChange={e => setTonic(parseFloat(e.target.value))}>
            {Object.entries(TONIC_FREQUENCIES).map(([label, freq]) => (
              <option key={label} value={freq}>{label}</option>
            ))}
          </select>
        </div>
        <div>
          <label><strong>Instrument: </strong></label>
          <select value={instrument} onChange={e => setInstrument(e.target.value)}>
            {INSTRUMENTS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label><strong>Beats in Tala: </strong></label>
          <select value={TALAS.find(t => t.value === beats) ? beats : 'custom'} onChange={handleBeatsChange}>
            {TALAS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          {(!TALAS.find(t => t.value === beats) || beats === 'custom') && (
            <input
              type="number"
              min="1"
              max="32"
              value={customBeats}
              onChange={handleCustomBeatsChange}
              style={{ width: '50px', marginLeft: 8 }}
            />
          )}
        </div>
        
        <div>
          <label><strong>Aksharas / beat: </strong></label>
          <input
            type="number"
            min="1"
            max="16"
            value={aksharasPerBeat}
            onChange={handleAksharasPerBeatChange}
            style={{ width: '50px' }}
          />
        </div>
        <div>
          <label><strong>Default Octave: </strong></label>
          <input
            type="number"
            min="1"
            max="4"
            value={defaultOctave}
            onChange={e => setDefaultOctave(Math.max(1, Math.min(4, parseInt(e.target.value, 10) || 2)))}
            style={{ width: '50px' }}
          />
          <button type="button" onClick={() => setSequence(prev => prev.map(it => ({ swara: (typeof it === 'string') ? it : (it?.swara || '-'), octave: defaultOctave })))} style={{ marginLeft: 8, padding: '6px 8px' }}>Apply to all notes</button>
        </div>
        <div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={insertBreaks} onChange={e => setInsertBreaks(e.target.checked)} />
            Insert breaks
          </label>
          {insertBreaks && (
            <div style={{ marginTop: 6 }}>
              <label style={{ fontSize: 12 }}>Interval (notes): </label>
              <input type="number" min={1} max={totalNotes} value={breakInterval} onChange={e => setBreakInterval(parseInt(e.target.value, 10) || 1)} style={{ width: 60, marginLeft: 6 }} />
            </div>
          )}
        </div>
        {/* Ultra compact display enforced */}
        <div>
          <label><strong>Tempo (BPM): </strong></label>
          <input
            type="range"
            min="40" max="240"
            value={bpm}
            onChange={e => setBpm(parseInt(e.target.value, 10))}
          />
          <span> {bpm}</span>
        </div>
      </div>
      {/* Sequencer Grid */}
      <div style={{ display: 'flex', gap: '12px', flexDirection: 'column', marginBottom: '20px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, overflowX: 'auto' }}>
            {(() => {
              const rows = [];
              let currentRow = [];
              const pushRow = (r, keyIdx) => {
                if (!r || r.length === 0) return;
                rows.push(
                  <div key={`row-${keyIdx}`} style={{ display: 'flex', gap: '5px', overflowX: 'auto', alignItems: 'center' }}>
                    {r}
                  </div>
                );
              };
              sequence.forEach((item, index) => {
                const swaraVal = (typeof item === 'string') ? item : (item?.swara || '-');
                const rawOctave = (item && typeof item === 'object') ? (item.octave ?? defaultOctave) : defaultOctave;
                const octaveVal = rawOctave === 0 ? 1 : rawOctave;
                const compact = false;
                const ultra = ultraCompact;
                const noteNum = index + 1;
                const inPlayRange = noteNum >= playRange.from + 1 && noteNum <= playRange.to + 1;
                const isPlayStart = noteNum === playRange.from + 1;
                const isPlayStop = noteNum === playRange.to + 1;
                const cell = (
                  <div key={`cell-${index}`} onWheel={e => handleCellWheel(index, e)} title="Scroll: octave; Shift+scroll: swara; click # to set play start/stop" style={{ padding: ultra ? '0px' : (compact ? '2px' : '4px'), background: inPlayRange ? '#e8f4ff' : '#f8f8f8', borderRadius: '4px', textAlign: 'center', minWidth: ultra ? 36 : (compact ? 46 : 54), marginBottom: ultra ? 0 : (compact ? 1 : 2), border: isPlayStart ? '2px solid #28a745' : isPlayStop ? '2px solid #dc3545' : inPlayRange ? '1px solid #90caf9' : '1px solid transparent', boxSizing: 'border-box' }}>
                    <button
                      type="button"
                      onClick={() => {
                        if (noteNum > effectivePlayStop) setPlayStop(noteNum);
                        setPlayStart(noteNum);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        if (noteNum < playStart) setPlayStart(noteNum);
                        setPlayStop(noteNum);
                      }}
                      title="Click: set play start; right-click #: set play stop"
                      style={{ fontSize: ultra ? '9px' : (compact ? '9px' : '10px'), color: isPlayStart ? '#28a745' : isPlayStop ? '#dc3545' : '#666', marginBottom: ultra ? '1px' : (compact ? '2px' : '3px'), background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: isPlayStart || isPlayStop ? 700 : 400 }}
                    >
                      {noteNum}{isPlayStart ? '▶' : ''}{isPlayStop ? '■' : ''}
                    </button>
                    <div style={{ display: 'flex', gap: ultra ? 2 : (compact ? 3 : 4), alignItems: 'center' }}>
                      <select
                        value={swaraVal}
                        onChange={e => updateNote(index, e.target.value, 'swara')}
                        style={{ padding: ultra ? '0px 2px' : (compact ? '1px 3px' : '2px 4px'), fontSize: ultra ? '10px' : (compact ? '11px' : '12px'), height: ultra ? '20px' : (compact ? '24px' : '28px'), minWidth: ultra ? 36 : (compact ? 40 : 48) }}
                      >
                        {Object.keys(SWARA_MAP).map(k => (
                          <option key={k} value={k}>{k}</option>
                        ))}
                      </select>
                      <div style={{ display: 'flex', gap: ultra ? 2 : (compact ? 3 : 4), alignItems: 'center' }}>
                        <button type="button" onClick={() => updateNote(index, clamp(octaveVal - 1, 1, 4), 'octave')} style={{ padding: ultra ? '0px 4px' : (compact ? '1px 4px' : '2px 6px'), fontSize: ultra ? '10px' : (compact ? '11px' : '12px'), height: ultra ? '18px' : (compact ? '22px' : '26px') }}>−</button>
                        <div onWheel={e => handleCellWheel(index, e)} title="Scroll to change octave; Shift+Scroll to change swara" style={{ padding: ultra ? '0px 4px' : (compact ? '1px 4px' : '2px 6px'), border: '1px solid #eee', borderRadius: 4, minWidth: ultra ? 18 : (compact ? 20 : 24), textAlign: 'center', cursor: 'ns-resize', fontSize: ultra ? '10px' : (compact ? '11px' : '12px'), height: ultra ? '18px' : (compact ? '22px' : '26px') }}>{octaveVal}</div>
                        <button type="button" onClick={() => updateNote(index, clamp(octaveVal + 1, 1, 4), 'octave')} style={{ padding: ultra ? '0px 4px' : (compact ? '1px 4px' : '2px 6px'), fontSize: ultra ? '10px' : (compact ? '11px' : '12px'), height: ultra ? '18px' : (compact ? '22px' : '26px') }}>+</button>
                      </div>
                    </div>
                  </div>
                );
                currentRow.push(cell);
                // insert break separator after this note if enabled and not at end
                if (insertBreaks && breakInterval > 0 && ((index + 1) % breakInterval === 0) && index < sequence.length - 1) {
                  pushRow(currentRow, rows.length);
                  // avartana separator (thicker) when this boundary aligns with totalNotes
                  if (totalNotes > 0 && ((index + 1) % totalNotes === 0)) {
                    rows.push(<div key={`av-${index}`} style={{ width: '100%', borderTop: '3px solid #666', margin: '8px 0' }} />);
                  } else {
                    // regular small separator
                    rows.push(<div key={`sep-${index}`} style={{ width: '100%', borderTop: '1px solid #ccc', margin: '6px 0' }} />);
                  }
                  currentRow = [];
                }
              });
              // push last row
              pushRow(currentRow, rows.length);
              return rows;
            })()}
          </div>
      </div>
      {/* Playback & Export */}
      <div style={{ display: 'flex', gap: '16px', marginTop: '10px', marginBottom: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 14 }}>
            <strong>Play start: </strong>
            <input
              type="number"
              min={1}
              max={sequence.length || 1}
              value={playStart}
              onChange={(e) => {
                const v = Math.max(1, Math.min(parseInt(e.target.value, 10) || 1, sequence.length || 1));
                setPlayStart(v);
                if (v > effectivePlayStop) setPlayStop(v);
              }}
              style={{ width: 56, marginLeft: 4 }}
            />
          </label>
          <label style={{ fontSize: 14 }}>
            <strong>Play stop: </strong>
            <input
              type="number"
              min={playStart}
              max={sequence.length || 1}
              value={effectivePlayStop}
              onChange={(e) => setPlayStop(Math.max(playStart, Math.min(parseInt(e.target.value, 10) || sequence.length, sequence.length || 1)))}
              style={{ width: 56, marginLeft: 4 }}
            />
          </label>
          <button
            type="button"
            onClick={() => { setPlayStart(1); setPlayStop(null); }}
            style={{ padding: '6px 10px', fontSize: 13, border: '1px solid #ccc', borderRadius: 4, background: '#fff', cursor: 'pointer' }}
          >
            Play all notes
          </button>
          <span style={{ fontSize: 13, color: '#666' }}>
            Playing notes {playRange.from + 1}–{playRange.to + 1} of {sequence.length}
          </span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '10px', marginTop: '10px', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={playPattern}
          style={{ padding: '10px 20px', fontSize: '16px', background: '#007BFF', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
        >
          Play Sequence
        </button>
        <button
          type="button"
          onClick={addAvartanam}
          style={{ padding: '10px 16px', fontSize: '14px', background: '#ffc107', color: '#111', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
        >
          Add Avartanam
        </button>
        <button
          type="button"
          onClick={saveComposerState}
          style={{ padding: '10px 16px', fontSize: '14px', background: '#17a2b8', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
        >
          Save Composer
        </button>
        <button
          type="button"
          onClick={loadComposerState}
          style={{ padding: '10px 16px', fontSize: '14px', background: '#6c757d', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
        >
          Load Composer
        </button>
        <button
          type="button"
          onClick={() => exportAudio(true)}
          style={{ padding: '10px 20px', fontSize: '16px', background: '#e83e8c', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
        >
          Save as MP3
        </button>
        {onSave && (
          <button
            type="submit"
            style={{ padding: '10px 20px', fontSize: '16px', background: '#222', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', marginLeft: 8 }}
          >
            {isEditing ? 'Update Project Sequence' : 'Add to Project'}
          </button>
        )}
        {onCancel && isEditing && (
          <button
            type="button"
            onClick={onCancel}
            style={{ padding: '10px 20px', fontSize: '16px', background: '#aaa', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', marginLeft: 8 }}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}