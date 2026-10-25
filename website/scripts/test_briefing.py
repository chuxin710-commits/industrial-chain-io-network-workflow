import sys
from pathlib import Path
import unittest
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from tempfile import TemporaryDirectory
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'server'))
from briefing import parse_feed, merge, safe_url, atomic, read_briefing, update, editions, relevant

class BriefingTest(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026,10,23,0,tzinfo=timezone.utc)

    def payload(self, date, link='https://news.google.com/rss/articles/test'):
        return f'<rss><channel><item><title>New model - Publisher</title><source>Publisher</source><pubDate>{date}</pubDate><link>{link}</link></item></channel></rss>'.encode()

    def test_window_and_dates(self):
        for hours, expected in [(0,1),(72,1),(73,0),(-1,0)]:
            self.assertEqual(len(parse_feed(self.payload(format_datetime(self.now-timedelta(hours=hours))), 'ai','US',self.now)),expected)
        self.assertEqual(parse_feed(self.payload('invalid'),'ai','US',self.now),[])

    def test_merge_and_links(self):
        a = parse_feed(self.payload(format_datetime(self.now)),'ai','US',self.now)[0]
        b = {**a,'topics':['industry'],'editions':['TW']}
        result=merge([a,b])
        self.assertEqual(len(result),1)
        self.assertEqual(result[0]['title'],'New model')
        self.assertEqual(result[0]['topics'],['ai','industry'])
        self.assertFalse(safe_url('javascript:alert(1)'))
        self.assertFalse(safe_url('https://user:password@example.com'))

    def test_quote_pages_and_narcotics_are_not_industry_news(self):
        self.assertFalse(relevant('Supply Chain Service Inc. Estimates – NASDAQ:CTNT', 'TradingView', 'supply'))
        self.assertFalse(relevant('CRITICAL MINERALS LTD Estimates – OTC:BCMNF', 'TradingView', 'industry'))
        self.assertFalse(relevant('Crystal Meth Seized in Supply Chain', 'Publisher', 'supply'))
        self.assertTrue(relevant('Company estimates supply chain losses after factory shutdown', 'Publisher', 'supply'))
        self.assertTrue(relevant('AI research model estimates global pharmaceutical supply chain demand', 'Publisher', 'ai'))

    def test_expiry_stale_and_failure_preserves(self):
        with TemporaryDirectory() as folder:
            root=Path(folder)
            self.assertEqual(read_briefing(root)['status'],'pending')
            a=parse_feed(self.payload(format_datetime(self.now)),'ai','US',self.now)[0]
            value={'generated_at':(self.now-timedelta(hours=28)).isoformat(),'items':[a], 'successful_feeds':12,'total_feeds':12}
            atomic(root/'latest.json',value)
            with patch('briefing.now_utc',return_value=self.now):
                self.assertEqual(read_briefing(root)['status'],'stale')
            with patch('briefing.now_utc',return_value=self.now+timedelta(hours=73)):
                self.assertEqual(read_briefing(root)['items'],[])
            original=(root/'latest.json').read_bytes()
            with patch('briefing.urlopen',side_effect=OSError),patch('briefing.time.sleep'),patch('briefing.now_utc',return_value=self.now):
                with self.assertRaises(RuntimeError):update(root)
            self.assertEqual(original,(root/'latest.json').read_bytes())

    def test_archive_retains_original_window_not_current_time(self):
        with TemporaryDirectory() as folder:
            root = Path(folder)
            items = [parse_feed(self.payload(format_datetime(self.now)), 'ai', 'US', self.now)[0]]
            value = {'generated_at': self.now.isoformat(), 'items': items, 'successful_feeds': 12, 'total_feeds': 12, 'feeds': []}
            atomic(root / '2026-10-23.json', value)
            with patch('briefing.now_utc', return_value=self.now + timedelta(days=30)):
                data = read_briefing(root, '2026-10-23')
            self.assertEqual(data['status'], 'archive')
            self.assertEqual(data['items'], items)
            self.assertEqual(data['window_end'], self.now.isoformat())
            self.assertEqual(editions(root), ['2026-10-23'])
            with self.assertRaises(FileNotFoundError): read_briefing(root, '2026-10-22')
            for date in ['../../secret', '', '2026-02-30', '2026-1-1', 'latest', '2026-10-23.json']:
                with self.assertRaises(ValueError): read_briefing(root, date)

if __name__=='__main__':unittest.main()
