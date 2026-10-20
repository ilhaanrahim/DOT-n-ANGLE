// Keeps bounded search away from rendering and touch input. No network requests.
importScripts('ai-engine.js');
self.onmessage = event => {
  const { requestId, snapshot, options } = event.data;
  try {
    self.postMessage({ requestId, result: self.DotAngleAI.chooseMove(snapshot, options) });
  } catch (error) {
    self.postMessage({ requestId, error: error.message });
  }
};
