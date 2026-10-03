import { useId } from 'react';
import './selo-ceu.css';

const ESTRELAS: [number, number, number][] = [[18, 22, 0], [34, 40, 0.6], [56, 14, 1.1], [104, 30, 0.3], [124, 18, 1.5], [138, 46, 0.9], [86, 10, 1.9]];

/** dia = loja abriu · tarde = caixa abriu/fechou na troca de operador · noite = loja fechou */
export default function SeloCeu({ fase }: { fase: 'dia' | 'tarde' | 'noite' }) {
  const mask = useId().replace(/:/g, '');
  return (
    <div className={`sc-selo sc-${fase}`} aria-hidden="true">
      <div className="sc-ceu">
        {fase === 'noite' && ESTRELAS.map(([x, y, d]) => (
          <i key={`${x}-${y}`} className="sc-estrela" style={{ left: x, top: y, animationDelay: `${d}s` }} />
        ))}
        {fase === 'noite' ? (
          <svg className="sc-lua" viewBox="0 0 40 40">
            <defs>
              <mask id={mask}>
                <rect width="40" height="40" fill="#fff" />
                <circle cx="27" cy="14" r="12" fill="#000" />
              </mask>
            </defs>
            <circle cx="19" cy="21" r="14" fill="#FDE68A" mask={`url(#${mask})`} />
          </svg>
        ) : (
          <div className="sc-sol" />
        )}
        <div className="sc-morro" />
        <div className="sc-morro sc-m2" />
      </div>
    </div>
  );
}
