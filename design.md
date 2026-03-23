# Design System & Style Guide

AI가 일관된 톤앤매너로 화면을 생성할 수 있도록 정의된 가이드라인입니다.

## 1. Creative North Star: The Technical Oracle

고도의 기술적 분석을 제공하는 도구로, 신뢰감 있고 정교하며 미래지향적인 분위기를 지향합니다. 불필요한 장식과 입체감을 배제하고, 얇은 라인과 단조로운 면을 활용한 미니멀리즘을 핵심으로 합니다.

---

## 2. Color Palette

### 🌑 Dark Mode (Primary)

- **Background:** `#000000` (Pure Black)
- **Surface/Box:** `#080808` ~ `#121212` (아주 짙은 그레이, 얇은 테두리와 함께 사용)
- **Primary Text:** `#FFFFFF` (Pure White, Weight: 300)
- **Secondary Text:** `#A0A0A0` (Slate Gray, 보조 설명용)
- **Point Color (Mint):** `#3DB388` (핵심 강조, 로딩 바, 활성화 버튼 등)
- **Alert Color (Red):** `#FF5A5F` (에러 상태, 경고 아이콘 등)
- **Border:** `rgba(255, 255, 255, 0.1)` (매우 얇은 1px 라인)

### ☀️ Light Mode

- **Background:** `#FFFFFF` (Pure White)
- **Surface/Box:** `#F8F9FA` (매우 밝은 그레이)
- **Primary Text:** `#111111` (Near Black, Weight: 300)
- **Secondary Text:** `#666666` (Gray, 보조 설명용)
- **Point Color (Mint):** `#20C997` (라이트 모드 가독성을 위해 다소 채도 조정 가능)
- **Alert Color (Red):** `#E53E3E` (에러 상태)
- **Border:** `rgba(0, 0, 0, 0.08)` (매우 얇은 1px 라인)

---

## 3. Typography (Pretendard)

- **Font Family:** `Pretendard`, sans-serif
- **Base Font Weight:** `300` (Light) - 전체적인 트렌디함과 세련미를 위해 기본으로 사용.
- **Headline Weight:** `400` ~ `500` - 시각적 위계가 필요한 경우에만 제한적으로 사용.
- **Character Spacing:** `0.02em` (약간의 자간 축소로 응집력 부여)
- **Line Height:** `1.5` ~ `1.6` (충분한 행간 확보)

---

## 4. Visual Elements & Spacing

- **Line Style:** 모든 구분선과 테두리는 `1px` 두께를 유지. 입체감(Shadow, Gradient) 절대 금지.
- **Flat Design:** 단조로운 면(Solid Fill)만 사용하며 둥근 모서리는 `4px` ~ `8px` 정도로 최소화.
- **Section Spacing:** 섹션 간 간격은 `80px` ~ `120px` 이상으로 넓게 설정하여 시원한 개방감 부여.
- **Component Spacing:** 요소 간 간격은 너무 좁지도 넓지도 않은 적정 수준(`16px` ~ `32px`) 유지.
- **Title Style:** 대문자(Uppercase)와 넓은 자간을 활용하여 기술적인 느낌 강조.

---

## 5. UI Components Rules

- **Buttons:** 배경색이 채워진 스타일(Point Color) 또는 얇은 테두리(Outline) 스타일만 사용. 높이는 슬림하게 유지.
- **Inputs:** 높이를 낮게 설정하여 세련된 느낌을 주며, 포커스 시 Point Color 테두리 적용.
- **Dashboard:** 카드 형태의 박스 그리드 레이아웃을 선호하며, 등급(A++ ~ F)은 텍스트 크기를 키워 강조.
- **Icons:** 2pt 내외의 얇은 라인 아이콘(Outlined)만 사용. 채워진 아이콘 지양.