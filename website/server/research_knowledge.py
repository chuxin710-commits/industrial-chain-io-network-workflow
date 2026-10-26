"""Curated project interpretation notes, not claims attributed to the papers."""

NOTES = [
    ('direct', '方向、聚合与直接投入系数',
     '投入产出交易矩阵 Z 的行是供应方，列是使用方。A_ij=Z_ij/x_j，分母是使用方总产出。'
     '地区或行业聚合应先汇总 Z 与 x 再计算 A，不能直接平均系数。A 不是传播概率，Z 是交易金额而不是因果效应。'),
    ('support', '阈值网络与可视化骨架',
     '结构指标使用所有正权且大于等于阈值的非自环边。密度 E/[N(N-1)] 适用于保留全部节点的有向无自环网络。'
     '提高阈值可能删边、产生孤立点，但未跨过边权时网络不变。展示 top-K 或局部骨架只决定画哪些边，'
     '不改变此前全阈值网络的度和强度；画面没有连线不代表真实孤立。力导向距离不是经济距离。'),
    ('centrality', '关键节点是多维概念',
     '入强度为列和，出强度为行和，总强度是两者之和。A 的入强度反映直接中间投入系数之和；'
     'A 的出强度跨不同使用方分母累加，不能当作供应额或GDP份额。高强度不必然是桥梁、关键路径或系统性风险源。'
     '当前拓扑结果不包含介数、PageRank、社区或因果效应；不能凭图估计这些指标。相关分析需要另算并明确距离和方向。'),
    ('leontief', '直接联系与间接联系',
     'A 是直接投入系数，L=(I-A)^(-1) 是在投入产出模型假设下的完全需求系数。'
     '使用 L 前应核验谱半径 rho(A)<1、矩阵条件数和账户可用性。高密度不自动表示更强韧性。'
     'Leontief 需求模型默认固定投入配比，其乘数不是无需识别条件的因果效应。'),
    ('cascade', '级联风险与韧性的边界',
     '结构上的连接密集可提供替代可能，也可能扩大冲击传播。韧性须结合功能损失、恢复路径与恢复时间测量。'
     '容量级联需要额定负载、容量裕度、失效及负载重分配规则。没有这些参数，不能由强度排名断言某节点失效会引发级联。'
     '供应链安全还涉及集中依赖、关键投入可替代性、库存与外部暴露，不能等同于单一中心性。'),
    ('shock', '结构诊断之后的冲击实验',
     '必须交代冲击对象、幅度、时间、传播方向和终止条件。同百分比冲击与同金额冲击回答不同问题。'
     '应设置无干预基线和可比较预算，报告损失与恢复曲线及敏感性。条件模拟不是因果估计。'
     '推荐实验不是已经运行的实验，引用文献方法不能代替当前数据上的验证。'),
    ('contract', '跨年可比性与未核实元数据',
     '本库2000至2023年，省份乘行业共1302节点。S01至S42未取得可靠名称对照，不能猜行业名称。'
     '金额单位、价格基期和2D-LQ编制细节尚待核实，Z跨年变化不能当作实际增长。2005至2007年来源可比性待独立核实，'
     '跨越该区间的前后比较也应提示来源断点风险。跨年应固定层级、权重口径和阈值；聚合可能掩盖地区异质性。'),
    ('robustness', '可落实的核验路线',
     '先核验节点轴、零产出、缺失和负值，再比较多个阈值下的密度、孤立点与节点排名。'
     '分别报告入强度和出强度，避免方向误读；比较多年度、层级与权重口径，不能把不同参数的变化归因于经济演化。'
     '敏感性检验能揭示稳定性，但不能替代外部效度和因果识别。所有结果需保存数据哈希、代码版本与参数。'),
]

# Query expansion is explicit and versioned, not a claim of neural multilingual embeddings.
ALIASES = [
    ('投入产出', 'input output leontief interindustry'),
    ('产业链', 'production network industrial chain supply chain'),
    ('供应链', 'supply chain production network'),
    ('韧性', 'resilience robustness recovery'),
    ('冲击', 'shock disruption propagation'),
    ('级联', 'cascading failure contagion'),
    ('中心性', 'centrality pagerank betweenness'),
    ('强度', 'strength weighted degree'),
    ('密度', 'density connectivity'),
    ('安全', 'security risk vulnerability'),
    ('替代', 'substitution alternative paths'),
    ('恢复', 'recovery restoration'),
    ('阈值', 'threshold sparsification'),
]
