"""Independently validate the published synthetic illustration, not real empirical results."""
import json
from pathlib import Path
import unittest

import networkx as nx
import numpy as np

class MethodDemoTests(unittest.TestCase):
    def test_all_synthetic_states_and_efficiency(self):
        data = json.loads((Path(__file__).resolve().parents[1] / 'src/method-demo.json').read_text(encoding='utf-8'))
        self.assertTrue(data['synthetic'])
        self.assertEqual(len(data['frames']), 125)
        z, x = np.array(data['Z']), np.array(data['x'])
        np.testing.assert_allclose(data['A'], z / x[None,:])
        for frame in data['frames']:
            a = z / x[None,:]
            support = (a > 0) & (a >= frame['threshold'])
            np.fill_diagonal(support, False)
            touched = np.zeros_like(support); touched[1,:] = True; touched[:,1] = True
            np.fill_diagonal(touched, False)
            damaged = np.where(touched, z*(1-frame['fraction']), z)
            restored = damaged + (z-damaged)*frame['share']
            self.assertAlmostEqual(frame['loss'], float((z-damaged).sum()))
            self.assertAlmostEqual(frame['budget'], float((restored-damaged).sum()))
            for idx,(key,raw) in enumerate([('base',z),('damaged',damaged),('recovered',restored)]):
                w = np.where(support,raw/x[None,:],0)
                np.testing.assert_allclose(frame[key], w)
                graph=nx.DiGraph(); graph.add_nodes_from(range(3))
                for i,j in zip(*np.where(w>0)): graph.add_edge(int(i),int(j),cost=1/w[i,j])
                eff=sum(1/d for i,ds in nx.all_pairs_dijkstra_path_length(graph,weight='cost') for j,d in ds.items() if i!=j)/6
                self.assertAlmostEqual(frame['efficiency'][idx],eff,places=12)
            self.assertLessEqual(frame['efficiency'][1],frame['efficiency'][2]+1e-12)
            self.assertLessEqual(frame['efficiency'][2],frame['efficiency'][0]+1e-12)

    def test_fagiolo_matrix_formula_matches_networkx(self):
        for b in [np.array([[0,1,0],[0,0,1],[1,0,0]]),np.ones((3,3),dtype=int)-np.eye(3,dtype=int),np.array([[0,1,1],[1,0,0],[0,0,0]])]:
            g=nx.from_numpy_array(b,create_using=nx.DiGraph)
            degree=b.sum(0)+b.sum(1); reciprocal=(b*b.T).sum(1)
            numerator=np.diag(np.linalg.matrix_power(b+b.T,3))
            denominator=2*(degree*(degree-1)-2*reciprocal)
            actual=np.divide(numerator,denominator,out=np.zeros(3),where=denominator>0)
            np.testing.assert_allclose(actual,[nx.clustering(g,i) for i in range(3)])

if __name__ == '__main__': unittest.main()
