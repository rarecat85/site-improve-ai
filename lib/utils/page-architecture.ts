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
const MIN_TEXT_LEN = 35
const SNIPPET_LEN = 700

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
 * — header/footer/aside/일반 dialog 등은 본문에서도 쓰이므로 여기서 제거하지 않음.
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

function slugLabel(text: string, maxLen: number): string {
  const t = text.replace(/\s+/g, ' ').trim().slice(0, maxLen)
  if (!t) return ''
  return t
    .toUpperCase()
    .replace(/\s+/g, '_')
    .replace(/[^\w가-힣_]/g, '')
    .slice(0, 26)
}

/**
 * Puppeteer로 가져온 HTML에서 상위 블록 구조만 추출해 와이어프레임 행·섹션 스니펫을 만듭니다.
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

  let candidates = rawChildren.filter((el) => {
    if (isCookieConsentOrSideNavShell($, el)) return false
    const text = $(el).text().replace(/\s+/g, ' ').trim()
    return text.length >= MIN_TEXT_LEN
  })

  // body/main 직계가 래퍼 div 하나뿐이면 한 단계 펼쳐 본문 섹션을 잡음
  if (candidates.length === 1) {
    const only = candidates[0]!
    const tag = only.tagName?.toLowerCase() || ''
    if (tag === 'div') {
      const inner = $(only)
        .children()
        .toArray()
        .filter((el) => {
          const t = el.tagName?.toLowerCase()
          if (!t || t === 'script' || t === 'style') return false
          if (isCookieConsentOrSideNavShell($, el)) return false
          const text = $(el).text().replace(/\s+/g, ' ').trim()
          return text.length >= MIN_TEXT_LEN
        })
      if (inner.length >= 2) {
        candidates = inner
      }
    }
  }

  candidates = candidates.slice(0, MAX_TOP_BLOCKS)

  let idx = 0
  const nextId = () => {
    idx += 1
    return `B_${String(idx).padStart(2, '0')}`
  }

  let rowIndex = 0
  for (const el of candidates) {
    const $el = $(el)
    // 직계 div가 2~4개이면 한 행에 여러 칸(피처 그리드)으로 그립니다. 자식마다 쿠키/사이드넷 필터는 적용하지 않습니다(본문 카드와 구분이 어려움).
    const childDivs = $el
      .children('div')
      .filter((_, c) => $(c).text().replace(/\s+/g, ' ').trim().length >= MIN_TEXT_LEN)
      .toArray()

    const isGridRow = childDivs.length >= 2 && childDivs.length <= 4

    if (isGridRow) {
      const cells: WireframeCell[] = []
      childDivs.slice(0, 4).forEach((c, i) => {
        const $c = $(c)
        const id = nextId()
        const heading = $c.find('h1,h2,h3,h4').first().text().trim()
        const label =
          slugLabel(heading, 22) || `F_${String(i + 1).padStart(2, '0')}`
        const textSnippet = $c.text().replace(/\s+/g, ' ').trim().slice(0, SNIPPET_LEN)
        cells.push({ id, label })
        sections.push({ id, label, textSnippet })
      })
      rows.push({ cells })
      rowIndex += 1
      continue
    }

    const id = nextId()
    const heading = $el.find('h1,h2,h3').first().text().trim()
    const tag = el.tagName?.toLowerCase() || ''

    let label = slugLabel(heading, 24)
    if (!label) {
      if (rowIndex === 0) label = 'HERO_ANCHOR'
      else label = `SEC_${String(rowIndex + 1).padStart(2, '0')}`
    }

    const textSnippet = $el.text().replace(/\s+/g, ' ').trim().slice(0, SNIPPET_LEN)
    rows.push({ cells: [{ id, label }] })
    sections.push({ id, label, textSnippet })
    rowIndex += 1
  }

  return { rows, sections }
}
