import sys
from pathlib import Path
import unittest
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from tempfile import TemporaryDirectory
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'server'))
from briefing import parse_feed, merge, safe_url, atomic, read_briefing, update

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

if __name__=='__main__':unittest.main()
