
import React, { useState, useRef, useEffect } from 'react';
import KalpanaswaraSequencer from './KalpanaswaraSequencer';
import ErrorBoundary from './ErrorBoundary';
import Soundfont from 'soundfont-player';
import { resolvePlayRange } from './playbackRange';
import { inferProjectDefaultOctave, PlayedNotes } from './noteDisplay';

const SWARA_MAP = {
  '-': null,
  S: 0,
  R1: 1, R2: 2,
  G2: 3, G3: 4,
  M1: 5, M2: 6,
  P: 7,
  D1: 8, D2: 9,
  N2: 10, N3: 11,
  'S^': 12,
};

const INSTRUMENT_MAP = {
  violin: 'violin',
  guitar: 'acoustic_guitar_nylon',
  piano: 'acoustic_grand_piano',
};

const PROJECT_FILE_TYPES = [{
  description: 'Kalamposer project',
  accept: { 'application/json': ['.json'] },
}];

const DEFAULT_PROJECT_FILENAME = 'kalamposer-project.json';

const supportsFileSystemAccess = () =>
  typeof window !== 'undefined' && 'showSaveFilePicker' in window;

const newSequenceId = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `seq-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const ensureSequenceIds = (sequences) =>
  (Array.isArray(sequences) ? sequences : []).map((seq) => ({
    ...seq,
    id: seq.id || newSequenceId(),
  }));

const stripLegacySequenceFields = (seq) => {
  const { projectBpm, ...rest } = seq;
  return rest;
};

const serializeProject = (sequences, projectPlayBpm) => {
  const projectDefaultOctave = inferProjectDefaultOctave(sequences);
  return {
    sequences: sequences.map(stripLegacySequenceFields),
    projectDefaultOctave,
    ...(projectPlayBpm != null ? { projectPlayBpm } : {}),
  };
};

const parseProjectFile = (data) => {
  if (Array.isArray(data)) {
    const sequences = ensureSequenceIds(data).map(stripLegacySequenceFields);
    return {
      sequences,
      projectPlayBpm: null,
      projectDefaultOctave: inferProjectDefaultOctave(sequences),
    };
  }
  if (data && typeof data === 'object' && Array.isArray(data.sequences)) {
    const sequences = ensureSequenceIds(data.sequences).map(stripLegacySequenceFields);
    return {
      sequences,
      projectPlayBpm: data.projectPlayBpm ?? null,
      projectDefaultOctave: data.projectDefaultOctave ?? inferProjectDefaultOctave(sequences),
    };
  }
  throw new Error('Invalid project file.');
};

const effectiveBpm = (seq, projectPlayBpm) => {
  if (projectPlayBpm != null) {
    const n = Number(projectPlayBpm);
    if (Number.isFinite(n) && n > 0) return Math.max(40, Math.min(240, n));
  }
  return seq.bpm ?? 120;
};

const getSoundfontPlayer = async (ctx, cache, instrument) => {
  const sfName = INSTRUMENT_MAP[instrument] || 'acoustic_grand_piano';
  if (!cache[sfName]) {
    cache[sfName] = await Soundfont.instrument(ctx, sfName, { soundfont: 'MusyngKite' });
  }
  return cache[sfName];
};

/** Schedule one sequence; returns end offset in seconds from audioStartTime. */
const scheduleProjectSequence = async (ctx, playerCache, seq, audioStartTime, offsetSeconds, projectPlayBpm) => {
  const { aksharasPerBeat, instrument, sequence, playStart, playStop } = seq;
  const bpm = effectiveBpm(seq, projectPlayBpm);
  const secondsPerAkshara = (60.0 / bpm) / aksharasPerBeat;
  const { from, to, noteCount } = resolvePlayRange(playStart, playStop, sequence.length);
  if (noteCount <= 0) return offsetSeconds;

  const player = await getSoundfontPlayer(ctx, playerCache, instrument);
  for (let index = from; index <= to; index++) {
    const item = sequence[index];
    const swara = (typeof item === 'string') ? item : (item?.swara || '-');
    const rawOct = (item && typeof item === 'object')
      ? (item.octave ?? (seq.defaultOctave ?? 2))
      : (seq.defaultOctave ?? 2);
    const octave = rawOct - 1;
    if (swara === '-') continue;
    const semitoneOffset = SWARA_MAP[swara];
    if (semitoneOffset == null) continue;
    const midiNote = 48 + (octave * 12) + semitoneOffset;
    const noteStartTime = audioStartTime + offsetSeconds + (index - from) * secondsPerAkshara;
    player.play(midiNote, noteStartTime, { duration: secondsPerAkshara });
  }
  return offsetSeconds + noteCount * secondsPerAkshara;
};

const playProjectSequence = async (seq, projectPlayBpm) => {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') await ctx.resume();
  const audioStart = ctx.currentTime + 0.1;
  const playerCache = {};
  const endOffset = await scheduleProjectSequence(ctx, playerCache, seq, audioStart, 0, projectPlayBpm);
  await new Promise((resolve) => setTimeout(resolve, endOffset * 1000 + 150));
};

/** Play every sequence back-to-back on one timeline (no gap between sequences). */
const playProjectSequencesContinuous = async (sequences, projectPlayBpm) => {
  if (!sequences.length) return;
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') await ctx.resume();
  const audioStart = ctx.currentTime + 0.1;
  const playerCache = {};
  let offset = 0;
  for (const seq of sequences) {
    offset = await scheduleProjectSequence(ctx, playerCache, seq, audioStart, offset, projectPlayBpm);
  }
  await new Promise((resolve) => setTimeout(resolve, offset * 1000 + 150));
};

function App() {
  // Project state: list of sequences (each is an object with settings and sequence array)
  const [projectSequences, setProjectSequences] = useState([]);
  // Composer state: current sequence being edited (null if not editing)
  const [composerData, setComposerData] = useState(null);
  const [activeTab, setActiveTab] = useState('project'); // 'project' or 'composer'
  const [projectFileName, setProjectFileName] = useState(null);
  const [projectPlayBpm, setProjectPlayBpm] = useState(null);
  const [notice, setNotice] = useState(null);
  const projectFileHandleRef = useRef(null);
  const loadFileInputRef = useRef(null);
  const noticeTimerRef = useRef(null);

  const showNotice = (message, type = 'success') => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    setNotice({ message, type });
    noticeTimerRef.current = setTimeout(() => {
      setNotice(null);
      noticeTimerRef.current = null;
    }, 3500);
  };

  useEffect(() => () => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
  }, []);

  const writeProjectToHandle = async (handle, sequences, playBpm) => {
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(serializeProject(sequences, playBpm), null, 2));
    await writable.close();
  };

  const applyLoadedProject = (data, fileName, handle = null) => {
    const { sequences, projectPlayBpm: loadedBpm } = parseProjectFile(data);
    setProjectSequences(sequences);
    setProjectPlayBpm(loadedBpm);
    setProjectFileName(fileName);
    projectFileHandleRef.current = handle;
  };

  const downloadProjectFallback = (name, sequences, playBpm) => {
    const blob = new Blob([JSON.stringify(serializeProject(sequences, playBpm), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  const handleNewSequence = () => {
    setComposerData(null);
    setActiveTab('composer');
  };

  // Handler to add a sequence from Composer to Project
  const handleAddToProject = (seqData) => {
    const { _editId, projectIndex, ...clean } = seqData;
    setProjectSequences((prev) => [
      ...prev,
      { ...clean, id: clean.id || newSequenceId() },
    ]);
    setComposerData(null);
    setActiveTab('project');
  };

  const persistProject = async (sequences, playBpm, { promptIfNeeded = true } = {}) => {
    if (projectFileHandleRef.current) {
      await writeProjectToHandle(projectFileHandleRef.current, sequences, playBpm);
      return { ok: true, fileName: projectFileHandleRef.current.name || projectFileName };
    }
    if (promptIfNeeded && supportsFileSystemAccess()) {
      const handle = await window.showSaveFilePicker({
        suggestedName: projectFileName || DEFAULT_PROJECT_FILENAME,
        types: PROJECT_FILE_TYPES,
      });
      projectFileHandleRef.current = handle;
      setProjectFileName(handle.name);
      await writeProjectToHandle(handle, sequences, playBpm);
      return { ok: true, fileName: handle.name };
    }
    if (promptIfNeeded) {
      const name = projectFileName || DEFAULT_PROJECT_FILENAME;
      downloadProjectFallback(name, sequences, playBpm);
      return { ok: true, fileName: name };
    }
    return { ok: false };
  };

  const defaultProjectPlayBpm = () =>
    projectSequences[0]?.bpm ?? 120;

  const projectDefaultOctave = inferProjectDefaultOctave(projectSequences);

  const handleSaveProject = async () => {
    try {
      const result = await persistProject(projectSequences, projectPlayBpm, { promptIfNeeded: true });
      if (result.ok) showNotice(`Project saved (${result.fileName})`);
    } catch (err) {
      if (err?.name === 'AbortError') return;
      showNotice(`Failed to save project: ${err.message}`, 'error');
    }
  };

  const handleSaveProjectAs = async () => {
    try {
      if (supportsFileSystemAccess()) {
        const handle = await window.showSaveFilePicker({
          suggestedName: projectFileName || DEFAULT_PROJECT_FILENAME,
          types: PROJECT_FILE_TYPES,
        });
        projectFileHandleRef.current = handle;
        setProjectFileName(handle.name);
        await writeProjectToHandle(handle, projectSequences, projectPlayBpm);
        return;
      }
      const defaultName = projectFileName || DEFAULT_PROJECT_FILENAME;
      const name = window.prompt('Save project as filename', defaultName);
      if (!name) return;
      setProjectFileName(name);
      downloadProjectFallback(name, projectSequences, projectPlayBpm);
    } catch (err) {
      if (err?.name === 'AbortError') return;
      showNotice(`Failed to save project: ${err.message}`, 'error');
    }
  };

  const handleLoadProjectClick = async () => {
    if (supportsFileSystemAccess()) {
      try {
        const [handle] = await window.showOpenFilePicker({
          types: PROJECT_FILE_TYPES,
          multiple: false,
        });
        const file = await handle.getFile();
        const data = JSON.parse(await file.text());
        applyLoadedProject(data, handle.name, handle);
        return;
      } catch (err) {
        if (err?.name === 'AbortError') return;
        alert(`Failed to load project: ${err.message}`);
        return;
      }
    }
    loadFileInputRef.current?.click();
  };

  const handleLoadProjectFromInput = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = JSON.parse(evt.target.result);
        applyLoadedProject(data, file.name, null);
      } catch {
        alert('Invalid project file.');
      }
    };
    reader.readAsText(file);
  };

  const handleEditSequence = (index) => {
    const seq = projectSequences[index];
    setComposerData({ ...seq, _editId: seq.id });
    setActiveTab('composer');
  };

  const handleDuplicateSequence = (index) => {
    const src = projectSequences[index];
    const copy = {
      ...src,
      id: newSequenceId(),
      name: `${src.name || 'Untitled'} (copy)`,
      sequence: (src.sequence || []).map((it) =>
        typeof it === 'object' && it !== null ? { ...it } : it
      ),
    };
    setProjectSequences((prev) => [
      ...prev.slice(0, index + 1),
      copy,
      ...prev.slice(index + 1),
    ]);
  };

  const handleRemoveSequence = (index) => {
    if (!window.confirm('Remove this sequence from the project?')) return;
    setProjectSequences((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpdateProjectSequence = async (editId, seqData) => {
    const { _editId, projectIndex, ...clean } = seqData;
    const updated = projectSequences.map((s) =>
      (s.id === editId ? { ...clean, id: editId } : s)
    );
    setProjectSequences(updated);
    setComposerData(null);
    setActiveTab('project');

    try {
      const result = await persistProject(updated, projectPlayBpm, { promptIfNeeded: true });
      if (result.ok) {
        showNotice(`Sequence updated and project saved (${result.fileName})`);
      } else {
        showNotice('Sequence updated.');
      }
    } catch (err) {
      if (err?.name === 'AbortError') {
        showNotice('Sequence updated.');
        return;
      }
      showNotice(`Sequence updated, but project save failed: ${err.message}`, 'error');
    }
  };

  const noticeStyles = {
    success: { background: '#d4edda', color: '#155724', border: '1px solid #c3e6cb' },
    error: { background: '#f8d7da', color: '#721c24', border: '1px solid #f5c6cb' },
    info: { background: '#e7f3ff', color: '#004085', border: '1px solid #b8daff' },
  };

  return (
    <>
    {notice && (
      <div
        role="status"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 2000,
          padding: '12px 24px',
          textAlign: 'center',
          fontSize: 14,
          fontWeight: 500,
          boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
          ...(noticeStyles[notice.type] || noticeStyles.success),
        }}
      >
        {notice.message}
      </div>
    )}
    <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start', padding: '24px', paddingTop: notice ? 56 : 24, fontFamily: 'sans-serif' }}>
      <div style={{ width: 180, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', color: '#1a1a2e', marginBottom: 4 }}>Kalamposer</div>
        <div style={{ fontSize: 11, color: '#888', marginBottom: 8, lineHeight: 1.3 }}>Carnatic swara composer</div>
        <button onClick={() => setActiveTab('project')} style={{ padding: '10px', textAlign: 'left', borderRadius: 6, border: activeTab === 'project' ? '2px solid #007bff' : '1px solid #ddd', background: activeTab === 'project' ? '#eef6ff' : '#fff', cursor: 'pointer' }}>Project</button>
        <button onClick={() => setActiveTab('composer')} style={{ padding: '10px', textAlign: 'left', borderRadius: 6, border: activeTab === 'composer' ? '2px solid #007bff' : '1px solid #ddd', background: activeTab === 'composer' ? '#eef6ff' : '#fff', cursor: 'pointer' }}>Composer</button>
        <button onClick={handleNewSequence} style={{ padding: '10px', textAlign: 'left', borderRadius: 6, border: '1px solid #28a745', background: '#f0fff4', color: '#1e7e34', cursor: 'pointer', fontWeight: 600 }}>+ New Sequence</button>
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button onClick={handleSaveProject} style={{ padding: '8px 12px', width: '100%', borderRadius: 4, border: 'none', background: '#28a745', color: 'white', cursor: 'pointer' }}>Save</button>
          <button onClick={handleSaveProjectAs} style={{ padding: '8px 12px', width: '100%', borderRadius: 4, border: '1px solid #ccc', background: '#fff', cursor: 'pointer' }}>Save As</button>
          <button
            type="button"
            onClick={handleLoadProjectClick}
            style={{ marginTop: 8, background: '#007bff', color: 'white', padding: '8px 12px', borderRadius: 4, border: 'none', cursor: 'pointer', width: '100%' }}
          >
            Load Project
          </button>
          <input
            ref={loadFileInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={handleLoadProjectFromInput}
          />
          {projectFileName && <div style={{ marginTop: 6, fontSize: 12, color: '#444' }}>Current: {projectFileName}</div>}
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 900, border: '1px solid #ccc', borderRadius: 8, padding: 20, background: '#fff' }}>
        {console.debug('[App] render', { activeTab, composerName: composerData?.name, projectCount: projectSequences.length })}
        {activeTab === 'project' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h2 style={{ margin: 0 }}>Project</h2>
                <div style={{ fontSize: 13, color: '#666', marginTop: 4 }}>
                  {projectSequences.length === 0
                    ? 'Add multiple sequences to one Kalamposer project file.'
                    : `${projectSequences.length} sequence${projectSequences.length === 1 ? '' : 's'} in this project`}
                </div>
                {projectSequences.length > 0 && (
                  <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 13 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="checkbox"
                        checked={projectPlayBpm != null}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setProjectPlayBpm(defaultProjectPlayBpm());
                          } else {
                            setProjectPlayBpm(null);
                          }
                        }}
                      />
                      <strong>Override play BPM for entire project</strong>
                    </label>
                    <input
                      type="number"
                      min={40}
                      max={240}
                      value={projectPlayBpm ?? defaultProjectPlayBpm()}
                      disabled={projectPlayBpm == null}
                      onChange={(e) => {
                        const n = parseInt(e.target.value, 10);
                        if (Number.isFinite(n)) {
                          setProjectPlayBpm(Math.max(40, Math.min(240, n)));
                        }
                      }}
                      style={{ width: 56, padding: '2px 4px' }}
                    />
                    <span style={{ color: '#666' }}>
                      {projectPlayBpm != null
                        ? 'All sequences play at this tempo'
                        : 'Each sequence uses its composed tempo'}
                    </span>
                    <span style={{ color: '#666', marginLeft: 8 }}>
                      · <strong>Project octave:</strong> {projectDefaultOctave}
                      {' '}(dot above = higher, dot below = lower)
                    </span>
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {projectSequences.length > 1 && (
                  <button
                    onClick={() => playProjectSequencesContinuous(projectSequences, projectPlayBpm)}
                    style={{ padding: '8px 14px', borderRadius: 4, border: 'none', background: '#6f42c1', color: 'white', cursor: 'pointer' }}
                  >
                    Play All
                  </button>
                )}
                <button
                  onClick={handleNewSequence}
                  style={{ padding: '8px 14px', borderRadius: 4, border: 'none', background: '#28a745', color: 'white', cursor: 'pointer', fontWeight: 600 }}
                >
                  + New Sequence
                </button>
              </div>
            </div>
            {projectSequences.length === 0 ? (
              <div style={{ color: '#888', padding: '24px 0' }}>
                <p style={{ marginTop: 0 }}>No sequences yet. Compose one in the sequencer, then add it here. Repeat to build a full project.</p>
                <button
                  onClick={handleNewSequence}
                  style={{ padding: '10px 18px', borderRadius: 4, border: 'none', background: '#28a745', color: 'white', cursor: 'pointer', fontWeight: 600 }}
                >
                  Compose First Sequence
                </button>
              </div>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {projectSequences.map((seq, idx) => (
                  <li key={seq.id} style={{ marginBottom: 12, padding: 10, border: '1px solid #eee', borderRadius: 6, background: '#f5f5fa' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: '#888', marginBottom: 2 }}>Sequence {idx + 1}</div>
                        <div><strong>Name:</strong> {seq.name || '(Untitled)'}</div>
                        <div style={{ fontSize: 13, color: '#444' }}>
                          <strong>Instrument:</strong> {seq.instrument} — <strong>Beats:</strong> {seq.beats} | <strong>Aksharas/beat:</strong> {seq.aksharasPerBeat}
                          {' '}— <strong>Composed BPM:</strong> {seq.bpm ?? 120}
                        </div>
                        <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.6 }}>
                          <PlayedNotes seq={seq} projectDefaultOctave={projectDefaultOctave} />
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <button onClick={() => playProjectSequence(seq, projectPlayBpm)} style={{ padding: '6px 12px', borderRadius: 4, border: 'none', background: '#6f42c1', color: 'white', cursor: 'pointer' }}>Play</button>
                        <button onClick={() => handleEditSequence(idx)} style={{ padding: '6px 12px', borderRadius: 4, border: 'none', background: '#007bff', color: 'white', cursor: 'pointer' }}>Edit</button>
                        <button onClick={() => handleDuplicateSequence(idx)} style={{ padding: '6px 12px', borderRadius: 4, border: '1px solid #ccc', background: '#fff', cursor: 'pointer' }}>Duplicate</button>
                        <button onClick={() => handleRemoveSequence(idx)} style={{ padding: '6px 12px', borderRadius: 4, border: 'none', background: '#dc3545', color: 'white', cursor: 'pointer' }}>Remove</button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {activeTab === 'composer' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
              <h2 style={{ margin: 0 }}>Composer</h2>
              {composerData?._editId ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                  <span style={{ color: '#555' }}>Editing: <strong>{composerData.name || '(Untitled)'}</strong></span>
                  <button
                    type="button"
                    onClick={handleNewSequence}
                    style={{ padding: '6px 10px', borderRadius: 4, border: '1px solid #28a745', background: '#f0fff4', color: '#1e7e34', cursor: 'pointer' }}
                  >
                    New sequence instead
                  </button>
                </div>
              ) : (
                <span style={{ fontSize: 14, color: '#666' }}>
                  {projectSequences.length > 0
                    ? `Adding sequence ${projectSequences.length + 1} to project`
                    : 'New sequence — save with “Add to Project”'}
                </span>
              )}
            </div>
            <ErrorBoundary>
              <KalpanaswaraSequencer
                key={composerData?._editId || 'new'}
                initialData={composerData}
                isEditing={Boolean(composerData?._editId)}
                onSave={(data) => {
                  if (composerData?._editId) {
                    handleUpdateProjectSequence(composerData._editId, data);
                  } else {
                    handleAddToProject(data);
                  }
                }}
                onCancel={() => { setComposerData(null); setActiveTab('project'); }}
              />
            </ErrorBoundary>
          </div>
        )}
      </div>
    </div>
    </>
  );
}

export default App;