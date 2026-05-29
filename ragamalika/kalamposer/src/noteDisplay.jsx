import React from 'react';
import { resolvePlayRange, effectivePlayStop } from './playbackRange';

const NOTE_CELL_WIDTH = '2.35em';
const NOTE_CELL_MIN_HEIGHT = '1.85em';

const noteCellStyle = {
  width: NOTE_CELL_WIDTH,
  minWidth: NOTE_CELL_WIDTH,
  minHeight: NOTE_CELL_MIN_HEIGHT,
  display: 'inline-flex',
  justifyContent: 'center',
  alignItems: 'center',
  boxSizing: 'border-box',
  padding: '0.4em 0.1em 0.25em',
  verticalAlign: 'top',
  fontWeight: 700,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  lineHeight: 1.1,
};

/** Mode of sequence defaultOctave values (1–4); ties go to lowest octave. */
export function inferProjectDefaultOctave(sequences) {
  if (!sequences?.length) return 2;
  const counts = new Map();
  for (const seq of sequences) {
    const o = seq.defaultOctave ?? 2;
    counts.set(o, (counts.get(o) || 0) + 1);
  }
  let best = 2;
  let bestCount = 0;
  for (const [octave, count] of counts) {
    if (count > bestCount || (count === bestCount && octave < best)) {
      bestCount = count;
      best = octave;
    }
  }
  return best;
}

function noteOctave(item, seqDefault, projectDefault) {
  const seqDef = seqDefault ?? projectDefault;
  if (typeof item === 'string') return seqDef;
  return item?.octave ?? seqDef;
}

function swaraOf(item) {
  return typeof item === 'string' ? item : (item?.swara || '-');
}

export function playedNoteItems(seq, projectDefaultOctave) {
  const sequence = seq.sequence || [];
  const seqDefault = seq.defaultOctave ?? projectDefaultOctave;
  if (!sequence.length) return [];

  // Show the full composed sequence in project mode (play range only affects playback).
  const from = 0;
  const to = sequence.length - 1;

  return sequence.slice(from, to + 1).map((item) => {
    const swara = swaraOf(item);
    if (swara === '-') return { kind: 'gap' };
    return {
      kind: 'note',
      swara,
      octave: noteOctave(item, seqDefault, projectDefaultOctave),
    };
  });
}

function NoteGlyph({ swara, octave, projectOctave }) {
  const dotStyle = {
    position: 'absolute',
    left: '50%',
    transform: 'translateX(-50%)',
    fontSize: '0.55em',
    lineHeight: 1,
    pointerEvents: 'none',
  };
  return (
    <span style={{ position: 'relative', display: 'inline-block', textAlign: 'center' }}>
      {octave > projectOctave && (
        <span style={{ ...dotStyle, top: '-0.45em' }} aria-hidden>•</span>
      )}
      {swara}
      {octave < projectOctave && (
        <span style={{ ...dotStyle, bottom: '-0.35em' }} aria-hidden>•</span>
      )}
    </span>
  );
}

function NoteCell({ item, projectDefaultOctave }) {
  return (
    <span style={noteCellStyle} aria-hidden={item.kind === 'gap'}>
      {item.kind === 'gap' ? (
        ','
      ) : (
        <NoteGlyph
          swara={item.swara}
          octave={item.octave}
          projectOctave={projectDefaultOctave}
        />
      )}
    </span>
  );
}

export function playRangeLabel(seq) {
  const length = (seq.sequence || []).length;
  if (!length) return null;
  const { from, to } = resolvePlayRange(seq.playStart, seq.playStop, length);
  const stop = effectivePlayStop(seq.playStop, length);
  if (from === 0 && stop === length) return null;
  return `Playing notes ${from + 1}–${to + 1} of ${length}`;
}

export function PlayedNotes({ seq, projectDefaultOctave }) {
  const items = playedNoteItems(seq, projectDefaultOctave);
  if (!items.length) return <>—</>;

  const wrap = Math.max(1, 2 * (seq.aksharasPerBeat ?? 4));
  const rangeHint = playRangeLabel(seq);
  const rows = [];
  for (let i = 0; i < items.length; i += wrap) {
    rows.push(items.slice(i, i + wrap));
  }

  return (
    <div style={{ width: '100%', minWidth: 0 }}>
      {rangeHint && (
        <div style={{ fontSize: 11, color: '#888', marginBottom: 4, fontWeight: 400 }}>{rangeHint}</div>
      )}
      <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
        <div style={{ display: 'inline-block' }}>
          {rows.map((row, rowIndex) => (
            <div key={rowIndex} style={{ display: 'flex', flexDirection: 'row', whiteSpace: 'nowrap' }}>
              {row.map((item, colIndex) => (
                <NoteCell
                  key={`${rowIndex}-${colIndex}`}
                  item={item}
                  projectDefaultOctave={projectDefaultOctave}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
