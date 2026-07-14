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
    assert '<h1>국내 공모전 보드</h1>' not in domestic
    assert '<h1>해외 공모전 보드</h1>' not in overseas


def test_pc_density_button_changes_desktop_title_scale():
    for path in PAGES:
        html = read(path)
        desktop_before_mobile = html.split('@media (max-width: 680px)', 1)[0]
        assert 'body[data-density="compact"] h1 { font-size: clamp(34px, 5.8vw, 64px); }' in desktop_before_mobile
        assert 'body[data-density="comfortable"] h1 { font-size: clamp(42px, 7vw, 78px); }' in desktop_before_mobile
        assert 'body[data-density="large"] h1 { font-size: clamp(50px, 7.8vw, 90px); }' in desktop_before_mobile
        assert 'body[data-density="compact"] .hero-card' in desktop_before_mobile
        assert 'body[data-density="large"] .summary-card' in desktop_before_mobile


def test_hero_copy_removed_but_correction_notice_remains():
    for path in PAGES:
        html = read(path)
        assert 'class="hero-copy"' not in html
        assert '<span class="notice-full">누락 혹은 수정이 필요한 공고가 있으면 채팅방에서 @주녀를 부르시거나, </span>' in html
        assert '<a href="https://open.kakao.com/o/sGUNzdui"' in html


def test_summary_header_is_inline_and_stats_link_to_sections():
    for path in PAGES:
        html = read(path)
        assert 'class="summary-head"' in html
        assert '<div class="label">Last update</div><div class="updated" id="updatedAt">불러오는 중</div>' in html
        assert '오늘 추가된 공고 수' not in html
        assert 'id="countStart"' not in html
        assert '오늘부터 시작' not in html
        assert 'class="stat stat-link"' in html
        assert 'href="#starting-today"' not in html
        assert 'href="#overseas-starting-today"' not in html
        assert 'aria-label="현재 진행중인 공모전으로 이동"' in html
        assert 'aria-label="종료 후 발표 대기 공모전으로 이동"' in html


def test_brand_byline_footer_notice_and_updated_timestamp_format_are_present():
    for path in PAGES:
        html = read(path)
        assert '<span class="brand-title">AI Contest Board</span>' in html
        assert '<span class="brand-subtitle">Curated by @주녀 · Updated daily</span>' in html
        assert '.brand-title { color: var(--ink); font-size: 18px;' in html
        assert '.brand-subtitle { color: var(--soft); font-size: 11px;' in html
        assert 'class="hero-byline"' not in html
        assert 'Sources belong to each organizer · © 2026' in html
        assert 'timeZone: \'Asia/Seoul\'' in html
        assert 'hour: \'2-digit\', minute: \'2-digit\', hour12: false' in html
        assert 'return `${parts.year}.${parts.month}.${parts.day} ${parts.hour}:${parts.minute}`;' in html


def test_starting_today_section_removed_from_body_and_actions():
    domestic = read(ROOT / "index.html")
    overseas = read(ROOT / "overseas" / "index.html")
    assert 'id="starting-today"' not in domestic
    assert 'id="overseas-starting-today"' not in overseas
    assert '오늘 시작 보기' not in domestic
    assert '오늘 시작 보기' not in overseas
    assert '오늘부터 시작한 공모전</h2>' not in domestic
    assert '오늘부터 시작한 공모전</h2>' not in overseas


def test_dday_visual_classes_keep_existing_text_labels():
    for path in PAGES:
        html = read(path)
        assert 'function dueClass(end)' in html
        assert 'due-day' in html
        assert 'due-week' in html
        assert 'due-fortnight' in html
        assert 'due-later' in html
        assert "return `D-${d}`" in html
        assert "return '7일전'" not in html
        assert "return '14일전'" not in html


def test_mobile_list_view_has_mobile_only_compact_rules_without_changing_pc_list_rules():
    for path in PAGES:
        html = read(path)
        mobile_block = html.split('@media (max-width: 680px)', 1)[1]
        assert 'body[data-view-mode="list"] .contest-card { border-radius: 16px; padding: 12px 14px;' in mobile_block
        assert 'body[data-view-mode="list"] .card-top { margin-bottom: 8px; }' in mobile_block
        assert 'body[data-view-mode="list"] .contest-card h3 { font-size: 16px;' in mobile_block
        assert 'body[data-view-mode="list"] .summary { display: none; }' in mobile_block
        assert 'body[data-view-mode="list"] .official, body[data-view-mode="list"] .reference { min-height: 32px;' in mobile_block
        assert 'body[data-view-mode="list"] .link-missing { margin-top: 6px; padding-top: 0;' in mobile_block

        desktop_before_mobile = html.split('@media (max-width: 680px)', 1)[0]
        assert 'body[data-view-mode="list"] .contest-card { min-height: 0; padding: 16px 18px; }' in desktop_before_mobile
        assert 'body[data-view-mode="list"] .summary { display: none; }' not in desktop_before_mobile


def test_default_view_mode_is_card_on_pc_and_list_on_mobile():
    for path in PAGES:
        html = read(path)
        assert 'function defaultViewMode()' in html
        assert "window.matchMedia('(max-width: 680px)').matches ? 'list' : 'card'" in html
        assert "setViewMode(defaultViewMode())" in html
        assert "setViewMode(document.body.dataset.viewMode || 'card')" not in html


def test_hero_notice_has_no_leading_rule_and_keeps_link_inline():
    for path in PAGES:
        html = read(path)
        assert '.hero-notice::before' not in html
        assert '.hero-notice br + a' not in html
        assert '<br><a href="https://open.kakao.com/o/sGUNzdui"' not in html
        assert '<span class="notice-full">누락 혹은 수정이 필요한 공고가 있으면 채팅방에서 @주녀를 부르시거나, </span>' in html
        assert '<span class="notice-short">누락/수정 제보는 @주녀 또는 </span>' in html
        assert '>여기</a>를 눌러주세요.' in html


def test_hero_section_jump_buttons_are_kept_for_quick_navigation():
    for path in PAGES:
        html = read(path)
        assert 'class="hero-actions"' in html
        assert '진행중 보기' in html
        assert '발표대기 보기' in html
        assert '<a class="btn primary"' in html


def test_section_counts_are_inline_with_titles_not_separate_right_pills():
    for path in PAGES:
        html = read(path)
        assert 'class="section-count"' in html
        assert '<h2>현재 진행중인 공모전 <span class="section-count" id="pillOngoing">0건</span></h2>' in html
        assert '<h2>종료 후 발표 대기 공모전 <span class="section-count" id="pillWait">0건</span></h2>' in html
        assert 'class="pill" id="pillOngoing"' not in html
        assert 'class="pill" id="pillWait"' not in html


def test_sections_are_not_collapsible():
    for path in PAGES:
        html = read(path)
        assert 'data-collapsible-section="ongoing"' not in html
        assert 'data-collapsible-section="wait"' not in html
        assert 'function setSectionCollapsed(section, collapsed)' not in html
        assert 'function toggleSection(section)' not in html
        assert 'hidden = collapsed' not in html


def test_default_lists_are_sorted_by_earliest_submission_end():
    for path in PAGES:
        html = read(path)
        assert 'function sortBySubmissionEnd(items)' in html
        assert 'sortItems(filterByCategory(ongoing, state.filters.ongoing))' in html
        assert 'sortItems(filterByCategory(waiting, state.filters.wait))' in html
        assert 'new Date(`${value}T00:00:00`).getTime()' in html


def test_expired_ongoing_items_are_automatically_rendered_as_awaiting_results():
    for path in PAGES:
        html = read(path)
        assert 'function normalizeSections(sections = {})' in html
        assert "['starting_today', 'ongoing', 'awaiting_results'].forEach" in html
        assert 'if (Number.isFinite(end) && end < today) waiting.push(item);' in html
        assert 'else if (start <= today && today <= end) ongoing.push(item);' in html
        assert 'const s = normalizeSections(data.sections || {});' in html


def test_pc_sort_dropdown_sits_on_filter_row():
    for path in PAGES:
        html = read(path)
        assert 'class="filter-row"' in html
        assert '<select class="sort-select" id="sortSelect" aria-label="공모전 정렬 방식">' in html
        assert '<option value="deadline">마감임박순</option>' in html
        assert '<option value="latest">최신순</option>' in html
        assert 'function sortItems(items)' in html
        assert "state.sort === 'latest'" in html
        assert "nodes.sortSelect.addEventListener('change'" in html


def test_mobile_only_notice_short_text_and_link_pills_and_safe_area():
    for path in PAGES:
        html = read(path)
        assert '<span class="notice-full">누락 혹은 수정이 필요한 공고가 있으면 채팅방에서 @주녀를 부르시거나, </span>' in html
        assert '<span class="notice-short">누락/수정 제보는 @주녀 또는 </span>' in html
        mobile_block = html.split('@media (max-width: 680px)', 1)[1]
        assert '.notice-full { display: none; }' in mobile_block
        assert '.notice-short { display: inline; }' in mobile_block
        assert 'body[data-view-mode="list"] .official, body[data-view-mode="list"] .reference' in mobile_block
        assert 'border-radius: 999px' in mobile_block
        assert 'bottom: calc(12px + env(safe-area-inset-bottom));' in mobile_block


def test_mobile_dday_contrast_is_strengthened_without_text_changes():
    for path in PAGES:
        html = read(path)
        mobile_block = html.split('@media (max-width: 680px)', 1)[1]
        assert 'body[data-view-mode="list"] .due-day' in mobile_block
        assert 'body[data-view-mode="list"] .due-week' in mobile_block
        assert 'body[data-view-mode="list"] .due-fortnight' in mobile_block
        assert "return `D-${d}`" in html
        assert "return '7일전'" not in html
        assert "return '14일전'" not in html
