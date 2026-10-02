"""Agile v1: common definitions, paired shocks, lagged-target restoration."""
import argparse
import hashlib
import json
import platform
import time
from pathlib import Path
from model import *
import pandas as pd
import scipy

OUT = ROOT/'results'
YEARS = list(range(2009,2024))
SEED = 20261001


def write(rows, name):
    pd.DataFrame(rows).to_csv(OUT/name,index=False,encoding='utf-8-sig')


def sources(data):
    arrays, audits, manifest = {}, [], []
    previous_labels = None
    for year in YEARS:
        zp, xp = data/str(year)/f'Z_{year}.csv', data/str(year)/f'X_{year}.csv'
        zf, xf = pd.read_csv(zp,index_col=0), pd.read_csv(xp,index_col=0)
        labels = list(zf.index)
        assert labels == list(zf.columns) == list(xf.index)
        assert len(labels)==len(set(labels))==1302
        assert previous_labels is None or labels==previous_labels
        previous_labels=labels
        codes=sorted({s.rsplit('_',1)[1] for s in labels})
        assert codes==[f'S{i:02d}' for i in range(1,43)]
        assert len({s.rsplit('_',1)[0] for s in labels})==31
        group=np.eye(42)[[codes.index(s.rsplit('_',1)[1]) for s in labels]]
        rawz,rawx=zf.to_numpy(float),xf.iloc[:,0].to_numpy(float)
        assert np.isfinite(rawz).all() and np.isfinite(rawx).all()
        assert (rawz>=0).all() and (rawx>=0).all()
        z,x=group.T@rawz@group,group.T@rawx
        assert (x>0).all()
        a=z/x[None,:]
        rho=float(np.max(np.abs(np.linalg.eigvals(a))))
        assert rho<1
        arrays[year]=(z,x)
        pd.DataFrame(z,index=codes,columns=codes).to_csv(OUT/'aggregated'/f'Z_{year}.csv')
        pd.DataFrame({'code':codes,'X':x}).to_csv(OUT/'aggregated'/f'X_{year}.csv',index=False)
        audits.append(dict(year=year,nodes_raw=1302,nodes_aggregate=42,
                           z_aggregation_error=float(abs(z.sum()/rawz.sum()-1)),
                           x_aggregation_error=float(abs(x.sum()/rawx.sum()-1)),
                           raw_zero_x=int((rawx==0).sum()),rho_a=rho,
                           max_a_column_sum=float(a.sum(axis=0).max())))
        for p in [zp,xp]:
            manifest.append(dict(year=year,path=str(p.relative_to(data)),sha256=hashlib.sha256(p.read_bytes()).hexdigest()))
    write(audits,'source_audit.csv');write(manifest,'source_manifest.csv')
    return arrays,codes


def main(data):
    start=time.time()
    OUT.mkdir(exist_ok=True);(OUT/'aggregated').mkdir(exist_ok=True)
    arrays,codes=sources(data)
    z0,x0=arrays[2009]
    tau=float((z0/x0[None,:])[~np.eye(42,dtype=bool)].mean())
    cal=calibration(network(z0,x0,tau))
    rng=np.random.default_rng(SEED)
    random_sets=np.array([rng.choice(42,5,replace=False) for _ in range(2000)])
    config=dict(version='v1',years=YEARS,codes=codes,seed=SEED,threshold=tau,
                threshold_rule='2009_mean_offdiagonal_A_strict_greater',
                support_rule='freeze_each_year_baseline_mask_during_shock_and_restoration',
                calibration=cal,shock_fraction=.5,equal_amount_rule='0.5*minimum_incident_offdiagonal_Z_in_year',
                intervention_years=[2020,2023],selection_lag=1,priority_multiplier=4,
                restoration_budget_shares=[.05,.1,.2],epsilon=1e-4,
                initial=[.95,.03,.02],horizon=5000,random_selection_draws=2000,
                threshold_factors=[0,.5,1,2],physical_unit='unknown',price_basis='unknown')
    (OUT/'config.json').write_text(json.dumps(config,indent=2),encoding='utf-8')
    annual,nodes,shocks,rankrows=[],[],[],[]
    ranking_cache={}
    for year in YEARS:
        z,x=arrays[year];w=network(z,x,tau);mask=w>0
        metrics,summary=topology(w);scores,ew=topsis(metrics)
        base,_=evaluate(w,cal)
        amounts=incident_amounts(z);equal_budget=.5*amounts.min()
        retained=float((z*mask).sum()/(z.sum()-np.trace(z)))
        annual.append(dict(year=year,**summary,**base,retained_flow_share=retained,equal_shock_amount=equal_budget))
        impacts={}
        for mode in ['proportional','equal_amount']:
            losses=[]
            for i,code in enumerate(codes):
                fraction=.5 if mode=='proportional' else equal_budget/amounts[i]
                damaged=apply_shock(z,i,fraction)
                dw=network(damaged,x,mask=mask)
                result,_=evaluate(dw,cal)
                loss=1-result['cohesion']/base['cohesion'];losses.append(loss)
                shocks.append(dict(year=year,code=code,mode=mode,shock_fraction=fraction,
                                   removed_amount=float((z-damaged).sum()),efficiency_loss=loss,
                                   icr_change=result['ICR']/base['ICR']-1,
                                   peak_change=result['peak_I']-base['peak_I'],
                                   affected_change=result['ever_affected']-base['ever_affected'],
                                   recovery_change=result['T']-base['T'],**result))
            impacts[mode]=np.array(losses)
            rankrows.append(dict(year=year,mode=mode,**ranking_summary(scores,np.array(losses),random_sets)))
        ranking_cache[year]=dict(scores=scores,impacts=impacts,metrics=metrics)
        for i,code in enumerate(codes):
            nodes.append(dict(year=year,code=code,topsis=scores[i],output=x[i],incident_amount=amounts[i],
                              **dict(zip(METRICS,metrics[i])),
                              **{f'weight_{k}':v for k,v in zip(METRICS,ew)},
                              loss_proportional=impacts['proportional'][i],loss_equal=impacts['equal_amount'][i]))
        print('Unified baseline and paired shocks:',year,flush=True)
    write(annual,'annual.csv');write(nodes,'nodes.csv');write(shocks,'shocks.csv');write(rankrows,'ranking_comparison.csv')
    # Threshold and shock-depth sensitivity uses the same primary efficiency outcome.
    sensitivity=[]
    for year in [2009,2015,2020,2023]:
        z,x=arrays[year];amounts=incident_amounts(z)
        for factor in [0,.5,1,2]:
            w=network(z,x,tau*factor);mask=w>0
            metrics,summary=topology(w);scores,_=topsis(metrics);c=cohesion(w)
            for depth in [.25,.5,.75]:
                for mode in ['proportional','equal_amount']:
                    losses=[]
                    for i in range(42):
                        fraction=depth if mode=='proportional' else depth*amounts.min()/amounts[i]
                        damaged=apply_shock(z,i,fraction)
                        losses.append(1-cohesion(network(damaged,x,mask=mask))/c)
                    losses=np.array(losses)
                    sensitivity.append(dict(year=year,threshold_factor=factor,depth=depth,mode=mode,
                                             **summary,**ranking_summary(scores,losses,random_sets),
                                             structural_top5='|'.join(codes[i] for i in top_ids(scores)),
                                             impact_top5='|'.join(codes[i] for i in top_ids(losses))))
    write(sensitivity,'ranking_sensitivity.csv')
    policies,policy_summary,random_policy=[],[],[]
    for year in [2020,2023]:
        z,x=arrays[year];amounts=incident_amounts(z)
        lagz,lagx=arrays[year-1]
        for factor in [0,1]:
            w=network(z,x,tau*factor);mask=w>0
            lagw=network(lagz,lagx,tau*factor);lagc=cohesion(lagw)
            lagscores,_=topsis(topology(lagw)[0]);laga=incident_amounts(lagz)
            lagloss=[]
            for i in range(42):
                dz=apply_shock(lagz,i,.5*laga.min()/laga[i])
                lagloss.append(1-cohesion(network(dz,lagx,mask=lagw>0))/lagc)
            chosen={'structure':top_ids(lagscores),'impact':top_ids(lagloss)}
            structure_identified=bool(np.ptp(lagscores)>1e-12)
            if not structure_identified:
                chosen['structure']=np.array([],dtype=int)
            masks={s:priority_mask(z,w,s,chosen.get(s)) for s in ['structure','impact','weak','uniform']}
            # Weak-edge priorities also use last year's support and weights.
            masks['weak']=priority_mask(lagz,lagw,'weak')
            base,_=evaluate(w,cal)
            for i,code in enumerate(codes):
                damaged=apply_shock(z,i,.5*amounts.min()/amounts[i]);loss_amount=float((z-damaged).sum())
                dw=network(damaged,x,mask=mask);before,_=evaluate(dw,cal)
                for share in [.05,.1,.2]:
                    for strategy,preferred in masks.items():
                        restored=restore(z,damaged,share*loss_amount,preferred)
                        rw=network(restored,x,mask=mask)
                        after,_=evaluate(rw,cal)
                        policies.append(dict(year=year,code=code,strategy=strategy,threshold_factor=factor,
                                             budget_share=share,restored_amount=float((restored-damaged).sum()),
                                             loss_amount=loss_amount,
                                             efficiency_gain_pp=100*(after['cohesion']-before['cohesion'])/base['cohesion'],
                                             loss_repaired_share=(after['cohesion']-before['cohesion'])/(base['cohesion']-before['cohesion']),
                                             peak_change_pp=100*(after['peak_I']-before['peak_I']),
                                             affected_change_pp=100*(after['ever_affected']-before['ever_affected']),
                                             recovery_change=after['T']-before['T'],
                                             icr_change=after['ICR']/before['ICR']-1,
                                             min_lower_gap=float((restored-damaged).min()),
                                             max_upper_gap=float((restored-z).max()),
                                             max_input_share=float((restored/x[None,:]).sum(axis=0).max()),
                                             structure_target_identified=structure_identified,
                                             target_codes='|'.join(codes[j] for j in chosen.get(strategy,[]))))
                if factor==1:
                    for draw,ids in enumerate(random_sets[:100]):
                        preferred=priority_mask(z,w,'structure',ids)
                        restored=restore(z,damaged,.1*loss_amount,preferred)
                        gain=100*(cohesion(network(restored,x,mask=mask))-before['cohesion'])/base['cohesion']
                        random_policy.append(dict(year=year,code=code,draw=draw,efficiency_gain_pp=gain))
            print('Constrained lagged restoration:',year,'threshold',factor,flush=True)
    pf=pd.DataFrame(policies)
    for key,frame in pf.groupby(['year','threshold_factor','budget_share','strategy']):
        policy_summary.append(dict(zip(['year','threshold_factor','budget_share','strategy'],key))|
                              {c:float(frame[c].mean()) for c in ['efficiency_gain_pp','loss_repaired_share','peak_change_pp',
                                                               'affected_change_pp','recovery_change','icr_change']}|
                              dict(worse_peak_cases=int((frame.peak_change_pp>1e-9).sum()),
                                   worse_affected_cases=int((frame.affected_change_pp>1e-9).sum()),
                                   cases=len(frame)))
    write(policies,'policy_cases.csv');write(policy_summary,'policy_summary.csv');write(random_policy,'policy_random.csv')
    # Frozen mapping makes the model's built-in structure-to-rate relationship visible.
    dynamic=[]
    for year in [2009,2020,2023]:
        z,x=arrays[year];w=network(z,x,tau);base,_=evaluate(w,cal)
        for kfactor in [.5,1,2]:
            changed=cal|{'k_beta':cal['k_beta']*kfactor,'k_gamma':cal['k_gamma']*kfactor}
            for eps in [1e-3,1e-4,1e-5]:
                result,_=evaluate(w,changed,eps=eps)
                dynamic.append(dict(year=year,scenario='joint_mapping',kfactor=kfactor,eps=eps,**result))
        fixed=sir(cal['beta0'],cal['gamma0'])
        dynamic.append(dict(year=year,scenario='frozen_rates',kfactor=1,eps=1e-4,**fixed,cohesion=base['cohesion'],
                            beta=cal['beta0'],gamma=cal['gamma0'],ICR=base['cohesion']/fixed['T']))
    write(dynamic,'dynamic_sensitivity.csv')
    environment=dict(python=platform.python_version(),numpy=np.__version__,pandas=pd.__version__,
                     scipy=scipy.__version__,networkx=nx.__version__,elapsed_seconds=time.time()-start)
    (OUT/'environment.json').write_text(json.dumps(environment,indent=2),encoding='utf-8')
    print('Completed',round(time.time()-start,1),'seconds',flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--data-root',type=Path,default=ROOT.parent)
    main(parser.parse_args().data_root.resolve())
