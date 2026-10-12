/** Play prompt/answer phrases without retaining mutable UI state. */
export async function runSequence({
  segments,
  guitar,
  volume = 0.45,
  intervalMs = 650,
  isCurrent = () => true,
  onStep = () => {},
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
}) {
  const cancelled = () => ({ status: 'cancelled' });

  try {
    if (!isCurrent()) return cancelled();
    // Copy the entire sequence before yielding, including every empty answer slot.
    const sequence = segments.map(({ kind, notes, beats }) => ({
      kind,
      notes: notes.map(position => position == null ? null : { ...position }),
      beats: notes.map((_, index) => {
        const beat = Array.isArray(beats) ? beats[index] : undefined;
        return Number.isFinite(beat) && beat >= 0.25 && beat <= 4 ? beat : 1;
      }),
    }));
    let first = true;

    for (let segmentIndex = 0; segmentIndex < sequence.length; segmentIndex += 1) {
      const { kind, notes, beats } = sequence[segmentIndex];

      for (let index = 0; index < notes.length; index += 1) {
        if (!isCurrent()) return cancelled();
        // The caller stops existing audio before starting the first slot. Once a
        // run becomes stale it must never stop sound belonging to its successor.
        if (!first) guitar.stop();
        first = false;

        if (!isCurrent()) return cancelled();
        const position = notes[index];
        if (position) {
          const played = await guitar.play(position.midi, { volume });
          if (!isCurrent()) return cancelled();
          if (played === false) return { status: 'error' };
        }

        if (!isCurrent()) return cancelled();
        onStep({ kind, index, total: notes.length, position });
        if (!isCurrent()) return cancelled();
        await wait(intervalMs * beats[index]);
        if (!isCurrent()) return cancelled();
      }

      if (segmentIndex < sequence.length - 1) {
        if (!isCurrent()) return cancelled();
        await wait(250);
        if (!isCurrent()) return cancelled();
      }
    }

    // Leave the final note's natural decay intact.
    return isCurrent() ? { status: 'complete' } : cancelled();
  } catch {
    return isCurrent() ? { status: 'error' } : cancelled();
  }
}
