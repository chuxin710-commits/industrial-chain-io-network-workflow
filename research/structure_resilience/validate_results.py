"""Independent spot checks for aggregation, paired tests, and FE coefficients."""
from run_experiments import OUT, DATA
from model import ROOT
import json
import hashlib
from pathlib import Path
import numpy as np
import pandas as pd
from scipy.stats import t as t_distribution


def main():
    p=pd.read_csv(OUT/'node_panel.csv')
    checks={}
    raw=pd.read_csv(DATA/'2023'/'Z_2023.csv',index_col=0)
    aggregated=pd.read_csv(OUT/'aggregated'/'Z_2023.csv',index_col=0)
    checks['independent_S01_S02_aggregate']=bool(np.isclose(
        raw.loc[[s for s in raw.index if s.endswith('_S01')],
                [s for s in raw.columns if s.endswith('_S02')]].to_numpy().sum(),aggregated.loc['S01','S02']))
    # Full dummy regression is checked against a balanced-panel two-way within transform.
    variables=['resilience','degree','wages_share','tax_share','surplus_share','urban_share']
    values=p[variables]
    within=values-p.groupby('code')[variables].transform('mean')-p.groupby('year')[variables].transform('mean')+values.mean()
    coef=np.linalg.lstsq(within[variables[1:]].to_numpy(),within.resilience.to_numpy(),rcond=None)[0][0]
    regs=pd.read_csv(OUT/'regressions.csv')
    actual=regs.query('tag=="main" and metric=="degree" and term=="degree"').iloc[0]
    checks['independent_twfe_degree_difference']=float(abs(coef-actual.coefficient))
    differences=p[p.year==2023].set_index('code').degree-p[p.year==2020].set_index('code').degree
    t=float(differences.mean()/(differences.std(ddof=1)/np.sqrt(42)))
    prob=float(2*t_distribution.sf(abs(t),41))
    pair=pd.read_csv(OUT/'paired_comparison.csv').query('metric=="degree"').iloc[0]
    checks['independent_paired_t_difference']=float(abs(t-pair.t))
    checks['independent_paired_p_difference']=float(abs(prob-pair.p))
    audit=pd.read_csv(OUT/'data_audit.csv')
    checks['audit_finite']=bool(np.isfinite(audit[['input_gap_relative','output_gap_relative']]).all().all())
    checks['panel_complete_42_by_15']=bool(len(p)==630 and p.groupby('year').size().eq(42).all() and not p.duplicated(['year','code']).any())
    checks['binary_classes']=p.binary_resilience.value_counts().to_dict()
    checks['common_initial_2023_low_activity_fraction']=float(pd.read_csv(OUT/'ode_sensitivity.csv').query('scenario=="common_initial_q1" and year==2023').iloc[0].low_activity_fraction)
    assert checks['independent_S01_S02_aggregate'] and checks['audit_finite'] and checks['panel_complete_42_by_15']
    assert checks['independent_twfe_degree_difference']<1e-9 and checks['independent_paired_t_difference']<1e-9
    old=json.loads((OUT/'validation.json').read_text(encoding='utf-8'))
    old['independent_checks']=checks
    (OUT/'validation.json').write_text(json.dumps(old,ensure_ascii=False,indent=2,allow_nan=False),encoding='utf-8')
    manifests={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in ROOT.glob('*.py')}
    (OUT/'code_manifest.json').write_text(json.dumps(manifests,indent=2),encoding='utf-8')
    print(json.dumps(checks,ensure_ascii=False,indent=2))


if __name__=='__main__':main()
