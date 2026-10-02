import unittest
from model import *


class UnifiedModelTests(unittest.TestCase):
    def setUp(self):
        self.z=np.array([[2.,4.,1.],[3.,2.,5.],[2.,1.,3.]])
        self.x=np.array([20.,25.,30.])

    def test_currency_invariance(self):
        np.testing.assert_allclose(network(self.z,self.x),network(self.z*100,self.x*100))

    def test_self_loops_excluded(self):
        np.testing.assert_array_equal(np.diag(network(self.z,self.x)),np.zeros(3))

    def test_buyer_normalization(self):
        self.assertAlmostEqual(network(self.z,self.x)[0,1],4/25)

    def test_invalid_output(self):
        with self.assertRaises(ValueError):network(self.z,np.array([0.,1.,1.]))

    def test_threshold_strict(self):
        self.assertEqual(network(self.z,self.x,4/25)[0,1],0)

    def test_frozen_support(self):
        w=network(self.z,self.x,.1)
        after=network(self.z*.1,self.x,mask=w>0)
        np.testing.assert_array_equal(after>0,w>0)

    def test_cohesion_manual_directed_chain(self):
        w=np.array([[0.,1.,0.],[0.,0.,1.],[0.,0.,0.]])
        self.assertAlmostEqual(cohesion(w),2.5/6)

    def test_node_universe_not_shrunk(self):
        w=network(self.z,self.x)
        w[0,:]=0;w[:,0]=0
        self.assertEqual(w.shape,(3,3))
        self.assertAlmostEqual(cohesion(w),(5/30+1/25)/6)

    def test_shock_only_once_and_diagonal_unchanged(self):
        out=apply_shock(self.z,1,.5)
        np.testing.assert_array_equal(np.diag(out),np.diag(self.z))
        self.assertEqual(out[0,1],2)
        self.assertEqual(out[0,2],1)

    def test_equal_removed_amounts(self):
        amounts=incident_amounts(self.z);budget=.5*amounts.min()
        for i in range(3):
            self.assertAlmostEqual((self.z-apply_shock(self.z,i,budget/amounts[i])).sum(),budget)

    def test_constant_topsis(self):
        score,weights=topsis(np.ones((5,4)))
        np.testing.assert_array_equal(score,np.full(5,.5))
        self.assertEqual(weights.sum(),0)

    def test_outgoing_closeness(self):
        m,_=topology(np.array([[0.,1.,0.],[0.,0.,1.],[0.,0.,0.]]))
        self.assertGreater(m[0,1],m[2,1])

    def test_restoration_bounds_and_budget(self):
        damaged=apply_shock(self.z,1,.8)
        preferred=incident(self.z,0)
        for share in [.1,.8,1.]:
            budget=share*(self.z-damaged).sum()
            out=restore(self.z,damaged,budget,preferred,20)
            self.assertTrue((out>=damaged-1e-9).all())
            self.assertTrue((out<=self.z+1e-9).all())
            self.assertAlmostEqual((out-damaged).sum(),budget)

    def test_uniform_restore_analytical(self):
        damaged=apply_shock(self.z,1,.5)
        out=restore(self.z,damaged,.1*(self.z-damaged).sum(),np.zeros_like(self.z,dtype=bool))
        np.testing.assert_allclose(out,damaged+.1*(self.z-damaged))

    def test_reject_infeasible_budget(self):
        with self.assertRaises(ValueError):restore(self.z,self.z,1,np.zeros_like(self.z,dtype=bool))

    def test_sir_conservation_and_burden_identity(self):
        result=sir(.3,.1)
        self.assertLess(result['conservation_error'],1e-10)
        self.assertAlmostEqual(result['burden'],(result['ever_affected']-result['terminal_I'])/.1,places=5)
        self.assertFalse(result['censored'])


if __name__=='__main__':unittest.main(verbosity=2)
