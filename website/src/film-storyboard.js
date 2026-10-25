export const FILM_DURATION = 32;
export const SHOT_DURATION = 4;
export const FILM_VERSION = 2;
export const FILM_SHOTS = [
  {
    id: 'data-atlas',
    name: 'DATA ATLAS',
    cn: '让数据，立体起来。',
    en: 'DATA BECOMES DIMENSION',
    tag: '投入产出 · 数据来源 · 统一口径',
    accent: '#c8f36b',
  },
  {
    id: 'production-engine',
    name: 'PRODUCTION ENGINE',
    cn: '进入产业现场。',
    en: 'INSIDE THE PRODUCTION CHAIN',
    tag: '生产 · 流通 · 产业关联',
    accent: '#66e4e1',
  },
  {
    id: 'network-flow',
    name: 'NETWORK FLOW',
    cn: '每个连接，都有力量。',
    en: 'EVERY CONNECTION COUNTS',
    tag: '复杂网络 · 结构诊断 · 传导路径',
    accent: '#66e4e1',
  },
  {
    id: 'critical-hubs',
    name: 'CRITICAL HUBS',
    cn: '找到牵动全局的节点。',
    en: 'FIND THE CRITICAL SECTORS',
    tag: '关键行业 · 关联强度 · 系统位置',
    accent: '#c8f36b',
  },
  {
    id: 'shock-cascade',
    name: 'SHOCK CASCADE',
    cn: '直面冲击。',
    en: 'FOLLOW THE SHOCK',
    tag: '冲击情景 · 传播动力学 · 条件模拟',
    accent: '#ff866c',
  },
  {
    id: 'adaptive-recovery',
    name: 'ADAPTIVE RECOVERY',
    cn: '重连，就是新的可能。',
    en: 'REROUTE. RECOVER. REBUILD.',
    tag: '替代路径 · 连接恢复 · 韧性提升',
    accent: '#c8f36b',
  },
  {
    id: 'evidence-pipeline',
    name: 'EVIDENCE PIPELINE',
    cn: '从实验，到可信证据。',
    en: 'FROM EXPERIMENT TO EVIDENCE',
    tag: '参数记录 · 结果复算 · 研究核验',
    accent: '#66e4e1',
  },
  {
    id: 'research-connected',
    name: 'RESEARCH, CONNECTED',
    cn: '链研',
    en: 'CHAINLAB',
    tag: '规范研究，连接未来。',
    accent: '#c8f36b',
  },
];

export function shotAt(time) {
  const wrapped = ((time % FILM_DURATION) + FILM_DURATION) % FILM_DURATION;
  const index = Math.floor(wrapped / SHOT_DURATION);
  return { ...FILM_SHOTS[index], index, time: wrapped, local: wrapped - index * SHOT_DURATION };
}
