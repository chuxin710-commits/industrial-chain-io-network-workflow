"""Independent hand-calculated knowledge graph contracts and real source checks."""
import json
from pathlib import Path
import sys
import threading
import unittest
from urllib.request import urlopen
from urllib.error import HTTPError
from urllib.parse import urlsplit, parse_qs

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'server'))
from knowledge import build_graph, config_from, query, entity_list
from mrio import QueryError, axis_item, open_readonly, prepare_query, table
from topology import TopologyEngine
from app import create_server


class KnowledgeTests(unittest.TestCase):
    def setUp(self):
        self.rows = [axis_item(i, code) for i, code in enumerate(['Beijing_S01', 'Beijing_S02', 'Shanghai_S01'])]
        self.z = np.array([[5., 2., 1.], [3., 6., 4.], [7., 8., 9.]])
        self.x = np.array([10., 20., 40.])
        self.meta = {'source': 'fixture.csv', 'sha256': '0' * 64, 'unit': 'unknown'}

    def graph(self, **params):
        config = config_from({'level': 'node', 'entity': 'Beijing_S01', 'threshold': '0', 'limit': '1', **params})
        return build_graph(self.rows, self.z, self.x, self.meta, config)

    def test_direction_formula_and_evidence(self):
        graph = self.graph()
        self.assertEqual(len(graph['relations']), 4)
        first = graph['relations'][0]
        self.assertEqual(first['source'], 'node:Shanghai_S01')
        self.assertEqual(first['target'], 'node:Beijing_S01')
        self.assertEqual(first['coefficient'], .7)
        self.assertEqual(first['transaction'], 7)
        self.assertEqual(first['buyer_output'], 10)
        self.assertIn('row_province=Shanghai', first['table_url'])
        self.assertIn('col_province=Beijing', first['table_url'])
        self.assertIn('row_province=Beijing', first['output_url'])
        self.assertEqual({n['type'] for n in graph['nodes']}, {'node', 'province', 'sector', 'dataset', 'method'})
        self.assertEqual(sum(e['type'] == 'membership' for e in graph['edges']), 2)

    def test_aggregation_before_division(self):
        graph = self.graph(level='sector', entity='S01', limit='30')
        first = graph['relations'][0]
        self.assertEqual(first['transaction'], 10)
        self.assertEqual(first['buyer_output'], 20)
        self.assertEqual(first['coefficient'], .5)
        self.assertEqual(first['source'], 'sector:S01')
        self.assertNotIn('row_province', first['table_url'])

    def test_limits_do_not_remove_full_relations_and_dedup(self):
        small, large = self.graph(), self.graph(limit='30')
        self.assertEqual(small['summary']['hidden'], 3)
        strip = lambda g: [{k: v for k, v in r.items() if k != 'visible'} for r in g['relations']]
        self.assertEqual(strip(small), strip(large))
        expanded = self.graph(expanded='Beijing_S02,Beijing_S02', limit='30')
        self.assertEqual(len(expanded['relations']), 6)
        self.assertEqual(len({r['id'] for r in expanded['relations']}), 6)
        self.assertEqual(expanded, self.graph(expanded='Beijing_S02', limit='30'))

    def test_threshold_direction_and_empty(self):
        incoming = self.graph(direction='incoming', threshold='0.3')
        self.assertEqual(len(incoming['relations']), 2)
        self.assertTrue(all(r['target'] == incoming['root'] for r in incoming['relations']))
        outgoing = self.graph(direction='outgoing', threshold='0.1')
        self.assertEqual(len(outgoing['relations']), 1)
        empty = self.graph(threshold='9')
        self.assertEqual(empty['relations'], [])
        self.assertTrue(any(n['id'] == empty['root'] for n in empty['nodes']))

    def test_invalid_and_zero_output(self):
        for params in ({'threshold': 'nan'}, {'limit': '31'}, {'limit': '0'}, {'direction': 'wrong'},
                       {'year': '2024'}, {'expanded': 'a,b,c,d,e'}, {'extra': 'x'}):
            with self.assertRaises(QueryError): config_from(params)
        with self.assertRaises(QueryError): self.graph(entity='wrong')
        self.x[2] = 0
        with self.assertRaises(QueryError): self.graph(level='sector', entity='S01')
        self.z[:, 2] = 0; self.z[2, :] = 0
        graph = self.graph(entity='Shanghai_S01')
        self.assertEqual(graph['relations'], [])

    def test_real_data_evidence_matches_table_and_http(self):
        database = Path(__file__).resolve().parents[1] / 'var/mrio.sqlite3'
        if not database.exists(): self.skipTest('Private MRIO dataset absent')
        engine = TopologyEngine(database)
        self.assertEqual(len(entity_list(engine, {'year': '2023', 'level': 'node'})['entities']), 1302)
        for level, entity in [('sector', 'S01'), ('province', 'Beijing'), ('node', 'Beijing_S01')]:
            graph = query(engine, {'year': '2023', 'level': level, 'entity': entity})
            edge = graph['relations'][0]
            with open_readonly(database) as db:
                for key, expected in [('table_url', edge['transaction']), ('output_url', edge['buyer_output'])]:
                    params = {k: v[0] for k, v in parse_qs(urlsplit(edge[key]).query).items()}
                    params.update(row_limit='200', col_limit='60')
                    actual = table(db, prepare_query(db, params))
                    self.assertEqual(actual['source']['sha256'], graph['source']['sha256'])
                    self.assertAlmostEqual(sum(sum(row) for row in actual['values']), expected, places=5)
            self.assertAlmostEqual(edge['transaction'] / edge['buyer_output'], edge['coefficient'])
        server = create_server(database, port=0)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        base = f'http://127.0.0.1:{server.server_port}'
        try:
            with urlopen(base + '/api/knowledge?year=2000&level=sector&entity=S01') as response:
                self.assertEqual(json.load(response)['config']['year'], 2000)
            for path in ['/api/knowledge?entity=wrong', '/api/knowledge?entity=S01&entity=S02', '/api/knowledge/entities?year=2024']:
                with self.assertRaises(HTTPError) as e: urlopen(base + path)
                self.assertEqual(e.exception.code, 400)
        finally:
            server.shutdown(); server.server_close(); thread.join()


if __name__ == '__main__': unittest.main()
