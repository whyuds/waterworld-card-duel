"""Fit an anonymous observable-pool cost model; stdlib only, no game/network.

Input rows: {game, round:0..6, cost:0..5, counts:[remaining heroes per cost],
             test:bool}. Split WHOLE games prospectively before fitting.
Output weights are an effective conditional approximation, not server internals.
"""
import argparse,collections,json,math,pathlib

def fit(rows,kind='group'):
    theta=[[0.0]*6 for _ in range(7)]
    for stage in range(7):
        items=[r for r in rows if r['round']==stage]
        if not items:raise ValueError('每个阶段需要样本，包括起手阶段0')
        observed=[sum(r['cost']==c for r in items) for c in range(6)]
        patterns=collections.Counter(tuple(r['counts']) if kind=='card' else tuple(int(n>0) for n in r['counts']) for r in items)
        for _ in range(500):
            exp=[math.exp(v) for v in theta[stage]];grad=[n-.4*x for n,x in zip(observed,theta[stage])]
            for factors,count in patterns.items():
                weights=[v*n for v,n in zip(exp,factors)];den=sum(weights)
                for c in range(6):grad[c]-=count*weights[c]/den
            theta[stage]=[v+2*d/(len(items)+1) for v,d in zip(theta[stage],grad)]
            center=sum(theta[stage])/6;theta[stage]=[v-center for v in theta[stage]]
    return [[math.exp(v)/sum(math.exp(t) for t in row) for v in row] for row in theta]

def nll(rows,weights,kind='group'):
    loss=0.0
    for row in rows:
        factors=row['counts'] if kind=='card' else [int(n>0) for n in row['counts']]
        w=weights[row['round']]
        probability=w[row['cost']]/sum(v*n for v,n in zip(w,factors))
        if kind=='group':probability/=row['counts'][row['cost']]
        loss-=math.log(probability)
    return loss/len(rows)

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('input',type=pathlib.Path);parser.add_argument('output',type=pathlib.Path);args=parser.parse_args()
    rows=json.loads(args.input.read_text('utf8'))
    for r in rows:
        if not 0<=r['round']<=6 or not 0<=r['cost']<=5 or len(r['counts'])!=6 or min(r['counts'])<0 or r['counts'][r['cost']]<=0:raise ValueError('非法观测')
    train=[r for r in rows if not r['test']];test=[r for r in rows if r['test']]
    if not train or not test or {r['game'] for r in train}&{r['game'] for r in test}:raise ValueError('训练与留出必须按整局分离')
    models={}
    for kind in ['group','card']:
        weights=fit(train,kind)
        models[kind]={'holdoutNllPerCard':nll(test,weights,kind),'trainedWeights':weights,'allDataWeights':fit(rows,kind)}
    args.output.write_text(json.dumps({'games':len({r['game'] for r in rows}),'trainCards':len(train),'holdoutCards':len(test),'models':models,'warning':'Only visible-pool conditional likelihood. Unknown opponent hands/reservations prevent identification of the exact server law.'},indent=2),'utf8')

if __name__=='__main__':main()
