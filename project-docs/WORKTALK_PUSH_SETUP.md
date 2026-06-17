# WorkTalk PWA 백그라운드 푸시 설정

## 1. Supabase SQL

Supabase SQL Editor에서 `supabase-worktalk-push.sql`을 실행한다.

## 2. 로컬 환경변수

작업 복사본의 `.env.local`에는 생성된 VAPID 공개키와 개인키가 이미 추가되어
있다. 아래 관리자 키 한 줄만 추가해야 실제 서버 발송이 가능하다.

```env
SUPABASE_SERVICE_ROLE_KEY=Supabase Dashboard에서 확인한 service_role 또는 secret key
```

이 키는 브라우저에 노출하면 안 되며 `NEXT_PUBLIC_` 접두사를 붙이지 않는다.

## 3. Vercel 환경변수

배포 프로젝트에는 다음 네 값을 등록한다.

```env
NEXT_PUBLIC_VAPID_PUBLIC_KEY=BAOssMadY0Ls_ivtyrMzvd_NQlw6SQlJOHoBV5AI77UUPRwCGyuLaZ243qvzZz7Mxqqs5V2Zk07zNU_Ul2nQzW8
VAPID_PRIVATE_KEY=2oZ5dAB2SNWTs71BJqO48JzLpf8GE76FxW_S_3Wawcg
VAPID_SUBJECT=mailto:admin@zeta.co.kr
SUPABASE_SERVICE_ROLE_KEY=Supabase Dashboard에서 확인한 service_role 또는 secret key
```

VAPID 개인키와 Supabase 관리자 키는 회사 외부에 공유하지 않는다.

## 4. 테스트

1. 서버를 재시작한다.
2. 수신 계정에서 WorkTalk의 알림 화면을 연다.
3. `푸시 켜기`를 누르고 브라우저 알림을 허용한다.
4. WorkTalk 탭을 닫거나 휴대폰에서 앱을 백그라운드로 보낸다.
5. 다른 계정에서 메시지를 전송한다.
6. 시스템 알림을 누르면 해당 대화방과 메시지로 이동하는지 확인한다.

## 5. iPhone

iOS 16.4 이상에서 Safari로 접속한 뒤 공유 메뉴의 `홈 화면에 추가`를 먼저
실행해야 Web Push를 사용할 수 있다. 홈 화면에 설치된 WorkTalk을 열고
`푸시 켜기`를 누른다.
