import unittest
from model import leontief, network, graph_summary, entropy_topsis, rhs_batch, simulate, terminal_summary, cascade
import numpy as np
import networkx as nx


class ModelTests(unittest.TestCase):
    def test_leontief_exact(self):
        a,l,rho,error=leontief(np.diag([2.,3.]),[10.,10.])
        np.testing.assert_allclose(l,np.diag([1.25,1/.7]))
        self.assertLess(error,1e-12)

    def test_currency_invariance(self):
        z=np.array([[2.,1.],[1.,3.]])
        np.testing.assert_allclose(leontief(z,[10,12])[1],leontief(z*1e6,np.array([10,12])*1e6)[1])

    def test_nonproductive_rejected(self):
        with self.assertRaises(ValueError):leontief(np.eye(2),np.ones(2))

    def test_diagonal_removed_for_graph_only(self):
        l=np.array([[2.,.1],[.2,3.]])
        w,g,m=network(l,.1)
        self.assertEqual(g.number_of_edges(),1)
        self.assertEqual(l[0,0],2)
        self.assertTrue((m[:,0]<=1).all())

    def test_outgoing_closeness(self):
        _,g,m=network(np.array([[1.,1.],[0.,1.]]),.5)
        self.assertEqual(m[0,1],1)
        self.assertEqual(m[1,1],0)

    def test_fixed_efficiency_denominator(self):
        g=nx.DiGraph([(0,1),(1,0)])
        summary,_=graph_summary(g,3)
        self.assertAlmostEqual(summary['efficiency'],1/3)

    def test_topsis_constant(self):
        score,weights=entropy_topsis(np.ones((5,4)))
        np.testing.assert_allclose(score,.5)
        np.testing.assert_allclose(weights,0)

    def test_topsis_best_and_constant_weight(self):
        score,weights=entropy_topsis([[0.,2.],[1.,2.],[2.,2.]])
        np.testing.assert_allclose(score,[0,.5,1])
        np.testing.assert_allclose(weights,[1,0])

    def test_ode_incoming_direction(self):
        params={key:np.ones(2) for key in ['k','c','d']}
        params.update(b=np.zeros(2),e=np.zeros(2),h=np.zeros(2))
        deriv=rhs_batch(np.ones((2,2)),np.array([[0.,2.],[0.,0.]]),params)
        np.testing.assert_allclose(deriv,[[0,0],[2,2]])

    def test_seed_determinism(self):
        params={key:np.ones(2) for key in ['k','c','d','e','h']}
        params['b']=np.ones(2)*.1
        a,_=simulate(np.zeros((2,2)),params,np.ones(2),trials=3,times=(0,1))
        b,_=simulate(np.zeros((2,2)),params,np.ones(2),trials=3,times=(0,1))
        np.testing.assert_array_equal(a,b)

    def test_terminal_zero_is_not_healthy(self):
        r,mean,low=terminal_summary(np.zeros((2,3)),np.ones(2))
        np.testing.assert_allclose(r,0)
        np.testing.assert_allclose(low,1)

    def test_cascade_total_failure_and_conservation(self):
        g=nx.complete_graph(3,create_using=nx.DiGraph)
        failed,sub,steps,dropped=cascade(g,[0],0)
        self.assertEqual(len(failed),3)
        self.assertEqual(len(sub),0)
        self.assertAlmostEqual(dropped,12)

    def test_cascade_buffer(self):
        g=nx.complete_graph(3,create_using=nx.DiGraph)
        failed,sub,steps,dropped=cascade(g,[0],1)
        self.assertEqual(failed,{0})
        self.assertEqual(dropped,0)


if __name__=='__main__':unittest.main(verbosity=2)
