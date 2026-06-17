# PROJECT STRUCTURE

## 현재 구조

/app
- login
- main
- schedule
- view
- password
- InputPageClient.tsx

/app/_components
- SessionGuard.tsx

/components
(신규 기능부터 점진 분리)

/hooks
(신규 기능부터 적용)

/types
(신규 기능부터 적용)

/lib
- supabase

/project-docs
- PROJECT_RULES.md
- roadmap.md
- schedule.md
- structure.md
- TODO.md
- worklog.md
- REFACTOR_RULES.md

---

## 현재 상태

- 기존 기능은 page.tsx 중심 구조
- 현재 기능은 안정성 우선 유지
- 신규 기능부터 모듈화 진행 예정

---

## 현재 레거시 영역

- main/page.tsx
- schedule/page.tsx
- view/page.tsx

현재는 안정성 우선 유지.

복잡한 state/useEffect 구조는 당분간 유지.

---

## 신규 구조 방향

/components
- layout
- common
- approval
- customer
- admin

/hooks
- useApproval
- useCustomer
- useAuth

/types
- approval
- customer
- profile

---

## 개발 방향

- 신규 기능은 반드시 기능 단위 분리
- page.tsx는 조립 역할만 수행
- 로직은 hooks 기반 분리
- 공통 UI 재사용 우선
- 기존 기능은 필요 시 점진 분리