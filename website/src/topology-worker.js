import { sharedLayout } from './topology-layout.js';

self.onmessage = async ({ data }) => {
  try {
    const { radius, ...layout } = await sharedLayout(data);
    self.postMessage({ layout });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
