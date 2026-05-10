from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAGES = [ROOT / "index.html", ROOT / "overseas" / "index.html"]


def read(path):
    return path.read_text(encoding="utf-8")


def test_filter_controls_exist_for_ongoing_and_wait_sections_on_both_pages():
    for path in PAGES:
        html = read(path)
        assert 'data-filter-section="ongoing"' in html
        assert 'data-filter-section="wait"' in html
        assert 'data-filter-value="all"' in html
        assert 'data-filter-value="image"' in html
        assert 'data-filter-value="video"' in html


def test_category_mapping_is_based_on_displayed_category_text_only():
    for path in PAGES:
        html = read(path)
        assert 'function categoryBuckets(item)' in html
        assert 'const text = String(item.category ||' in html
        # User-facing category text rules: 디자인 -> 이미지, 생성형 AI -> 영상.
        assert "디자인" in html and "image" in html
        assert "생성형 AI" in html and "video" in html
        # Classification must not inspect title/summary/body fields.
        category_fn = html.split('function categoryBuckets(item)', 1)[1].split('function ', 1)[0]
        forbidden = ['item.title', 'item.summary', 'item.description', 'item.content']
        assert not any(token in category_fn for token in forbidden)


def test_multi_category_items_are_not_reduced_to_single_bucket():
    for path in PAGES:
        html = read(path)
        assert 'buckets.add(' in html
        assert 'return Array.from(buckets)' in html
