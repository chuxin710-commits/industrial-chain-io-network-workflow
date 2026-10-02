"""Isolate initial-state growth from network changes and review recent saturation."""
from run_experiments import OUT, YEARS, SEED, regress
from model import network, simulate, terminal_summary
import numpy as np
import pandas as pd


def main():
    import json
    config=json.loads((OUT/'config.json').read_text(encoding='utf-8'))
    panel=pd.read_csv(OUT/'node_panel.csv')
    alternative=panel.copy()
    parameter_table=pd.read_csv(OUT/'ode_parameters.csv')
    rows=[]
    for year in YEARS:
        z=pd.read_csv(OUT/'aggregated'/f'Z_{year}.csv',index_col=0).to_numpy()
        x=pd.read_csv(OUT/'aggregated'/f'X_controls_{year}.csv')['X'].to_numpy()
        l=np.linalg.solve(np.eye(42)-z/x[None,:],np.eye(42))
        w,_,_=network(l,config['threshold'])
        p=parameter_table[parameter_table.year==year]
        params={key:p[key].to_numpy() for key in ['b','k','c','d','e','h']}
        tr,_=simulate(w,params,np.ones(42),times=(0,10))
        r,level,low=terminal_summary(tr[:,:,-1],params['k'])
        alternative.loc[alternative.year==year,'resilience']=r
        rows.append(dict(year=year,scenario='common_initial_q1',mean_resilience=r.mean(),low_activity_fraction=low.mean()))
    sensitivities=pd.read_csv(OUT/'ode_sensitivity.csv')
    sensitivities=sensitivities[sensitivities.scenario!='common_initial_q1']
    pd.concat([sensitivities,pd.DataFrame(rows)],ignore_index=True).to_csv(OUT/'ode_sensitivity.csv',index=False)
    regression=pd.read_csv(OUT/'regressions.csv')
    regression=regression[~regression.tag.isin(['common_initial_q1','recent_2017_2023'])]
    extra=regress(alternative,tag='common_initial_q1')+regress(panel[panel.year>=2017].copy(),tag='recent_2017_2023')
    pd.concat([regression,pd.DataFrame(extra)],ignore_index=True).to_csv(OUT/'regressions.csv',index=False)
    alternative.to_csv(OUT/'common_initial_panel.csv',index=False)
    print(pd.DataFrame(rows).round(6).to_string(index=False))
    print(pd.DataFrame(extra).query('status != "estimated" or term==metric').to_string(index=False))


if __name__=='__main__':main()
