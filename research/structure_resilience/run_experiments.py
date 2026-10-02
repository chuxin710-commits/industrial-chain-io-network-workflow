"""Rebuild this manuscript's experiments directly from the supplied annual MRIO."""
from pathlib import Path
import hashlib
import json
import platform
import sys
import time
from model import (ROOT, METRICS, leontief, network, graph_summary, entropy_topsis,
                   simulate, terminal_summary, cascade, rhs_batch)
import numpy as np
import pandas as pd
import scipy
from scipy import stats
import networkx as nx
import statsmodels
import statsmodels.formula.api as smf
from statsmodels.stats.multitest import multipletests

DATA = ROOT.parent
OUT = ROOT / 'results'
YEARS = list(range(2009, 2024))
SEED = 20261001


def save(rows, name):
    pd.DataFrame(rows).to_csv(OUT/name, index=False, encoding='utf-8-sig')


def read_source(year):
    frames = {kind:pd.read_csv(DATA/str(year)/f'{kind}_{year}.csv', index_col=0)
              for kind in ['Z','X','VA','F','M_inter','E','Err']}
    labels = list(frames['Z'].index)
    if labels != list(frames['Z'].columns) or len(set(labels)) != len(labels):
        raise ValueError('Duplicate or mismatched Z labels')
    for key in ['X','F','E','Err']:
        if list(frames[key].index) != labels:
            raise ValueError('Misaligned '+key)
    for key in ['VA','M_inter']:
        if list(frames[key].columns) != labels:
            raise ValueError('Misaligned '+key)
    if any(not np.isfinite(f.to_numpy(float)).all() for f in frames.values()):
        raise ValueError('Nonfinite source')
    codes = sorted({s.rsplit('_',1)[1] for s in labels})
    provinces = {s.rsplit('_',1)[0] for s in labels}
    if len(codes) != 42 or len(provinces) != 31 or len(labels) != 1302:
        raise ValueError('Unexpected node universe')
    groups = np.array([codes.index(s.rsplit('_',1)[1]) for s in labels])
    group = np.eye(42)[groups]
    zraw = frames['Z'].to_numpy(float)
    xraw = frames['X'].iloc[:,0].to_numpy(float)
    z, x = group.T @ zraw @ group, group.T @ xraw
    if not np.isclose(z.sum(), zraw.sum(),rtol=1e-12):
        raise RuntimeError('Aggregation is not conserving flow')
    va = frames['VA']
    controls = {}
    for row,key in [('VA_CompensationOfEmployees','wages_share'),
                    ('VA_NetTaxesOnProduction','tax_share'), ('VA_OperatingSurplus','surplus_share')]:
        controls[key] = group.T @ va.loc[row].to_numpy(float)/x
    f = frames['F']
    urban = f.loc[:,[c for c in f if c.endswith('_UrbanCon')]].sum(axis=1).to_numpy(float)
    controls['urban_share'] = group.T @ urban / x
    input_gap = xraw-zraw.sum(axis=0)-frames['VA'].sum(axis=0).to_numpy()-frames['M_inter'].sum(axis=0).to_numpy()
    output_gap = xraw-zraw.sum(axis=1)-f.sum(axis=1).to_numpy()-frames['E'].iloc[:,0].to_numpy()-frames['Err'].iloc[:,0].to_numpy()
    scale = np.maximum(np.abs(xraw), 1.0)
    audit = dict(year=year, raw_nodes=len(labels), provinces=len(provinces), sectors=len(codes),
                 negative_z=int((zraw<0).sum()), min_x=float(xraw.min()),zero_x=int((xraw==0).sum()),
                 input_gap_relative=float(np.max(np.abs(input_gap)/scale)),
                 output_gap_relative=float(np.max(np.abs(output_gap)/scale)))
    manifests = [dict(year=year, path=str((DATA/str(year)/f'{kind}_{year}.csv').relative_to(DATA)),
                      sha256=hashlib.sha256((DATA/str(year)/f'{kind}_{year}.csv').read_bytes()).hexdigest()) for kind in frames]
    return z,x,codes,controls,audit,manifests,labels


def regress(panel, tag='main', dependent='resilience', effects='two_way', controls=True):
    result_rows = []
    for metric in METRICS:
        terms = [metric]+(['wages_share','tax_share','surplus_share','urban_share'] if controls else [])
        fixed = ['C(code)']+(['C(year)'] if effects == 'two_way' else [])
        formula = dependent+' ~ '+' + '.join(terms+fixed)
        model = smf.ols(formula, data=panel)
        if np.linalg.matrix_rank(model.exog) != model.exog.shape[1]:
            result_rows.append(dict(tag=tag,metric=metric,status='rank_deficient',n=len(panel)))
            continue
        if panel[dependent].std() < 1e-5:
            result_rows.append(dict(tag=tag,metric=metric,status='near_constant_outcome',n=len(panel)))
            continue
        fit = model.fit(cov_type='cluster', cov_kwds={'groups':panel['code'], 'use_correction':True,
                                                    'df_correction':True}, use_t=True)
        for term in terms:
            result_rows.append(dict(tag=tag,metric=metric,term=term,status='estimated',
                                    coefficient=float(fit.params[term]), standard_error=float(fit.bse[term]),
                                    t=float(fit.tvalues[term]), p=float(fit.pvalues[term]),
                                    ci_low=float(fit.conf_int().loc[term,0]),ci_high=float(fit.conf_int().loc[term,1]),
                                    n=int(fit.nobs),clusters=panel.code.nunique(), effects=effects,
                                    adjusted_r2=float(fit.rsquared_adj), condition_number=float(fit.condition_number)))
    core = [r for r in result_rows if r.get('term')==r['metric'] and r['status']=='estimated']
    if core:
        for row,p in zip(core,multipletests([r['p'] for r in core],method='holm')[1]):
            row['p_holm_four'] = float(p)
    return result_rows


def main():
    started = time.time()
    OUT.mkdir(exist_ok=True)
    (OUT/'aggregated').mkdir(exist_ok=True)
    sources, audits, manifests = {}, [], []
    reference = None
    for year in YEARS:
        z,x,codes,controls,audit,manifest,labels = read_source(year)
        if reference is not None and labels != reference:
            raise ValueError('Cross-year node labels changed')
        reference = labels
        a,l,rho,error = leontief(z,x)
        audit.update(rho_a=rho,inverse_error=error)
        audits.append(audit); manifests.extend(manifest)
        sources[year] = dict(z=z,x=x,codes=codes,controls=controls,a=a,l=l)
        pd.DataFrame(z,index=codes,columns=codes).to_csv(OUT/'aggregated'/f'Z_{year}.csv')
        pd.DataFrame({'code':codes,'X':x,**controls}).to_csv(OUT/'aggregated'/f'X_controls_{year}.csv',index=False)
    save(audits,'data_audit.csv');save(manifests,'source_manifest.csv')
    first = sources[2009]
    tau = float(first['l'][~np.eye(42,dtype=bool)].mean())
    xseries = np.stack([sources[y]['x']/first['x'] for y in YEARS])
    k,c = xseries.max(axis=0), xseries.mean(axis=0)
    config = dict(years=YEARS,node_level='national_42_sector_aggregate',threshold=tau,
                  threshold_rule='2009_mean_offdiagonal_L_strict_greater', binary_topology=True,
                  edge_direction='supplier_row_to_buyer_column',ode_direction='incoming_W_transpose',
                  ode_denominator='d_i+e_i*u_i+h_i*u_j',source_formula_sensitivity='d_i+e_i+h_i*u_j',
                  normalization='X_it/X_i_2009',parameter_window=YEARS,
                  initial_amplitude=.2,trials=64,seed=SEED, main_terminal_time=10,
                  terminal_times=[5,10,20],rtol=1e-7,atol=1e-9,
                  robustness_draws=200, removal_nodes=5,cascade_tolerance=.1,
                  amount_unit='unknown',price_basis='unknown',sector_names='unverified')
    (OUT/'config.json').write_text(json.dumps(config,ensure_ascii=False,indent=2),encoding='utf-8')
    annual,nodes,weights,robust,parameters,trajectories,sensitivity = [],[],[],[],[],[],[]
    rng = np.random.default_rng(SEED)
    removals = [rng.choice(42,5,replace=False) for _ in range(200)]
    for year in YEARS:
        source = sources[year]
        w,g,m = network(source['l'],tau)
        summary,paths = graph_summary(g)
        scores,weight = entropy_topsis(m)
        b = source['a'].sum(axis=0)-np.diag(source['a'])
        params = dict(b=b,k=k,c=c,d=np.maximum(m[:,0],1e-8),e=paths,h=m[:,3])
        source.update(w=w,g=g,m=m,params=params,scores=scores)
        trajectory,nfev = simulate(w,params,source['x']/first['x'])
        main_state = trajectory[:,:,2]
        r,level,low = terminal_summary(main_state,k)
        residual = float(np.max(np.abs(rhs_batch(main_state,w,params))))
        source.update(resilience=r,level=level)
        annual.append(dict(year=year,**summary,resilience_mean=r.mean(),resilience_min=r.min(),
                           terminal_activity_mean=level.mean(),low_activity_fraction=low.mean(),
                           terminal_max_derivative=residual,nfev=nfev))
        for idx,t in enumerate([0,5,10,20]):
            if t:
                rt,lt,lowt = terminal_summary(trajectory[:,:,idx],k)
                sensitivity.append(dict(year=year,scenario=f'terminal_T{t}',mean_resilience=rt.mean(),
                                        low_activity_fraction=lowt.mean()))
            for i,code in enumerate(codes):
                trajectories.append(dict(year=year,time=t,code=code,mean=trajectory[i,:,idx].mean(),
                                         min=trajectory[i,:,idx].min(),max=trajectory[i,:,idx].max()))
        for i,code in enumerate(codes):
            nodes.append(dict(year=year,code=code,**dict(zip(METRICS,m[i])),topsis=scores[i],
                              resilience=r[i],binary_resilience=int(r[i]>.5),terminal_activity=level[i],
                              low_activity_fraction=low[i],**{key:value[i] for key,value in source['controls'].items()}))
            parameters.append(dict(year=year,code=code,**{key:value[i] for key,value in params.items()}))
        weights.extend(dict(year=year,metric=metric,weight=weight[i]) for i,metric in enumerate(METRICS))
        original=summary
        for draw,removed in enumerate(removals):
            sub=g.subgraph([i for i in range(42) if i not in removed])
            after,_=graph_summary(sub,denominator_n=42)
            robust.append(dict(year=year,draw=draw,removed_count=5,
                               path_ratio=after['path_reachable']/original['path_reachable'],
                               clustering_ratio=after['clustering']/original['clustering'],
                               efficiency_retained=after['efficiency']/original['efficiency'],
                               reachable_share=after['reachable_share']))
        print('Completed',year,'R=',round(r.mean(),5),flush=True)
    panel=pd.DataFrame(nodes)
    save(annual,'annual_metrics.csv');save(nodes,'node_panel.csv');save(weights,'entropy_weights.csv')
    save(parameters,'ode_parameters.csv');save(trajectories,'trajectories.csv');save(robust,'robustness_draws.csv')
    pd.DataFrame(robust).groupby('year').agg(
        path_ratio_mean=('path_ratio','mean'),path_ratio_sd=('path_ratio','std'),
        clustering_ratio_mean=('clustering_ratio','mean'),
        efficiency_mean=('efficiency_retained','mean'),efficiency_sd=('efficiency_retained','std'),
        efficiency_q025=('efficiency_retained',lambda s:s.quantile(.025)),
        efficiency_q975=('efficiency_retained',lambda s:s.quantile(.975))).reset_index().to_csv(OUT/'robustness_summary.csv',index=False)
    difference=[]
    p20=panel[panel.year==2020].set_index('code');p23=panel[panel.year==2023].set_index('code')
    for metric in METRICS:
        a,b=p20.loc[codes,metric].to_numpy(),p23.loc[codes,metric].to_numpy()
        delta=b-a
        stat=stats.ttest_rel(b,a)
        difference.append(dict(metric=metric,n=42,mean_2020=a.mean(),mean_2023=b.mean(),
                               mean_change=delta.mean(),t=float(stat.statistic),p=float(stat.pvalue),
                               paired_dz=delta.mean()/delta.std(ddof=1) if delta.std(ddof=1)>0 else np.nan))
    for row,p in zip(difference,multipletests([r['p'] for r in difference],method='holm')[1]):
        row['p_holm_four']=p
    save(difference,'paired_comparison.csv')
    regression=regress(panel,effects='industry',tag='industry_fe')+regress(panel)
    regression+=regress(panel,dependent='binary_resilience',tag='binary_lpm')
    regression+=regress(panel,controls=False,tag='no_controls')
    for scenario,amplitude,denominator,neutral,seed in [
            ('amplitude_01',.1,'corrected',False,SEED),('amplitude_03',.3,'corrected',False,SEED),
            ('literal_denominator',.2,'literal',False,SEED),('neutral_d_e_h',.2,'corrected',True,SEED),
            ('seed_alternative',.2,'corrected',False,SEED+1)]:
        alternative=panel.copy()
        for year in YEARS:
            source=sources[year];params={key:value.copy() for key,value in source['params'].items()}
            if neutral:
                params.update(d=np.ones(42),e=np.ones(42),h=np.ones(42))
            tr,_=simulate(source['w'],params,source['x']/first['x'],amplitude=amplitude,
                          denominator=denominator,seed=seed,times=(0,10))
            r,level,low=terminal_summary(tr[:,:,-1],k)
            alternative.loc[alternative.year==year,'resilience']=r
            sensitivity.append(dict(year=year,scenario=scenario,mean_resilience=r.mean(),low_activity_fraction=low.mean()))
        regression+=regress(alternative,tag=scenario)
        print('Sensitivity',scenario,flush=True)
    # Shorter and longer horizons retain the identical initial ensemble.
    for horizon in [5,20]:
        alternative=panel.copy()
        trtable=pd.DataFrame(trajectories)
        states=trtable[trtable.time==horizon].copy()
        states['resilience']=states['min']/states['max']
        alternative['resilience']=alternative[['year','code']].merge(states[['year','code','resilience']],on=['year','code'],validate='one_to_one')['resilience'].to_numpy()
        regression+=regress(alternative,tag=f'horizon_{horizon}')
    save(regression,'regressions.csv');save(sensitivity,'ode_sensitivity.csv')
    threshold_rows=[]
    for factor in [.5,1,1.5,2]:
        for year in [2009,2020,2023]:
            w,g,m=network(sources[year]['l'],tau*factor)
            summary,_=graph_summary(g);s,_=entropy_topsis(m)
            order=sorted(range(42),key=lambda i:(-s[i],codes[i]))
            threshold_rows.append(dict(year=year,threshold_factor=factor,**summary,
                                       top3=';'.join(codes[i] for i in order[:3])))
    save(threshold_rows,'threshold_sensitivity.csv')
    source=sources[2023]
    order=sorted(range(42),key=lambda i:(-source['scores'][i],codes[i]))
    cascade_rows,cascade_steps,cascade_nodes=[] ,[],[]
    for alpha in [0,.05,.1,.2,.5,1]:
        for attacked in order[:3]:
            failed,sub,steps,dropped=cascade(source['g'],[attacked],alpha)
            summary,_=graph_summary(sub,denominator_n=42)
            cascade_rows.append(dict(code=codes[attacked],tolerance=alpha,failed_count=len(failed),
                                     secondary_failed_count=len(failed)-1,failed_codes=';'.join(codes[i] for i in sorted(failed)),
                                     rounds=max(s['round'] for s in steps),dropped_load=dropped,**summary))
            cascade_steps.extend(dict(attacked=codes[attacked],tolerance=alpha,round=s['round'],
                                      failed_code=codes[s['failed_node']],load=s['load']) for s in steps)
            if alpha==.1:
                # Keep original ODE parameters and the same perturbations for surviving nodes.
                postw=source['w'].copy();postw[list(failed),:]=0;postw[:,list(failed)]=0
                tr,_=simulate(postw,source['params'],source['x']/first['x'],times=(0,10))
                r,level,low=terminal_summary(tr[:,:,-1],k)
                for i,code in enumerate(codes):
                    cascade_nodes.append(dict(attacked=codes[attacked],code=code,failed=i in failed,
                                              baseline_resilience=source['resilience'][i],
                                              survivor_resilience=np.nan if i in failed else r[i],
                                              change=np.nan if i in failed else r[i]-source['resilience'][i],
                                              baseline_activity=source['level'][i],
                                              survivor_activity=np.nan if i in failed else level[i]))
                survivors=[i for i in range(42) if i not in failed]
                cascade_rows[-1].update(survivor_resilience_mean=float(r[survivors].mean()) if survivors else np.nan,
                                        fixed_universe_resilience=float(r[survivors].sum()/42))
    save(cascade_rows,'cascades.csv');save(cascade_steps,'cascade_steps.csv');save(cascade_nodes,'cascade_node_effects.csv')
    checks={
        'annual_rows':len(annual),'panel_rows':len(nodes),'raw_sources':len(manifests),
        'max_io_input_gap_relative':max(r['input_gap_relative'] for r in audits),
        'max_io_output_gap_relative':max(r['output_gap_relative'] for r in audits),
        'max_inverse_residual':max(r['inverse_error'] for r in audits),
        'max_rho_a':max(r['rho_a'] for r in audits),
        'no_missing_panel':not panel.isna().any().any(),
        'range_resilience':bool(panel.resilience.between(0,1).all()),
        'seconds':time.time()-started}
    # One independent rerun at tighter solver tolerances checks numerical precision.
    tr,_=simulate(source['w'],source['params'],source['x']/first['x'],times=(0,10),rtol=1e-9,atol=1e-11)
    r,_,_=terminal_summary(tr[:,:,-1],k)
    checks['tighter_solver_max_resilience_difference']=float(np.max(np.abs(r-source['resilience'])))
    (OUT/'validation.json').write_text(json.dumps(checks,indent=2),encoding='utf-8')
    env=dict(python=sys.version,platform=platform.platform(),numpy=np.__version__,pandas=pd.__version__,
             scipy=scipy.__version__,networkx=nx.__version__,statsmodels=statsmodels.__version__)
    (OUT/'environment.json').write_text(json.dumps(env,indent=2),encoding='utf-8')
    code_hashes={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in ROOT.glob('*.py')}
    (OUT/'code_manifest.json').write_text(json.dumps(code_hashes,indent=2),encoding='utf-8')
    print(json.dumps(checks,indent=2),flush=True)


if __name__=='__main__':
    main()
