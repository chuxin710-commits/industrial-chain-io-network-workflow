export const POLICY = '0.4';
export const EVIDENCE = {
  scope_ok: '授权、参考期、地域、分类、单位及估值一致',
  published_target: '相容的目标年官方成品表',
  base_aligned: '分类与估值已对齐的历史基表',
  target_blocks: '目标年分部门 x、Y、VA、进口 m',
  z_margins: '已取得或可推导 Z 的行列目标',
  support_ok: '非负边际及先验正支撑通过数值预检',
  support_conflict: '已证实边际或正支撑冲突',
  estimate_allowed: '用途允许使用估计产物',
  sut_balanced: 'V、U、W、Y、m 已对账且完成估值桥接',
  sut_product_A_ok: '产品技术 A 的方阵、产出、秩及稳定性',
  sut_product_B_ok: '产业技术 B 的适用轴与活跃产业正产出',
  total_uses_ready: '同口径总使用矩阵与最终使用',
  origin_use_observed: '可对账的进口中间使用及最终用途',
  origin_use_prior: '经批准的进口分配先验及限制',
  regional_blocks_ready: '同口径地区基础表及分项',
  bilateral_use_ready: '起讫地区 × 产品 × 用途流量',
  current_table_ready: '目标年现价表',
  price_bridges_ready: '分项价格指数、估值桥和基准期',
  survey_product_flows_ready: '当年产品调查流量与供用两侧映射',
  survey_coverage_validated: '调查覆盖与总体扩展已校验',
  sut_industry_C_ok: '固定产业销售结构 C 的方阵及稳定性',
  sut_industry_D_ok: '固定产品销售结构 D 的份额及完全进口产品处理',
  signed_problem_feasible: '有符号流量、目标及约束已验证可行',
  signed_problem_conflict: '已证实有符号调平约束冲突',
  regional_prior_aligned: '相容的地区技术结构先验',
  external_use_bridge_ready: '区外调入、进口及其用途的口径桥',
  balance_feasible: '区域平衡预检已通过',
  bilateral_prior_validated: '双边贸易先验已核验',
  regional_constraints_feasible: '区际及全国约束一致',
  current_tables_aligned: '各期现价表口径可比',
  cross_time_classification_validated: '跨期分类映射与金额守恒已核验',
  target_table_ready: '与研究用途相容的成品投入产出表',
  satellite_aligned: '能源、排放、就业或收入账户已匹配',
  enterprise_flow_blocks_ready: '企业多业务流量、产出和存货记录',
  enterprise_consolidation_ready: '内部价格、交易边界和抵销规则',
};

const rule = (title, requirements, status, output, conflicts = '') => ({
  title, requires: ['scope_ok', ...requirements.split(' ')], status, output, conflicts: conflicts ? [conflicts] : [],
});
export const RULES = {
  reuse_published: rule('复用目标年成品表', 'published_target', 'reuse', '按已发布口径分析结构、聚合与重算指标，不代表复现原始编制。'),
  update_competitive_ras: rule('竞争型表 · 非负 RAS', 'base_aligned target_blocks z_margins support_ok estimate_allowed', 'estimated', '现价、单区域、产品 × 产品估计表；不提供国内乘数。', 'support_conflict'),
  estimate_z_only: rule('仅估计中间使用 Z', 'base_aligned z_margins support_ok estimate_allowed', 'partial', '可交付中间使用矩阵，不能作为完整目标年投入产出表。', 'support_conflict'),
  transform_product_A: rule('产品 × 产品 · SUT 模型 A', 'sut_balanced sut_product_A_ok', 'feasible', '按产品技术假定转换，另行复核转换负值。'),
  transform_product_B: rule('产品 × 产品 · SUT 模型 B', 'sut_balanced sut_product_B_ok', 'feasible', '按产业技术假定转换，可用矩形 SUT。'),
  split_observed_imports: rule('非竞争型表 · 观测进口', 'total_uses_ready origin_use_observed', 'feasible', '分解国内和进口使用；国内乘数仍须通过生产性及稳定性验证。'),
  split_estimated_imports: rule('非竞争型表 · 估计进口', 'total_uses_ready origin_use_prior estimate_allowed', 'estimated', '进口用途为估计；作为分析情景并附敏感性。'),
  multi_region: rule('多区域表 · 观测流量', 'regional_blocks_ready bilateral_use_ready', 'feasible', '支持分析区际依赖；另核对镜像流与聚合。'),
  constant_price: rule('不变价表', 'current_table_ready price_bridges_ready', 'feasible', '可评估部门实际量变化；单一总量指数不足。'),
  survey_product: rule('产品 × 产品 · 调查与混合', 'survey_product_flows_ready survey_coverage_validated target_blocks', 'feasible', '以调查和辅助核算构造表体；逐块披露估计。'),
  transform_industry_C: rule('产业 × 产业 · SUT 模型 C', 'sut_balanced sut_industry_C_ok', 'feasible', '按固定产业销售结构转换，核查矩阵稳定性。'),
  transform_industry_D: rule('产业 × 产业 · SUT 模型 D', 'sut_balanced sut_industry_D_ok', 'feasible', '按固定产品销售结构转换，进口块单独处理。'),
  update_signed_gras: rule('含符号基表更新 · GRAS', 'base_aligned target_blocks z_margins signed_problem_feasible estimate_allowed', 'estimated', '以约束下估计交付，逐项解释合法负流。', 'signed_problem_conflict'),
  estimate_single_region: rule('单区域表 · 区域化估计', 'regional_blocks_ready regional_prior_aligned external_use_bridge_ready balance_feasible estimate_allowed', 'estimated', '区外与进口泄漏单列后再考虑本地乘数。'),
  estimate_multi_region: rule('多区域表 · 贸易先验', 'regional_blocks_ready bilateral_prior_validated regional_constraints_feasible estimate_allowed', 'estimated', '区际块是研究情景，并非观测双边流量。'),
  compare_current_series: rule('现价结构对比序列', 'current_tables_aligned cross_time_classification_validated', 'feasible', '比较同口径现价结构，不解释为数量变化。'),
  attach_satellite_account: rule('卫星账户扩展', 'target_table_ready satellite_aligned', 'feasible', '可延伸到匹配的指标；跨境追踪另需境外数据。'),
  compile_enterprise: rule('企业内部投入产出表', 'enterprise_flow_blocks_ready enterprise_consolidation_ready', 'feasible', '仅适用于指定企业核算边界。'),
};

export const PURPOSES = {
  structure: ['结构分析', '现价表可比较结构；跨期比较先确认分类、估值及边界。'],
  multiplier: ['国内乘数', '竞争型表不能区分进口泄漏；须核验国内中间使用 Z_d 与生产性。'],
  regional: ['区际依赖', '双边依赖与跨区反馈不能由各地总量唯一确定。'],
  satellite: ['环境、能源与就业', '匹配行业、参考期及地区的卫星账户不可缺少。'],
  time: ['跨期与不变价', '现价比较不同于量变；须有分项价格桥才能编不变价表。'],
};

export const CANDIDATES = {
  structure: ['update_competitive_ras', 'reuse_published', 'estimate_z_only', 'survey_product'],
  multiplier: ['split_observed_imports', 'split_estimated_imports', 'update_competitive_ras'],
  regional: ['multi_region', 'estimate_multi_region', 'estimate_single_region'],
  satellite: ['attach_satellite_account', 'multi_region', 'reuse_published'],
  time: ['constant_price', 'compare_current_series', 'update_competitive_ras'],
};

export function assess(id, evidence) {
  const route = RULES[id];
  const verified = key => evidence[key]?.state === 'verified' && Boolean(evidence[key]?.note?.trim());
  const gaps = route.requires.filter(key => !verified(key));
  const conflict = verified('scope_ok') && route.conflicts.find(verified);
  return {
    id, title: route.title,
    status: conflict ? 'conflict' : gaps.length ? 'missing' : route.status,
    gaps, conflict: conflict || null, output: route.output,
    operator: id === 'update_competitive_ras' ? 'ras' : id === 'reuse_published' ? 'reuse' : 'not_implemented',
  };
}

export const SAMPLE = {
  region: '合成统计范围', base_year: 2022, year: 2023, classification: '合成产品分类 v1',
  valuation: 'current', price_basis: '同口径现价（合成）', unit: '合成金额单位', source: '设计方案 v0.4 §7.1，合成算例，非统计数据',
  usage_authorized: true, scope_aligned: true, estimation_allowed: true,
  sectors: ['产品 01', '产品 02'], final_uses: ['最终使用合计'], value_added: ['增加值合计'],
  z0: [[10, 10], [10, 10]], x: [120, 80], m: [10, 5], y: [[98], [53]], va: [[84, 52]],
};
