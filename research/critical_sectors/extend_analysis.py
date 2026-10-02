"""Simple baselines, rank-size controls, and independent result validation."""
import json
from model import *
import pandas as pd
from scipy.stats import rankdata, pearsonr

OUT=ROOT/'results'
DATA=ROOT.parent


def main():
    panel=pd.read_csv(OUT/'nodes.csv')
    shocks=pd.read_csv(OUT/'shocks.csv')
    config=json.loads((OUT/'config.json').read_text())
    rng=np.random.default_rng(config['seed'])
    random_sets=np.array([rng.choice(42,5,replace=False) for _ in range(2000)])
    rows=[]
    ties=[]
    for year,frame in panel.groupby('year',sort=True):
        frame=frame.sort_values('code')
        z=pd.read_csv(OUT/'aggregated'/f'Z_{year}.csv',index_col=0).to_numpy(float)
        x=pd.read_csv(OUT/'aggregated'/f'X_{year}.csv').X.to_numpy()
        w=network(z,x,config['threshold'])
        m=frame[METRICS].to_numpy()
        scores3,_=topsis(m[:,:3])
        scaled=np.divide(m-m.min(axis=0),np.ptp(m,axis=0),out=np.zeros_like(m),where=np.ptp(m,axis=0)>1e-12)
        predictors={k:frame[k].to_numpy() for k in ['topsis',*METRICS,'output','incident_amount']}
        predictors.update(topsis_without_cluster=scores3,equal_weights=scaled.mean(axis=1),
                          strength=w.sum(axis=0)+w.sum(axis=1))
        for factor in [0,.5,1,2]:
            candidate,_=topsis(topology(network(z,x,config['threshold']*factor))[0])
            boundary=np.sort(candidate)[-5]
            ties.append(dict(year=year,threshold_factor=factor,score_spread=float(np.ptp(candidate)),
                             cutoff_tie_count=int(np.isclose(candidate,boundary,atol=1e-12,rtol=0).sum()),
                             identified=bool(np.ptp(candidate)>1e-12)))
        for mode,column in [('proportional','loss_proportional'),('equal_amount','loss_equal')]:
            impacts=frame[column].to_numpy()
            for name,values in predictors.items():
                controls=np.column_stack([np.ones(42),rankdata(frame.incident_amount)])
                sr,ir=rankdata(values),rankdata(impacts)
                sr-=controls@np.linalg.lstsq(controls,sr,rcond=None)[0]
                ir-=controls@np.linalg.lstsq(controls,ir,rcond=None)[0]
                partial=float(pearsonr(sr,ir).statistic) if sr.std()>1e-10 and ir.std()>1e-10 else np.nan
                rows.append(dict(year=year,mode=mode,predictor=name,partial_rank_incident=partial,
                                 **ranking_summary(values,impacts,random_sets)))
    pd.DataFrame(rows).to_csv(OUT/'predictor_comparison.csv',index=False,encoding='utf-8-sig')
    pd.DataFrame(ties).to_csv(OUT/'tie_audit.csv',index=False,encoding='utf-8-sig')
    # Independent all-pairs Dijkstra implementation of primary efficiency.
    year=2023
    zframe=pd.read_csv(OUT/'aggregated'/f'Z_{year}.csv',index_col=0)
    z=zframe.to_numpy();x=pd.read_csv(OUT/'aggregated'/f'X_{year}.csv').X.to_numpy()
    w=network(z,x,config['threshold']);g=nx.DiGraph();g.add_nodes_from(range(42))
    for i,j in zip(*np.nonzero(w)):g.add_edge(int(i),int(j),distance=1/w[i,j])
    efficiency=sum(1/d for i,dd in nx.all_pairs_dijkstra_path_length(g,weight='distance')
                   for j,d in dd.items() if i!=j)/(42*41)
    a=pd.read_csv(OUT/'annual.csv').set_index('year')
    assert np.isclose(efficiency,a.loc[2023,'cohesion'],rtol=1e-12)
    raw=pd.read_csv(DATA/'2023'/'Z_2023.csv',index_col=0)
    separate=float(raw.loc[raw.index.str.endswith('_S01'),raw.columns.str.endswith('_S02')].to_numpy().sum())
    assert np.isclose(separate,zframe.loc['S01','S02'],rtol=1e-12)
    assert len(shocks)==15*42*2 and len(panel)==15*42
    assert not panel.duplicated(['year','code']).any()
    assert (shocks.efficiency_loss>=-1e-12).all() and (shocks.efficiency_loss<=1+1e-12).all()
    equal=shocks[shocks['mode']=='equal_amount'].groupby('year').removed_amount
    equal_error=float(((equal.max()-equal.min())/equal.mean()).max())
    assert equal_error<1e-10
    p=pd.read_csv(OUT/'policy_cases.csv')
    assert len(p)==2*2*42*3*4
    assert p.min_lower_gap.min()>=-1e-8 and p.max_upper_gap.max()<=1e-8
    assert np.allclose(p.restored_amount,p.budget_share*p.loss_amount,rtol=1e-10)
    assert p.max_input_share.max()<1
    assert (p.efficiency_gain_pp>=-1e-9).all()
    targets=p[p.strategy.isin(['structure','impact'])].groupby(['year','threshold_factor','strategy']).target_codes.nunique(dropna=False)
    assert (targets==1).all()
    audit=dict(expected_model_tests=16,main_years=15,industry_years=630,shock_cases=len(shocks),
               restoration_cases=len(p),source_files=30,independent_2023_efficiency=efficiency,
               independent_efficiency_abs_error=abs(efficiency-a.loc[2023,'cohesion']),
               independent_S01_S02_aggregate=separate,equal_shock_relative_gap=equal_error,
               max_restored_input_share=float(p.max_input_share.max()),
               max_sir_conservation_error=float(shocks.conservation_error.max()),
               source_scope='Z and X reread directly; no new assertion of full national-account balancing',
               checks='passed',limitations=['sector names, units, price basis and 2D-LQ provenance missing',
                  'homogeneous SIR with assumed mappings, no causal identification',
                  'restored trade is not fiscal spending and no new balanced IO table is generated'])
    (OUT/'validation.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(audit,ensure_ascii=False,indent=2))


if __name__=='__main__':main()
