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


def test_card_list_view_toggle_is_grouped_with_top_button_on_both_pages():
    for path in PAGES:
        html = read(path)
        assert 'class="floating-tools"' in html
        assert 'id="viewToggle"' in html
        assert 'data-view-mode="card"' in html
        assert '카드형' in html
        assert '리스트형' in html
        assert 'function setViewMode(mode)' in html
        assert "document.body.dataset.viewMode = mode" in html
        assert 'aria-label="리스트형으로 보기"' in html
        # Keep the floating group just outside the content card line, matching the domestic reference placement.
        assert 'right: max(18px, calc((100vw - var(--max)) / 2 - 72px))' in html
        # The view toggle should live near the existing top button, not inside a section.
        floating = html.split('class="floating-tools"', 1)[1].split('</div>', 1)[0]
        assert 'id="viewToggle"' in floating
        assert 'id="toTop"' in floating


def test_domestic_heading_matches_overseas_two_line_pattern():
    domestic = read(ROOT / "index.html")
    overseas = read(ROOT / "overseas" / "index.html")
    assert '<h1><span>국내</span><span>공모전 보드</span></h1>' in domestic
    assert '<h1><span>해외</span><span>공모전 보드</span></h1>' in overseas
