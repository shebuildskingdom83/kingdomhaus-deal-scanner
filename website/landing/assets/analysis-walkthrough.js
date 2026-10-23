export const analysisStages = Object.freeze([
  'Review the context', 'Assess the dependencies', 'Frame the key questions'
]);
export const analysisStageDurationMs = 6000;

// A local presentation sequence, never an AI or retrieval request.
export function createAnalysisPlayback({ onChange, reducedMotion = () => false, schedule = setTimeout, cancel = clearTimeout }) {
  let timers = [];
  let generation = 0;
  const clear = () => { generation++; timers.forEach(cancel); timers = []; };
  return {
    play() {
      clear();
      if (reducedMotion()) { onChange({ state: 'paused', stage: 0 }); return; }
      const current = generation;
      onChange({ state: 'playing', stage: 0 });
      for (const stage of [1, 2]) timers.push(schedule(() => {
        if (current === generation) onChange({ state: stage === 2 ? 'complete' : 'playing', stage });
      }, stage * analysisStageDurationMs));
    },
    select(stage) {
      if (!Number.isInteger(stage) || stage < 0 || stage >= analysisStages.length) return;
      clear();
      onChange({ state: stage === 2 ? 'complete' : 'paused', stage });
    },
    reset() { clear(); onChange({ state: 'idle', stage: null }); },
    destroy() { clear(); }
  };
}
