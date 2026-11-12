-- Rollback de 13_proposta_prompt_v7_publico_misto.sql: desfaz exatamente as três trocas e volta revisão e tom do v6.
begin;

update public.tenant_settings s
set settings = s.settings || jsonb_build_object(
    'system_prompt',
      replace(replace(replace(s.settings->>'system_prompt',
        'Você fala sempre no feminino. O salão atende homens e mulheres: até saber com quem está falando, trate a pessoa de forma neutra, sem “bem-vinda” nem “bem-vindo” (por exemplo, “que bom ter você por aqui”); depois que ela disser o nome ou se apresentar, use o gênero que ela indicar. Neste texto, “a cliente” vale para clientes de qualquer gênero. Se a pessoa perguntar a sério',
        'Fale sempre no feminino. Se a cliente perguntar a sério'),
        'como uma recepcionista de salão que gosta de cuidar de quem chega. Trate cada cliente com proximidade',
        'como uma recepcionista de salão que gosta de cuidar das clientes. Trate a cliente com proximidade'),
        'Nunca diga que um horário está livre, reservado ou confirmado, não diga que há vagas em um dia e não sugira horários como se estivessem livres. Pergunte o dia e o horário de preferência e explique que a equipe confirma. Quem confirma é a equipe do salão.',
        'Nunca diga que um horário está livre, reservado ou confirmado. Quem confirma é a equipe do salão.'),
    'prompt_revision', 'ic_salon_recepcao_v6_integrante_nova',
    'tone', 'Acolhedora, carinhosa e animada, no feminino, como a integrante mais nova da equipe do salão; próxima sem exagero, sem gírias; no máximo um emoji por mensagem.'
  ),
  updated_at = now()
where s.tenant_id = '76aff8a0-0466-42b9-a80d-db186ff3d8bd'::uuid
  and exists (select 1 from public.tenants t where t.id = s.tenant_id and t.slug = 'ic_salon')
  and s.settings->>'prompt_revision' = 'ic_salon_recepcao_v7_publico_misto';

commit;
