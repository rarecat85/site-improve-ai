import * as cheerio from 'cheerio'
import type { Element } from 'domhandler'
import { MIN_VIABLE_HTML_LENGTH } from '@/lib/constants/analysis-pipeline'

export interface WireframeCell {
  id: string
  label: string
}

export interface WireframeRow {
  cells: WireframeCell[]
}

export interface ArchitectureSectionSnippet {
  id: string
  label: string
  textSnippet: string
}

export interface ExtractedPageArchitecture {
  rows: WireframeRow[]
  sections: ArchitectureSectionSnippet[]
}

/** 리포트·UI용 (AI 요약 또는 폴백) */
export interface PageArchitectureSectionSummary {
  id: string
  title: string
  metricLabel: string
  metricScore?: number
  description: string
}

export interface PageArchitectureReport {
  rows: WireframeRow[]
  sections: PageArchitectureSectionSummary[]
}

const MAX_TOP_BLOCKS = 10
/** main/body 직계가 단일 래퍼일 때, 직계 자식이 하나뿐이면 아래로 계속 내려가며 펼침 (AEM·그리드 껍데기 대응) */
const MAX_SINGLE_WRAPPER_UNWRAP_DEPTH = 14
/** 단일 상위 블록을 펼칠 때 직계 자식 칸 최대 개수 */
const MAX_CHILDREN_EXPAND = 5
/** 와이어프레임·셀 총 상한(UI 밀도) */
const MAX_TOTAL_CELLS = 22
/** 와이어프레임에 포함할 최소 텍스트(그 미만이면 미디어·제목·구조로 판단) */
const MIN_WIRE_TEXT_LEN = 12
const SNIPPET_LEN = 700

/** 상단 공지·토스트·티커·알림 바 등 (내부 컨텐츠용 탭 띠는 제외) */
const LEAD_IN_NOISE_CLASS_ID_RE =
  /\b(announcement|announce|site-notice|top-notice|page-notice|system-notice|marquee|ticker|toast|snackbar|alert-bar|alertbanner|popup-bar|dimmed-notice|notification-bar|noti-bar|global-alert)\b/i

const SHORT_NOTICE_TEXT_RE =
  /공지|알림|안내|필독|notice|important(\s+message)?|이벤트\s*안내|점검\s*안내|일시적|긴급/i

/** 알려진 쿠키/CMP 루트(본문과 겹칠 가능성이 낮은 셀렉터) */
const COOKIE_CMP_ROOT_SELECTORS = [
  '#onetrust-consent-sdk',
  '#onetrust-banner-sdk',
  '.onetrust-pc-dark-filter',
  '#CybotCookiebotDialog',
  '#CybotCookiebotDialogBodyUnderlay',
  '#cookiescript_injected',
  '#cookie-law-info-bar',
  '.cli-modal-backdrop',
  '#cookiescript_injected_wrapper',
  '[data-testid="cookie-banner"]',
  '[data-cy="cookie-banner"]',
].join(', ')

function normalizeAttr(s: string | undefined): string {
  return (s || '').toLowerCase()
}

/** 쿠키·동의 배너/CMP 루트 (id/class 등) */
const COOKIE_UI_RE =
  /onetrust|cookiebot|osano|cybotcookiebot|cookiescript|cookie-law-info|eu-cookie|consent-banner|consent_banner|cookie-banner|cookie_banner|cookie-consent|cookie_consent|cookiebar|cookie_bar|cc-window|cc-banner|gdpr-consent|gdpr_banner|gdpr-banner|privacy-banner|cookie-notice|cookie_notice/i

/**
 * 사이드(또는 드로어) **네비게이션**으로 보일 때만. `sidebar` 단독 등 본문 보조 컬럼은 제외하지 않음.
 */
const SIDE_NAV_SHELL_RE =
  /side-nav|sidenav|side_nav|nav-drawer|menu-drawer|drawer-nav|drawer-menu|offcanvas|off-canvas|\blnb\b|local-nav|subnav-panel|sub-navigation/i

/**
 * 와이어프레임·섹션 후보에서 뺄 것: (1) 쿠키/동의 UI (2) 사이드·드로어 네비 껍데기
 * — GNB·헤더 등은 AI 단계에서 본문 여부를 판별(프롬프트)하는 편이 정확도 대비 유지보수에 유리함.
 */
function isCookieConsentOrSideNavShell($: cheerio.CheerioAPI, el: Element): boolean {
  const tag = el.tagName?.toLowerCase() || ''
  const $el = $(el)
  const id = normalizeAttr($el.attr('id'))
  const cls = normalizeAttr($el.attr('class'))
  const role = normalizeAttr($el.attr('role'))
  const aria = normalizeAttr($el.attr('aria-label'))
  const combined = `${id} ${cls} ${role} ${aria}`

  if (COOKIE_UI_RE.test(combined)) return true

  if (
    aria &&
    /(쿠키|cookie).*(동의|설정|수락|거부|차단)|(동의|수락).*쿠키|accept all cookies|accept cookies|cookie settings|쿠키\s*설정|추적\s*거부|privacy choices|manage preferences/i.test(
      aria
    )
  ) {
    return true
  }

  if (tag === 'nav' && SIDE_NAV_SHELL_RE.test(combined)) return true

  if ((tag === 'div' || tag === 'section') && SIDE_NAV_SHELL_RE.test(combined)) {
    return true
  }

  return false
}

function removeKnownCookieCMPRoots($: cheerio.CheerioAPI) {
  $(COOKIE_CMP_ROOT_SELECTORS).remove()
}

function hasWireframeMedia($: cheerio.CheerioAPI, el: Element): boolean {
  return $(el).find('img, picture, video, figure, canvas, [role="img"]').length > 0
}

function hasMeaningfulHeading($: cheerio.CheerioAPI, el: Element): boolean {
  return $(el).find('h1,h2,h3,h4').length > 0
}

/**
 * main/body 직계에서 **앞쪽에만** 연속 등장하는 저가치 블록(공지·토스트·티커 류, 숨김/빈 래퍼).
 * 내부 컨텐츠용 탭·필터 띠(버튼만 많은 줄)는 제거하지 않음.
 */
function isLikelyLowValueLeadInBlock($: cheerio.CheerioAPI, el: Element): boolean {
  const $el = $(el)
  if (normalizeAttr($el.attr('aria-hidden')) === 'true') return true

  const id = normalizeAttr($el.attr('id'))
  const cls = normalizeAttr($el.attr('class'))
  const role = normalizeAttr($el.attr('role'))
  const combined = `${id} ${cls} ${role}`

  const text = $el.text().replace(/\s+/g, ' ').trim()
  const hasHeading = hasMeaningfulHeading($, el)
  const hasMedia = hasWireframeMedia($, el)

  if (hasMedia) return false
  if (hasHeading && text.length >= 28) return false

  if (LEAD_IN_NOISE_CLASS_ID_RE.test(combined) && text.length < 320) return true

  if (
    text.length < 200 &&
    SHORT_NOTICE_TEXT_RE.test(text) &&
    !hasHeading &&
    $el.find('h1').length === 0
  ) {
    return true
  }

  const interactive = $el.find('button, a[href], input, select, textarea').length
  if (text.length < 8 && !hasMedia && !hasHeading && interactive === 0) return true

  if (text.length < MIN_WIRE_TEXT_LEN && !hasHeading && !hasMedia && interactive <= 1) return true

  return false
}

function dropLeadingLowValueNoise(
  $: cheerio.CheerioAPI,
  candidates: Element[]
): Element[] {
  let i = 0
  while (i < candidates.length && isLikelyLowValueLeadInBlock($, candidates[i]!)) {
    i += 1
  }
  const rest = candidates.slice(i)
  return rest.length > 0 ? rest : candidates
}

/**
 * 와이어프레임 후보(쿠키·사이드넷 제외): 짧은 카피·이미지/비디오·제목·2+ 직계 자식 래퍼 포함.
 */
function isWireframeBlockCandidate($: cheerio.CheerioAPI, el: Element): boolean {
  if (isCookieConsentOrSideNavShell($, el)) return false
  const $el = $(el)
  const text = $el.text().replace(/\s+/g, ' ').trim()
  if (text.length >= MIN_WIRE_TEXT_LEN) return true
  if (hasWireframeMedia($, el)) return true
  if ($el.find('h1,h2,h3,h4').length > 0) return true
  const kids = $el
    .children()
    .toArray()
    .filter((ch) => {
      const t = ch.tagName?.toLowerCase()
      return Boolean(t && t !== 'script' && t !== 'style')
    })
  return kids.length >= 2
}

/** 직계 자식 중 와이어프레임 칸으로 쓸 만한 요소 */
function wireQualifyingBlockChildren($: cheerio.CheerioAPI, parent: Element): Element[] {
  return $(parent)
    .children()
    .toArray()
    .filter((el) => {
      const tag = el.tagName?.toLowerCase()
      if (!tag || tag === 'script' || tag === 'style') return false
      if (isCookieConsentOrSideNavShell($, el)) return false
      return isWireframeBlockCandidate($, el)
    })
}

function defaultWireframeLabel($: cheerio.CheerioAPI, el: Element, rowIndex: number, i?: number): string {
  const heading = $(el).find('h1,h2,h3,h4').first().text().trim()
  const fromHeading = slugLabel(heading, 24)
  if (fromHeading) return fromHeading
  if (hasWireframeMedia($, el)) return 'MEDIA_BLOCK'
  if (i !== undefined) return `F_${String(i + 1).padStart(2, '0')}`
  if (rowIndex === 0) return 'HERO_ANCHOR'
  return `SEC_${String(rowIndex + 1).padStart(2, '0')}`
}

/** 첫 상위 블록을 자식으로 쪼개지 않고 한 칸으로 둘 때 라벨(제목 우선, 없으면 OVERVIEW) */
function overviewTopBlockLabel($: cheerio.CheerioAPI, el: Element): string {
  const heading = $(el).find('h1,h2,h3,h4').first().text().trim()
  const fromHeading = slugLabel(heading, 24)
  if (fromHeading) return fromHeading
  return 'OVERVIEW'
}

function slugLabel(text: string, maxLen: number): string {
  const t = text.replace(/\s+/g, ' ').trim().slice(0, maxLen)
  if (!t) return ''
  return t
    .toUpperCase()
    .replace(/\s+/g, '_')
    .replace(/[^\w가-힣_]/g, '')
    .slice(0, 26)
}

/** 단일 자식 체인(래퍼)만 있을 때 아래로 내려가며 펼침. 직계에 2개 이상이면 와이어프레임 후보로 정착 */
function unwrapSingleChildWrapperChain($: cheerio.CheerioAPI, initialCandidates: Element[]): Element[] {
  let candidates = initialCandidates
  let depth = 0
  while (candidates.length === 1 && depth < MAX_SINGLE_WRAPPER_UNWRAP_DEPTH) {
    const only = candidates[0]!
    const tag = only.tagName?.toLowerCase() || ''
    if (!isStructuralWrapperElement(tag)) break

    const directKids = $(only)
      .children()
      .toArray()
      .filter((el) => {
        const t = el.tagName?.toLowerCase()
        return Boolean(t && t !== 'script' && t !== 'style')
      })

    if (directKids.length === 0) break

    if (directKids.length === 1) {
      candidates = [directKids[0]!]
      depth += 1
      continue
    }

    const wf = directKids.filter((el) => isWireframeBlockCandidate($, el))
    if (wf.length >= 2) {
      return wf
    }
    if (wf.length === 1) {
      candidates = [wf[0]!]
      depth += 1
      continue
    }

    break
  }
  return candidates
}

function isStructuralWrapperElement(tag: string): boolean {
  return tag === 'div' || tag === 'section' || tag === 'article' || tag === 'aside'
}

/**
 * Puppeteer HTML에서 상위 블록 구조를 추출합니다.
 * 와이어프레임 칸과 sections 스니펫은 동일 후보(느슨한 기준)로 1:1 대응합니다.
 * 쿠키/CMP 루트 제거·사이드 드로어 네비 껍데기 제외만 유지합니다.
 * 공지·토스트·티커·숨김/빈 래퍼 등은 **상단에서 연속으로만** 건너뜁니다(내부 탭 띠는 유지, 전부 걸리면 원본 유지).
 * 직계 후보가 **하나뿐**이면 div/section 등 래퍼를 **직계 자식이 둘 이상 나올 때까지** (상한 깊이 내) 따라 내려가 펼칩니다.
 * 첫 번째 상위 후보는 **자식 펼침·그리드 분할 없이** 한 칸(OVERVIEW 등).
 * 두 번째 이후 후보만 직계 div 그리드(2~4) 또는 한 단계 직계 자식 펼침을 적용합니다.
 */
export function extractPageArchitecture(html: string): ExtractedPageArchitecture {
  const rows: WireframeRow[] = []
  const sections: ArchitectureSectionSnippet[] = []

  if (!html || html.length < MIN_VIABLE_HTML_LENGTH) {
    return { rows, sections }
  }

  const $ = cheerio.load(html)
  $('script, style, noscript, svg, iframe, template').remove()
  removeKnownCookieCMPRoots($)

  const root = $('main').first().length ? $('main').first() : $('body').first()
  if (!root.length) {
    return { rows, sections }
  }

  const rawChildren = root.children().toArray().filter((el) => {
    const tag = el.tagName?.toLowerCase()
    if (!tag || tag === 'script' || tag === 'style') return false
    return true
  })

  let candidates = rawChildren.filter((el) => isWireframeBlockCandidate($, el))

  if (candidates.length === 1) {
    candidates = unwrapSingleChildWrapperChain($, candidates)
  }

  candidates = dropLeadingLowValueNoise($, candidates)

  candidates = candidates.slice(0, MAX_TOP_BLOCKS)

  let idx = 0
  const nextId = () => {
    idx += 1
    return `B_${String(idx).padStart(2, '0')}`
  }

  let rowIndex = 0
  let totalCells = 0

  const pushMultiCellRow = (childEls: Element[]) => {
    const cells: WireframeCell[] = []
    childEls.forEach((c, i) => {
      const $c = $(c)
      const id = nextId()
      const label = defaultWireframeLabel($, c, rowIndex, i).slice(0, 26)
      const textSnippet = $c.text().replace(/\s+/g, ' ').trim().slice(0, SNIPPET_LEN)
      cells.push({ id, label })
      sections.push({ id, label, textSnippet })
    })
    rows.push({ cells })
    totalCells += childEls.length
    rowIndex += 1
  }

  for (let ci = 0; ci < candidates.length; ci++) {
    if (totalCells >= MAX_TOTAL_CELLS) break

    const el = candidates[ci]!
    const $el = $(el)
    const budget = MAX_TOTAL_CELLS - totalCells
    const isFirstTopBlock = ci === 0

    if (!isFirstTopBlock) {
      // 직계 div가 2~4개이면 한 행에 여러 칸(피처 그리드)
      const childDivs = $el
        .children('div')
        .toArray()
        .filter((c) => isWireframeBlockCandidate($, c))

      const isGridRow = childDivs.length >= 2 && childDivs.length <= 4

      if (isGridRow) {
        const take = Math.min(childDivs.length, 4, budget)
        if (take >= 2) {
          pushMultiCellRow(childDivs.slice(0, take))
          continue
        }
      }

      // div 외 section/article 등 직계 자식 2개 이상이면 한 단계 펼쳐 한 행에 그림
      const structuralKids = wireQualifyingBlockChildren($, el)
      const maxTake = Math.min(structuralKids.length, MAX_CHILDREN_EXPAND, budget)
      if (structuralKids.length >= 2 && maxTake >= 2) {
        pushMultiCellRow(structuralKids.slice(0, maxTake))
        continue
      }
    }

    if (budget < 1) break

    const id = nextId()
    const label = isFirstTopBlock
      ? overviewTopBlockLabel($, el)
      : defaultWireframeLabel($, el, rowIndex)

    const textSnippet = $el.text().replace(/\s+/g, ' ').trim().slice(0, SNIPPET_LEN)
    rows.push({ cells: [{ id, label }] })
    sections.push({ id, label, textSnippet })
    totalCells += 1
    rowIndex += 1
  }

  return { rows, sections }
}
