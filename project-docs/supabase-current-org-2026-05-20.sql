begin;

update public.profiles
set
  team = case name
    when '신상민' then '회장'
    when '신영호' then '대표이사'
    when '정대용' then '관리본부'
    when '김혜정' then '재무/인사'
    when '최인혜' then '재무/인사'
    when '신훈식' then '구매/총무'
    when '최하영' then '구매/총무'
    when '김선일' then '국내영업부'
    when '이양로' then '해외영업부'
    when '반준영' then '해외영업부'
    when '권현진' then '신사업부'
    when '서중석' then 'R&D/품질보증본부'
    when '윤지환' then 'R&D/QA부'
    when '장동철' then '생산본부'
    when '한차현' then '기술 1팀'
    when '한재영' then '기술 1팀'
    when '권영일' then '기술 1팀'
    when '김학' then '기술 1팀'
    when '박상현' then '기술 1팀'
    when '이승준' then '기술 2팀'
    when '김종혁' then '기술 2팀'
    when '양희원' then '기술 3팀'
    when '김성종' then '기술 3팀'
    else team
  end,
  role = case
    when role = 'admin' then role
    when name in ('신상민', '신영호') then 'executive'
    when name in (
      '정대용',
      '김혜정',
      '이양로',
      '권현진',
      '서중석',
      '장동철',
      '한차현',
      '이승준'
    ) then 'lead'
    else 'user'
  end
where name in (
  '신상민',
  '신영호',
  '정대용',
  '김혜정',
  '최인혜',
  '신훈식',
  '최하영',
  '김선일',
  '이양로',
  '반준영',
  '권현진',
  '서중석',
  '윤지환',
  '장동철',
  '한차현',
  '한재영',
  '권영일',
  '김학',
  '박상현',
  '이승준',
  '김종혁',
  '양희원',
  '김성종'
);

commit;
