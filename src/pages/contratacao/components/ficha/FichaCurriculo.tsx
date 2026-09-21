// Aba Currículo da ficha do candidato: contato, distância (detalhe), experiência, formação,
// outros cursos, habilidades/idiomas, outras informações, texto do currículo.
// Blocos movidos verbatim de CandidatoDrawer.tsx (pré-Fase 2) — ver mapa bloco→aba em spec.md §2 RF-04.
import { useState } from 'react';
import { type Candidate, type FichaCfg, type Company, type Distance, fmtPhone, onlyDigits, fmtKm, distCls, PRECISION_LABEL, fmtMonths } from '../../shared';

interface Props {
  c: Candidate; ficha: FichaCfg; idade: number | null; wa: string | null;
  loja: Company | null; lojaTemPin: boolean; temEndereco: boolean;
  dist: Distance | null; distBusy: boolean; distErro: string | null; onCalcular: () => void;
}

export default function FichaCurriculo({ c, ficha, idade, wa, loja, lojaTemPin, temEndereco, dist, distBusy, distErro, onCalcular }: Props) {
  const [verTexto, setVerTexto] = useState(false);
  const extras = (ficha.custom_fields ?? []).filter((f) => String(c.extra_fields?.[f.id] ?? '').trim());

  return (
    <>
      {/* Contato */}
      <Section title="Contato">
        <div className="space-y-1.5 text-sm">
          {c.phone && (
            <p className="flex items-center gap-2">
              <i className="ri-phone-line text-zinc-400" /> {fmtPhone(c.phone)}
              {wa && !c.whatsapp && <a href={wa} target="_blank" rel="noopener noreferrer" className="text-emerald-600 font-semibold text-xs ml-1"><i className="ri-whatsapp-line" /> WhatsApp</a>}
            </p>
          )}
          {c.whatsapp && (
            <p className="flex items-center gap-2">
              <i className="ri-whatsapp-line text-emerald-500" /> {fmtPhone(onlyDigits(c.whatsapp).replace(/^55(?=\d{10,11}$)/, ''))}
              <span className="text-[11px] text-zinc-400">{onlyDigits(c.whatsapp).slice(-8) === onlyDigits(c.phone).slice(-8) ? 'WhatsApp' : 'WhatsApp (diferente do currículo)'}</span>
              {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="text-emerald-600 font-semibold text-xs ml-1">abrir conversa</a>}
            </p>
          )}
          {c.email && <p className="flex items-center gap-2"><i className="ri-mail-line text-zinc-400" /> <a href={`mailto:${c.email}`} className="text-sky-700">{c.email}</a></p>}
          {(c.address || c.city || c.neighborhood) && (
            <p className="flex items-start gap-2"><i className="ri-map-pin-line text-zinc-400 mt-0.5" /> {[c.address, c.neighborhood, c.city].filter(Boolean).join(', ')}</p>
          )}
          {c.birth_date && (
            <p className="flex items-center gap-2"><i className="ri-cake-2-line text-zinc-400" /> {c.birth_date.split('-').reverse().join('/')}
              {idade != null && <span className="text-zinc-500">({idade} anos)</span>}</p>
          )}
          {c.marital_status && <p className="flex items-center gap-2"><i className="ri-user-heart-line text-zinc-400" /> {c.marital_status}</p>}
          {!c.phone && !c.email && !c.city && <p className="text-zinc-400 text-xs">Sem dados de contato no currículo.</p>}
        </div>
      </Section>

      <Section title={loja ? `Distância até ${loja.name}` : 'Distância até a loja'}>
        {!loja ? (
          <p className="text-xs text-zinc-400">Escolha a loja da ficha (no topo) para calcular a distância.</p>
        ) : !lojaTemPin ? (
          <p className="text-xs text-zinc-400">Marque a localização de {loja.name} em Configurações › Empresas (ícone de mapa) para calcular.</p>
        ) : !temEndereco ? (
          <p className="text-xs text-zinc-400">O currículo não tem endereço, bairro nem cidade.</p>
        ) : (
          <>
            {c.geo_precision === 'nao_encontrado' && !dist && (
              <p className="text-xs text-orange-700 mb-1.5">Não achei o endereço deste currículo no mapa.</p>
            )}
            {dist && (
              <div className="flex items-center gap-2 mb-1">
                <i className="ri-car-line text-zinc-400" />
                <span className={`text-sm font-bold px-2.5 py-0.5 rounded-full border ${distCls(dist.km)}`}>{fmtKm(dist.km)}</span>
                {dist.minutes != null && <span className="text-sm text-zinc-600">~{dist.minutes} min de carro</span>}
              </div>
            )}
            {dist?.precision && (
              <p className="text-[11px] text-zinc-400">
                {dist.method === 'rota' ? 'Pela rota' : 'Estimativa em linha reta'} · endereço {PRECISION_LABEL[dist.precision]}
                {c.geo_label ? ` (${c.geo_label})` : ''}
              </p>
            )}
            <button onClick={onCalcular} disabled={distBusy} className="mt-1 text-xs font-semibold text-sky-700 disabled:opacity-50 cursor-pointer">
              {distBusy ? 'Calculando…' : dist ? 'Recalcular' : 'Calcular distância'}
            </button>
            {distErro && <p className="text-xs text-red-600 mt-1">{distErro}</p>}
          </>
        )}
      </Section>

      {c.ai_processed && (
        <Section title={`Experiência${c.total_experience_months != null ? ` · ${fmtMonths(c.total_experience_months)}` : ''}`}>
          {c.experiences.length === 0 ? <p className="text-xs text-zinc-400">Nenhuma experiência informada.</p> : (
            <ol className="space-y-3 border-l-2 border-zinc-100 pl-4">
              {c.experiences.map((e, i) => (
                <li key={i} className="relative">
                  <span className="absolute -left-[21px] top-1.5 w-2.5 h-2.5 rounded-full bg-rose-400" />
                  <p className="text-sm font-bold text-zinc-800">{e.cargo || 'Cargo não informado'}</p>
                  <p className="text-xs text-zinc-500">
                    {[e.empresa, [e.inicio, e.atual ? 'atual' : e.fim].filter(Boolean).join(' – ')].filter(Boolean).join(' · ')}
                  </p>
                  {e.descricao && <p className="text-xs text-zinc-600 mt-1 leading-relaxed">{e.descricao}</p>}
                </li>
              ))}
            </ol>
          )}
        </Section>
      )}

      {c.education.length > 0 && (
        <Section title="Formação">
          <ul className="space-y-1.5 text-sm">
            {c.education.map((e, i) => (
              <li key={i}>
                <span className="font-semibold text-zinc-800">{[e.nivel, e.curso].filter(Boolean).join(' — ') || 'Formação'}</span>
                <span className="text-xs text-zinc-500"> {[e.instituicao, e.situacao].filter(Boolean).join(' · ')}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {c.courses.length > 0 && (
        <Section title="Outros cursos">
          <ul className="space-y-1 text-sm text-zinc-700">{c.courses.map((s, i) => <li key={i}>• {s}</li>)}</ul>
        </Section>
      )}

      {(c.skills.length > 0 || c.languages.length > 0) && (
        <Section title="Habilidades e idiomas">
          <div className="flex flex-wrap gap-1.5">
            {[...c.skills, ...c.languages].map((s, i) => (
              <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-700">{s}</span>
            ))}
          </div>
        </Section>
      )}

      {(c.availability || c.salary_expectation || c.driver_license || extras.length > 0) && (
        <Section title="Outras informações">
          <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm">
            {c.availability && <><dt className="text-zinc-400">Disponibilidade</dt><dd>{c.availability}</dd></>}
            {c.salary_expectation && <><dt className="text-zinc-400">Pretensão</dt><dd>{c.salary_expectation}</dd></>}
            {c.driver_license && <><dt className="text-zinc-400">CNH</dt><dd>{c.driver_license}</dd></>}
            {extras.flatMap((f) => [
              <dt key={`${f.id}-t`} className="text-zinc-400">{f.label}</dt>,
              <dd key={`${f.id}-v`}>{c.extra_fields?.[f.id]}</dd>,
            ])}
          </dl>
        </Section>
      )}

      {c.raw_text && (
        <Section title="Texto do currículo">
          <button onClick={() => setVerTexto((v) => !v)} className="text-xs font-semibold text-sky-700 cursor-pointer">
            {verTexto ? 'Esconder texto' : 'Mostrar texto completo'}
          </button>
          {verTexto && (
            <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-zinc-50 border border-zinc-100 p-3 text-xs text-zinc-700 font-sans">{c.raw_text}</pre>
          )}
        </Section>
      )}
    </>
  );
}

// Section: mesmo componente de CandidatoDrawer.tsx:702-709 (pré-Fase 2), duplicado para não fechar
// ciclo de import com o shell (T06) nem criar um 5º arquivo fora do Mapa desta fase.
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-2">{title}</p>
      {children}
    </section>
  );
}
