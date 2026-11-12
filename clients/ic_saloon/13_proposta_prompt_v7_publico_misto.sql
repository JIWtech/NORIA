-- PROPOSTA (não aplicada): prompt v7 do I&C Salon. Aplicar somente com autorização explícita do responsável.
-- Rollback: 13_proposta_prompt_v7_publico_misto_rollback.sql. Só aplica sobre o v6 (ic_salon_recepcao_v6_integrante_nova).
--
-- Motivo (conversas reais de 12/11/2026, depois da publicação):
-- 1. O salão atende homens e mulheres, mas o v6 chama todo mundo de "a cliente" e a IA abriu com "Seja muito bem-vinda"
--    antes de saber com quem falava (inclusive num número usado por um cliente homem). A atendente continua no feminino;
--    o tratamento da pessoa atendida passa a ser neutro até ela se identificar.
-- 2. A IA ofereceu horários como se estivessem livres ("temos horários à tarde, 13:30 ou 14:30"; "temos horários
--    disponíveis para hoje"), embora o prompt diga que ela não vê a agenda. A regra fica explícita para vagas e sugestões.
-- As trocas são feitas sobre trechos exatos do v6; se algum trecho não existir, nada é alterado.
begin;

update public.tenant_settings s
set settings = s.settings || jsonb_build_object(
    'system_prompt',
      replace(replace(replace(s.settings->>'system_prompt',
        'Fale sempre no feminino. Se a cliente perguntar a sério',
        'Você fala sempre no feminino. O salão atende homens e mulheres: até saber com quem está falando, trate a pessoa de forma neutra, sem “bem-vinda” nem “bem-vindo” (por exemplo, “que bom ter você por aqui”); depois que ela disser o nome ou se apresentar, use o gênero que ela indicar. Neste texto, “a cliente” vale para clientes de qualquer gênero. Se a pessoa perguntar a sério'),
        'como uma recepcionista de salão que gosta de cuidar das clientes. Trate a cliente com proximidade',
        'como uma recepcionista de salão que gosta de cuidar de quem chega. Trate cada cliente com proximidade'),
        'Nunca diga que um horário está livre, reservado ou confirmado. Quem confirma é a equipe do salão.',
        'Nunca diga que um horário está livre, reservado ou confirmado, não diga que há vagas em um dia e não sugira horários como se estivessem livres. Pergunte o dia e o horário de preferência e explique que a equipe confirma. Quem confirma é a equipe do salão.'),
    'prompt_revision', 'ic_salon_recepcao_v7_publico_misto',
    'tone', 'Acolhedora, carinhosa e animada; a atendente fala no feminino, como a integrante mais nova da equipe, e trata clientes de qualquer gênero (neutro até a pessoa se identificar); próxima sem exagero, sem gírias; no máximo um emoji por mensagem.'
  ),
  updated_at = now()
where s.tenant_id = '76aff8a0-0466-42b9-a80d-db186ff3d8bd'::uuid
  and exists (select 1 from public.tenants t where t.id = s.tenant_id and t.slug = 'ic_salon')
  and s.settings->>'prompt_revision' = 'ic_salon_recepcao_v6_integrante_nova'
  and strpos(s.settings->>'system_prompt', 'Fale sempre no feminino. Se a cliente perguntar a sério') > 0
  and strpos(s.settings->>'system_prompt', 'como uma recepcionista de salão que gosta de cuidar das clientes. Trate a cliente com proximidade') > 0
  and strpos(s.settings->>'system_prompt', 'Nunca diga que um horário está livre, reservado ou confirmado. Quem confirma é a equipe do salão.') > 0;

commit;
