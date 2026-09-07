import hashlib
import json
import re
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAGES = {
    ROOT / "index.html": {
        "canonical": "https://junyeo217.github.io/ai-contest-board/",
        "fetch": "data/contests.json",
        "data": ROOT / "data" / "contests.json",
    },
    ROOT / "overseas" / "index.html": {
        "canonical": "https://junyeo217.github.io/ai-contest-board/overseas/",
        "fetch": "../data/overseas-contests.json",
        "data": ROOT / "data" / "overseas-contests.json",
    },
}
EXPECTED_DATA_HASHES = {
    "contests.json": "bca5a94995f7221bac38ac44df26dbfb41521f2b1060eae841cb4dc444cb7432",
    "overseas-contests.json": "a823c926b2de8256dcc32492961a1ecc1033dffdafac2f60e81d78de5f5fd9e2",
}


def read(path):
    return path.read_text(encoding="utf-8")


def fnv1a_js(value):
    hash_value = 2166136261
    encoded = value.encode("utf-16le")
    for offset in range(0, len(encoded), 2):
        code_unit = encoded[offset] | (encoded[offset + 1] << 8)
        hash_value ^= code_unit
        hash_value = (hash_value * 16777619) & 0xFFFFFFFF
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    if hash_value == 0:
        return "0"
    result = ""
    while hash_value:
        hash_value, remainder = divmod(hash_value, 36)
        result = digits[remainder] + result
    return result


class ProductionMigrationTests(unittest.TestCase):
    def test_source_json_matches_reviewed_snapshot(self):
        for name, expected in EXPECTED_DATA_HASHES.items():
            actual = hashlib.sha256((ROOT / "data" / name).read_bytes()).hexdigest()
            self.assertEqual(actual, expected)

    def test_build_is_zero_dependency_and_runs(self):
        source = read(ROOT / "build.mjs")
        self.assertNotIn("node_modules", source)
        self.assertNotRegex(source, r"from ['\"](?!node:)")
        subprocess.run(["node", "--check", "build.mjs"], cwd=ROOT, check=True)
        subprocess.run(["node", "build.mjs"], cwd=ROOT, check=True, capture_output=True, text=True)

    def test_pages_have_indexable_canonical_metadata(self):
        for page, config in PAGES.items():
            html = read(page)
            self.assertIn(f'<link rel="canonical" href="{config["canonical"]}">', html)
            self.assertIn('<meta name="robots" content="index,follow,', html)
            self.assertNotIn("noindex", html.lower())
            for token in ['property="og:title"', 'property="og:description"', 'property="og:url"', 'name="twitter:card"']:
                self.assertIn(token, html)
            for schema_type in ['"@type":"WebSite"', '"@type":"CollectionPage"', '"@type":"ItemList"', '"@type":"Person"']:
                self.assertIn(schema_type, html)
            self.assertNotIn("aggregateRating", html)

    def test_region_navigation_is_crawlable(self):
        for page in PAGES:
            html = read(page)
            self.assertIn('<a href="https://junyeo217.github.io/ai-contest-board/"', html)
            self.assertIn('<a href="https://junyeo217.github.io/ai-contest-board/overseas/"', html)
            self.assertNotIn('data-region=', html)

    def test_initial_list_and_fetch_fallback(self):
        for page, config in PAGES.items():
            html = read(page)
            data = json.loads(read(config["data"]))
            reference = data["generated_at"][:10]
            records = {}
            for key in ["starting_today", "ongoing", "awaiting_results"]:
                section = data["sections"].get(key, [])
                for item in section:
                    records.setdefault((item.get("title", ""), item.get("submission_end", "")), item)
            open_count = sum(
                not (re.fullmatch(r"\d{4}-\d{2}-\d{2}", item.get("submission_start", "")) and item["submission_start"] > reference)
                and not (re.fullmatch(r"\d{4}-\d{2}-\d{2}", item.get("submission_end", "")) and item["submission_end"] < reference)
                for item in records.values()
            )
            static_html = html.split('<script type="application/json" id="initial-data">', 1)[0]
            self.assertEqual(static_html.count('<article class="entry"'), open_count)
            self.assertIn(f'fetchPath":"{config["fetch"]}"', html)
            self.assertIn("fetch(options.fetchPath, { cache: 'no-store' })", html)
            self.assertIn("빌드 시 포함된 목록을 그대로 표시합니다", html)
            self.assertRegex(html, r"\.catch\(\(\) => \{ nodes\.warning\.hidden = false;")

    def test_inline_executable_javascript_parses(self):
        for page in PAGES:
            html = read(page)
            scripts = re.findall(r'<script(?![^>]*type="(?:application/ld\+json|application/json)")[^>]*>(.*?)</script>', html, re.S)
            self.assertEqual(len(scripts), 1)
            with tempfile.NamedTemporaryFile("w", suffix=".js", encoding="utf-8") as handle:
                handle.write(scripts[0])
                handle.flush()
                subprocess.run(["node", "--check", handle.name], check=True, capture_output=True, text=True)

    def test_filters_status_and_no_fake_engagement(self):
        for page in PAGES:
            html = read(page)
            for category in ["이미지", "영상", "디자인", "음악"]:
                self.assertIn(f'data-cat="{category}"', html)
            for status in ["open", "closed", "published"]:
                self.assertIn(f'data-status="{status}"', html)
            self.assertIn("results_confirmed === true", html)
            self.assertIn("age >= 7", html)
            for forbidden in ["관심순", "샘플 조회", "샘플 통계", "data-demo=", "demo-all", "class=\"test\""]:
                self.assertNotIn(forbidden, html)

    def test_music_video_whitelist_and_guidelines_are_preserved(self):
        template = json.loads(read(ROOT / "template.json"))
        self.assertGreaterEqual(len(template["musicVideoWhitelist"]), 8)
        self.assertEqual(len(template["guidelines"]), 62)
        for title in template["guidelines"]:
            self.assertTrue(any(title in read(page) for page in PAGES))
        for page in PAGES:
            match = re.search(r'<script type="application/json" id="initial-data">(.*?)</script>', read(page), re.S)
            embedded = json.loads(match.group(1))
            items = [item for values in embedded["sections"].values() for item in values]
            for item in items:
                if item["title"] in template["musicVideoWhitelist"]:
                    self.assertIn("음악", item["category"])
                    self.assertIn("영상", item["category"])

    def test_stable_anchor_uses_title_and_submission_end(self):
        for page, config in PAGES.items():
            data = json.loads(read(config["data"]))
            first = next(item for values in data["sections"].values() for item in values)
            expected = "contest-" + fnv1a_js(first["title"] + "|" + first["submission_end"])
            self.assertIn(f'id="{expected}"', read(page))

    def test_sitemap_and_robot_scope(self):
        sitemap = read(ROOT / "sitemap.xml")
        self.assertEqual(sitemap.count("<url>"), 2)
        self.assertIn("<lastmod>2026-09-08</lastmod>", sitemap)
        self.assertEqual(sitemap.count("<lastmod>2026-09-08</lastmod>"), 2)
        self.assertFalse((ROOT / "robots.txt").exists())


if __name__ == "__main__":
    unittest.main()
