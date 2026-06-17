begin;

drop policy if exists "customer_equipments_insert_as_creators" on public.customer_equipments;

create policy "customer_equipments_insert_as_creators"
on public.customer_equipments
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.role in ('admin', 'lead', 'executive')
        or p.team in ('국내영업', '해외영업')
        or p.name in (
          '신상민',
          '신영호',
          '정대용',
          '서중석',
          '한차현',
          '이승준',
          '장동철',
          '권현진',
          '김혜정',
          '이양로'
        )
      )
  )
);

commit;
