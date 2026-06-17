# ZETA SQL 운영 정리표

작성일: 2026-05-27

## 목적

Supabase SQL Editor의 `PRIVATE` 목록은 저장된 쿼리 목록이며, 운영 DB의
마이그레이션 이력이 아니다. 이 문서는 현재 저장소의 SQL 파일을 기준으로
운영 확인 대상, 후속 스크립트에 의해 대체된 파일, 재실행 주의 파일을
구분하기 위한 작업 기준이다.

현재 필드테스트 중인 운영 DB에는 아래 파일을 일괄 실행하지 않는다.
운영 상태 확인은 `supabase-db-readonly-audit.sql`만 사용한다. 이 진단
스크립트는 `SELECT` 문만 포함하며 데이터나 정책을 변경하지 않는다.

## 2026-05-27 확인 완료

사용자 계정 간 화면 테스트로 아래 동작은 정상 확인되었다.

| 영역 | 확인 결과 | 관련 최신 SQL |
| --- | --- | --- |
| 채팅 접속 상태 | 채팅을 실제 보고 있을 때만 초록 상태 표시, 백그라운드 전환 후 해제 확인 | `supabase-chat-presence.sql` |
| 채팅 읽음 처리 | 상대가 백그라운드 상태일 때 읽음 숫자가 유지되고 복귀 후 해제 확인 | `supabase-chat.sql`, 앱 코드 |
| 개인 일정 | 서로 다른 두 계정에서 본인 일정만 표시됨을 확인 | `supabase-schedule-private-calendar.sql` |
| 승인 휴가 일정 | 개인 일정으로 분리되어 표시됨을 확인 | `supabase-approval-vacation-schedule.sql`, `supabase-schedule-private-calendar.sql` |

화면 테스트는 정책이 기대대로 동작한다는 강한 신호지만, 적용 SQL의
이력을 대신하지는 않는다. 필요 시 읽기 전용 진단 SQL 결과를 함께 보관한다.

## 운영상 절대 일괄 실행 금지

아래 파일은 데이터 삭제, 계정 수정, 조직/기존 데이터 보정, 또는 정책
교체를 수행한다. SQL Editor 목록 정리 과정에서 다시 실행하지 않는다.

| 파일 | 위험 사유 |
| --- | --- |
| `supabase-clean-test-data-preserve-customers.sql` | 결재, 업무일지, 일정, A/S, 영업, 알림, 활동 기록 데이터를 삭제 |
| `supabase-retired-users-cleanup.sql` | 지정된 사용자 인증/프로필/세션 데이터를 삭제 |
| `supabase-admin-account.sql` | 관리자 인증 계정과 기존 사용자 권한을 수정 |
| `supabase-admin-account-repair.sql` | 관리자 인증 계정을 삭제 후 재생성 |
| `supabase-admin-account-cleanup.sql` | 관리자 인증 계정 관련 데이터를 삭제 |
| `supabase-admin-profile-only.sql` | 관리자 및 특정 사용자 프로필 권한을 수정 |
| `supabase-current-org-2026-05-20.sql` | 조직도 기준으로 다수의 팀/역할을 수정 |
| `zeta-profile-sync.sql` / `supabase-profile-email-backfill.sql` | 프로필 정보를 인증 정보 기준으로 갱신 |
| `supabase-approval-vacation-schedule.sql` | 승인된 휴가를 일정 테이블로 backfill할 수 있음 |
| `supabase-schedule-private-calendar.sql` | 일정 접근 정책을 현재 개인 캘린더 기준으로 교체 |

## 최신 정책 기준

같은 테이블의 정책을 여러 파일이 순차적으로 변경한다. 운영에서 확인해야
하는 최종 의도는 아래와 같다.

| 기능 | 최종 기준 파일 | 대체되거나 주의할 이전 기준 |
| --- | --- | --- |
| 업무일지/공통 모듈 기본 RLS | `supabase-ownership-rls.sql` 및 후속 기능별 권한 파일 | `supabase-rls-hardening.sql`, `supabase-shared-modules.sql`의 초기 광범위 정책 |
| 일정관리 | `supabase-schedule-private-calendar.sql` | `supabase-rls-hardening.sql`의 `schedules_select_authenticated_all`, `supabase-ownership-rls.sql`의 관리자 수정/삭제 정책 |
| 결재 기본 테이블 | `supabase-approval-documents.sql`, `supabase-approval-followup.sql`, `supabase-approval-rls-fix.sql` | 초기 insert 정책은 RLS fix가 교체 |
| 결재 제출 RPC/외주 단계 | `supabase-approval-submit-rpc-compact.sql` | `supabase-approval-submit-rpc.sql`, `supabase-outsourcing-stage.sql`의 이전 RPC 정의 |
| 고객사 구분 | `supabase-customer-category-three.sql` | `supabase-customer-category.sql`의 5종 구분 |
| A/S 권한 | `supabase-as-permissions-and-alerts.sql`, `supabase-as-sales-team-permissions.sql` | 공통 모듈/ownership의 초기 A/S 정책 |
| 채팅 | `supabase-chat.sql` 후 `supabase-chat-groups.sql`, `supabase-chat-room-controls.sql`, `supabase-chat-realtime.sql`, `supabase-chat-presence.sql` | 이전 파일을 삭제하지 말고 순서 이력으로 보관 |

## SQL 파일 분류

### 기반 및 권한

| 파일 | 역할 | 운영 재실행 판단 |
| --- | --- | --- |
| `supabase-rls-hardening.sql` | 프로필, 업무일지, 일정 초기 RLS | 최신 일정 정책을 되돌릴 수 있으므로 실행 금지 |
| `supabase-shared-modules.sql` | 공지, 고객사, A/S, 영업 기본 테이블/RLS | 후속 권한을 되돌릴 수 있으므로 운영 일괄 실행 금지 |
| `supabase-ownership-rls.sql` | 소유자/관리자 권한 보강 | 최신 일정 정책보다 이전 상태이므로 단독 재실행 금지 |
| `supabase-user-activity-logs.sql` | 접속현황 로그 테이블/RLS | 장애 복구 목적이 아니면 재실행 보류 |
| `supabase-schedule-private-calendar.sql` | 일정 개인 열람/수정 정책 | 현재 일정 정책 기준 파일, 필요 시 별도 검토 후 실행 |

### 결재 및 생산 현황

| 파일 | 역할 | 운영 재실행 판단 |
| --- | --- | --- |
| `supabase-approval-documents.sql` | 결재 기본 테이블 및 초기 정책 | 기반 파일, 운영 재실행 보류 |
| `supabase-approval-followup.sql` | 결재 참조자 및 장비 연결 컬럼 | 기반 보완 파일, 운영 재실행 보류 |
| `supabase-approval-rls-fix.sql` | 결재 등록 정책 보정 | 적용 확인 대상, 단독 재실행은 사전 점검 |
| `supabase-equipment-orders.sql` | 납품/생산 장비 주문 테이블 | 기반 파일, 운영 재실행 보류 |
| `supabase-approval-submit-rpc.sql` | 결재 제출 RPC 초기 확장 | `compact` 파일로 대체됨 |
| `supabase-outsourcing-stage.sql` | 외주 단계와 RPC 추가 | `compact` 파일로 통합/대체됨 |
| `supabase-approval-submit-rpc-compact.sql` | 현행 제출 RPC와 외주 단계 | 현행 기준, 실행 전 함수 영향 검토 |
| `supabase-approval-vacation-schedule.sql` | 승인 휴가의 일정 등록 및 backfill | 데이터 추가 가능, 운영 재실행 금지 |

### 고객사, 영업 및 A/S

| 파일 | 역할 | 운영 재실행 판단 |
| --- | --- | --- |
| `supabase-customer-category.sql` | 고객사 분류 초기 5종 | `three` 파일로 대체됨 |
| `supabase-customer-category-three.sql` | 고객사 분류 현행 3종 | 데이터 분류 갱신 포함, 재실행 보류 |
| `supabase-sales-currency.sql` | 영업 통화 컬럼 추가/기본값 보정 | 데이터 보정 포함, 재실행 보류 |
| `supabase-as-permissions-and-alerts.sql` | A/S 및 영업 권한/알림 보강 | 현행 권한 기준, 변경 전 검토 |
| `supabase-as-sales-team-permissions.sql` | A/S 생성 가능 사용자 범위 보완 | 현행 보완 기준, 변경 전 검토 |
| `supabase-customer-equipment-ledger.sql` | 고객 납품 장비 및 A/S 연결 | 기반 확장 파일, 재실행 보류 |
| `supabase-customer-equipment-as-auto-register.sql` | A/S 작성 시 장비 등록 권한 보강 | 정책 변경 파일, 재실행 보류 |
| `supabase-as-equipment-history.sql` | A/S와 생산 장비 연결/backfill | 데이터 갱신 포함, 재실행 보류 |

### 채팅

채팅 SQL은 아래 순서의 누적 확장이다. 운영에서 이미 정상 확인된 경우
목록 정리만을 이유로 다시 실행하지 않는다.

| 순서 | 파일 | 역할 |
| --- | --- | --- |
| 1 | `supabase-chat.sql` | 대화방, 참여자, 메시지 테이블 및 기본 RLS |
| 2 | `supabase-chat-groups.sql` | 단체방 메타데이터와 최신 메시지 갱신 |
| 3 | `supabase-chat-room-controls.sql` | 참여자 추가, 나가기, 방 삭제 정책 |
| 4 | `supabase-chat-realtime.sql` | 메시지/참여자 realtime publication 등록 |
| 5 | `supabase-chat-presence.sql` | 실제 표시 중인 채팅창의 presence 테이블/RLS |

### 조직, 계정 및 정리

| 파일 | 역할 | 운영 재실행 판단 |
| --- | --- | --- |
| `supabase-current-org-2026-05-20.sql` | 최신 조직도 역할/팀 반영 | 실행 금지, 조직 변경 시 신규 파일 작성 |
| `supabase-profile-email-backfill.sql` | 프로필 이메일 보정 | 실행 이력 확인용 보관 |
| `zeta-profile-sync.sql` | 프로필/조직 데이터 보정 | 실행 이력 확인용 보관 |
| `supabase-admin-account-diagnose.sql` | 기존 관리자 계정 진단 | 읽기 전용이나 현재 표준 진단 SQL 우선 사용 |
| `supabase-admin-account.sql` | 관리자 계정 생성/권한 보정 | 실행 금지 |
| `supabase-admin-account-repair.sql` | 관리자 계정 삭제/재생성 | 실행 금지 |
| `supabase-admin-account-cleanup.sql` | 관리자 계정 삭제 | 실행 금지 |
| `supabase-admin-profile-only.sql` | 관리자 프로필 설정 | 실행 금지 |
| `supabase-retired-users-cleanup.sql` | 퇴사자 계정 삭제 | 실행 금지 |
| `supabase-clean-test-data-preserve-customers.sql` | 필드 테스트 데이터 삭제 | 실행 금지 |

## 새 환경 구성 시 참고 순서

이 순서는 새 테스트 환경을 구성할 때의 참고용이며, 운영 DB에 일괄 적용하는
스크립트가 아니다. 실제 새 환경 구성 전에는 빈 DB에서 별도 검증한다.

1. `supabase-rls-hardening.sql`
2. `supabase-shared-modules.sql`
3. `supabase-ownership-rls.sql`
4. `supabase-approval-documents.sql`
5. `supabase-equipment-orders.sql`
6. `supabase-approval-followup.sql`
7. `supabase-approval-rls-fix.sql`
8. `supabase-approval-submit-rpc-compact.sql`
9. `supabase-approval-vacation-schedule.sql`
10. `supabase-customer-category-three.sql`
11. `supabase-sales-currency.sql`
12. `supabase-as-permissions-and-alerts.sql`
13. `supabase-as-sales-team-permissions.sql`
14. `supabase-customer-equipment-ledger.sql`
15. `supabase-customer-equipment-as-auto-register.sql`
16. `supabase-as-equipment-history.sql`
17. `supabase-user-activity-logs.sql`
18. `supabase-chat.sql`
19. `supabase-chat-groups.sql`
20. `supabase-chat-room-controls.sql`
21. `supabase-chat-realtime.sql`
22. `supabase-chat-presence.sql`
23. `supabase-schedule-private-calendar.sql`

조직/계정/기존 데이터 보정 SQL은 신규 환경의 초기 데이터 구성 방식을
결정한 뒤 별도로 다룬다.

## Supabase Editor 정리 방법

1. 먼저 `supabase-db-readonly-audit.sql`을 실행하고 결과를 확인한다.
2. `PRIVATE` 쿼리 중 현재 기준 SQL과 읽기 전용 진단 SQL은 남긴다.
3. 이름이 비슷한 이전 버전 쿼리는 이 문서에서 `대체됨` 또는 `실행 금지`인지 확인한 뒤 정리한다.
4. 운영 데이터 변경 SQL은 삭제 전에도 실행 버튼을 누르지 않는다.
5. 새로운 DB 변경은 새 SQL 파일로 저장소에 먼저 기록한 뒤 실행한다.
