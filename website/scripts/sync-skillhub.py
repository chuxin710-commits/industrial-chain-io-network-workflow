"""Refresh the curated GitHub snapshot; no downloaded skill is executed."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from urllib.request import Request, urlopen


SOURCES = {
    'anthropics/skills': [
        ('frontend-design', '前端设计', '设计开发', '界面设计与前端实现'),
        ('webapp-testing', '网页测试', '质量验证', '基于浏览器的交互与页面验证'),
        ('mcp-builder', 'MCP 服务构建', '工具集成', '面向外部服务的工具接口开发'),
        ('skill-creator', '技能创作', '工具集成', '创建、测试与改进技能'),
        ('algorithmic-art', '算法视觉创作', '设计开发', '用代码构建生成式视觉作品'),
        ('theme-factory', '视觉主题配置', '设计开发', '为文档、演示与网页建立统一视觉主题'),
    ],
    'obra/superpowers': [
        ('brainstorming', '需求与方案讨论', '研究规划', '在实施前厘清目标、约束与设计方向'),
        ('writing-plans', '实施计划', '研究规划', '拆解工作步骤与验证节点'),
        ('systematic-debugging', '系统化排错', '质量验证', '按证据定位问题并验证修复'),
        ('test-driven-development', '测试驱动开发', '质量验证', '围绕预期行为组织测试与实现'),
        ('verification-before-completion', '交付前核验', '质量验证', '在报告完成之前检查实际运行证据'),
    ],
}


def fetch(url):
    with urlopen(Request(url, headers={'User-Agent': 'ChainLab-SkillHub/1.0'}), timeout=40) as response:
        return response.read()


def main():
    items = []
    checked = datetime.now(timezone.utc).isoformat()
    for repo, skills in SOURCES.items():
        metadata = json.loads(fetch('https://api.github.com/repos/' + repo))
        commit = json.loads(fetch(f'https://api.github.com/repos/{repo}/git/ref/heads/{metadata["default_branch"]}'))['object']['sha']
        for slug, title, category, summary in skills:
            path = f'skills/{slug}/SKILL.md'
            body = fetch(f'https://raw.githubusercontent.com/{repo}/{commit}/{path}').decode('utf-8')
            license_path = f'skills/{slug}/LICENSE.txt' if repo == 'anthropics/skills' else 'LICENSE'
            license_text = fetch(f'https://raw.githubusercontent.com/{repo}/{commit}/{license_path}').decode('utf-8')
            items.append(dict(id=repo.split('/')[0] + '--' + slug, name=slug, title=title,
                              category=category, summary=summary, repo=repo, commit=commit,
                              path=path, content=body, stars=metadata['stargazers_count'],
                              license='Apache-2.0' if repo == 'anthropics/skills' else (metadata.get('license') or {}).get('spdx_id', 'SEE SOURCE'),
                              license_text=license_text,
                              source=f'https://github.com/{repo}/blob/{commit}/{path}',
                              archive=f'https://github.com/{repo}/archive/{commit}.zip',
                              sha256=hashlib.sha256(body.encode()).hexdigest(), updated=checked))
        print(f'{repo}: {len(skills)} skills, {metadata["stargazers_count"]} repository stars')
    target = Path(__file__).resolve().parents[1] / 'server/skillhub_catalog.json'
    target.write_text(json.dumps({'checked_at': checked, 'items': items}, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'Saved {len(items)} skills')


if __name__ == '__main__':
    main()
