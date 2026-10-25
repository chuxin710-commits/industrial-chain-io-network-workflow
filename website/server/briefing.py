"""Public headline index. No full-text scraping or model-generated reporting."""
import argparse
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
import hashlib
import html
import json
import os
from pathlib import Path
import re
import time
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

ROOT = Path(os.environ.get('CHAINLAB_BRIEFING_ROOT', '/var/lib/chainlab/briefing'))
TOPICS = {
    'industry': ('"industrial policy" OR "semiconductor manufacturing" OR "critical minerals"', '产业链 OR 半导体制造 OR 关键矿产'),
    'supply': ('"supply chain" OR "shipping disruption" OR "global logistics"', '供应链 OR 航运中断 OR 全球物流'),
    'ai': ('"artificial intelligence" breakthrough OR "AI model" release OR "AI research"', '人工智能 突破 OR 大模型 发布 OR AI 研究'),
}

def now_utc():
    return datetime.now(timezone.utc)

def safe_url(value):
    parsed = urlsplit(value or '')
    return value if parsed.scheme in ('http', 'https') and parsed.hostname and not parsed.username else ''

def relevant(title, source, topic):
    if any(word in source.casefold() for word in ('stocktwits', 'cmoney', '富途牛牛')):
        return False
    if re.search(r'market (size|forecast)|price target|stocks? to buy|看盤|看盘|飆股|飙股', title, re.I):
        return False
    if re.search(r'\b(estimates|financials|stock price|stock quote|earnings forecast)\s*[-–—]\s*(NASDAQ|NYSE|OTC|LSE|HKEX|TSX)\b', title, re.I):
        return False
    if re.search(r'\b(crystal meth|cocaine|heroin)\b|贩毒|販毒', title, re.I):
        return False
    if topic == 'ai':
        return bool(re.search(r'model|research|breakthrough|launch|release|benchmark|training|reasoning|robot|模型|研究|突破|發布|发布|開源|开源|推理|訓練|训练|机器人|機器人', title, re.I))
    return True

def parse_feed(payload, topic, edition, now):
    root = ET.fromstring(payload)
    items = []
    for entry in root.findall('./channel/item'):
        try:
            published = parsedate_to_datetime(entry.findtext('pubDate', ''))
            if published.tzinfo is None:
                continue
            published = published.astimezone(timezone.utc)
        except (ValueError, TypeError, OverflowError):
            continue
        if not now - timedelta(hours=72) <= published <= now:
            continue
        title = html.unescape(entry.findtext('title', '')).strip()
        source = html.unescape(entry.findtext('source', '')).strip()
        link = safe_url(entry.findtext('link', ''))
        if not title or not source or not link:
            continue
        if title.endswith(' - ' + source):
            title = title[:-(len(source) + 3)]
        if not relevant(title, source, topic):
            continue
        key = re.sub(r'\W+', '', title.casefold())
        items.append({'id': hashlib.sha256(key.encode()).hexdigest()[:20],
                      'title': title[:500], 'source': source[:120], 'url': link,
                      'published_at': published.isoformat(), 'topics': [topic],
                      'editions': [edition], 'link_type': 'Google News 原文跳转'})
    return items

def merge(items):
    unique = {}
    for item in items:
        if item['id'] not in unique:
            unique[item['id']] = item.copy()
        else:
            for field in ('topics', 'editions'):
                unique[item['id']][field] = sorted(set(unique[item['id']][field] + item[field]))
    return sorted(unique.values(), key=lambda item: (item['published_at'], item['id']), reverse=True)

def atomic(path, value):
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')
    os.replace(tmp, path)

def update(root=ROOT):
    root.mkdir(parents=True, exist_ok=True)
    now = now_utc()
    articles, feeds = [], []
    editions = [('US', 'en-US', 'US:en'), ('GB', 'en-GB', 'GB:en'),
                ('IN', 'en-IN', 'IN:en'), ('TW', 'zh-TW', 'TW:zh-Hant')]
    for country, language, edition in editions:
        for topic, queries in TOPICS.items():
            query = queries[1 if country == 'TW' else 0] + ' when:3d'
            url = 'https://news.google.com/rss/search?' + urlencode({'q': query, 'hl': language, 'gl': country, 'ceid': edition})
            record = {'edition': edition, 'topic': topic, 'url': url, 'ok': False}
            try:
                with urlopen(Request(url, headers={'User-Agent': 'CHAINLAB-Briefing/1.0 (public RSS reader)'}), timeout=15) as response:
                    payload = response.read(3_000_001)
                if len(payload) > 3_000_000:
                    raise ValueError('Feed too large')
                batch = parse_feed(payload, topic, edition, now)
                articles.extend(batch)
                record.update(ok=True, count=len(batch))
            except Exception as error:
                record['error'] = type(error).__name__
            feeds.append(record)
            time.sleep(.15)
    successes = sum(feed['ok'] for feed in feeds)
    status = {'attempted_at': now.isoformat(), 'successful_feeds': successes, 'total_feeds': len(feeds), 'feeds': feeds}
    atomic(root / 'status.json', status)
    if not successes:
        raise RuntimeError('All feeds failed; previous edition preserved')
    # Retain in-window items from failed sources, but keep their original publication dates.
    previous = []
    if (root / 'latest.json').exists():
        previous = json.loads((root / 'latest.json').read_text(encoding='utf-8')).get('items', [])
        previous = [item for item in previous if now - timedelta(hours=72) <= datetime.fromisoformat(item['published_at']) <= now
                    and any(relevant(item['title'], item['source'], topic) for topic in item['topics'])]
    items = merge(articles + previous)
    result = {**status, 'generated_at': now.isoformat(), 'window_hours': 72, 'items': items,
              'coverage': 'Google News 英美、印度及中文版本的公开订阅检索；面向全球议题，不代表全球全量覆盖。',
              'editorial': '按发布时间排序；标题近似规范化去重，不将转载次数视为热度。仅收录标题与来源，未独立核实报道，未自动认定技术突破。'}
    atomic(root / 'latest.json', result)
    atomic(root / (now.astimezone(timezone(timedelta(hours=8))).strftime('%Y-%m-%d') + '.json'), result)
    print(json.dumps({'items': len(items), 'successful_feeds': successes, 'total_feeds': len(feeds)}))

def editions(root=ROOT):
    return sorted([p.stem for p in root.glob('????-??-??.json')
                   if re.fullmatch(r'\d{4}-\d{2}-\d{2}', p.stem) and p.is_file()], reverse=True)[:366]


def read_briefing(root=ROOT, edition=None):
    if edition is not None:
        if not isinstance(edition, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', edition):
            raise ValueError('Invalid edition date')
        datetime.strptime(edition, '%Y-%m-%d')
    path = root / (edition + '.json' if edition else 'latest.json')
    if not path.exists():
        if edition:
            raise FileNotFoundError('Edition not available')
        return {'items': [], 'status': 'pending', 'message': '首期早报正在采集，请稍后再来。'}
    data = json.loads(path.read_text(encoding='utf-8'))
    now = now_utc()
    reference = datetime.fromisoformat(data['generated_at']) if edition else now
    data['items'] = [item for item in data['items'] if reference - timedelta(hours=72) <= datetime.fromisoformat(item['published_at']) <= reference]
    data['edition'] = edition
    data['window_end'] = reference.isoformat()
    data['window_start'] = (reference - timedelta(hours=72)).isoformat()
    if edition:
        data.update(status='archive', last_attempt={k: data.get(k) for k in ('feeds', 'successful_feeds', 'total_feeds', 'attempted_at')}, viewed_at=now.isoformat())
        return data
    data['items'] = [item for item in data['items'] if any(relevant(item['title'], item['source'], topic) for topic in item['topics'])]
    age = (now - datetime.fromisoformat(data['generated_at'])).total_seconds()
    attempt = json.loads((root / 'status.json').read_text(encoding='utf-8')) if (root / 'status.json').exists() else data
    data['status'] = 'stale' if age > 26 * 3600 or not attempt['successful_feeds'] else 'partial' if attempt['successful_feeds'] < attempt['total_feeds'] else 'ready'
    data['last_attempt'] = attempt
    data['viewed_at'] = now.isoformat()
    return data

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=ROOT)
    args = parser.parse_args()
    update(args.root)
