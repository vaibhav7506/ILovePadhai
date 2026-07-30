import { BookOpenCheck, ExternalLink, FileCheck2, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';

interface Overview {
  examinations: {
    slug: string;
    shortName: string;
    fullName: string;
    qualificationLevel: 'secondary' | 'graduate';
    status: 'available' | 'under_verification';
    publishedQuestions: number;
  }[];
}

interface Authority {
  name: string;
  domains: string[];
}
interface Paper {
  id: string;
  examination: string;
  examinationSlug: string;
  year: number;
  tierStage: string;
  sourceUrl: string;
}

export function LibraryPage() {
  const [overview, setOverview] = useState<Overview>();
  const [authorities, setAuthorities] = useState<Authority[]>([]);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void Promise.all([
      fetch('/api/content/overview').then((response) => response.json() as Promise<Overview>),
      fetch('/api/content/authorities').then(
        (response) => response.json() as Promise<{ authorities: Authority[] }>,
      ),
      fetch('/api/papers/recent').then(
        (response) => response.json() as Promise<{ papers: Paper[] }>,
      ),
    ])
      .then(([content, authorityData, paperData]) => {
        setOverview(content);
        setAuthorities(authorityData.authorities);
        setPapers(paperData.papers);
      })
      .catch(() => {
        setFailed(true);
      });
  }, []);

  return (
    <div className="library-page">
      <section className="library-hero">
        <p className="eyebrow">PHASE 02 / VERIFIED CONTENT LIBRARY</p>
        <h1>Every published item carries its source.</h1>
        <p>
          Papers, answer keys, patterns, cutoffs and notes remain hidden until their required review
          gate is complete.
        </p>
        <div className="library-trust">
          <span>
            <ShieldCheck size={17} /> Authority-domain allowlist
          </span>
          <span>
            <FileCheck2 size={17} /> Versioned answer keys
          </span>
          <span>
            <BookOpenCheck size={17} /> Citation-gated notes
          </span>
        </div>
      </section>

      {failed ? (
        <section className="library-panel">
          <h2>Library data unavailable</h2>
          <p>No fallback records are displayed when the verified-content service cannot respond.</p>
        </section>
      ) : (
        <>
          <section className="library-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">PUBLICATION READINESS</p>
                <h2>Examinations</h2>
              </div>
              <span>{overview?.examinations.length ?? '—'} configured</span>
            </div>
            <div className="readiness-grid">
              {overview?.examinations.map((exam) => (
                <article key={exam.slug}>
                  <div>
                    <strong>{exam.shortName}</strong>
                    <small>{exam.fullName}</small>
                  </div>
                  {exam.status === 'available' ? (
                    <Link to={`/examinations/${exam.slug}`}>
                      {exam.publishedQuestions} verified questions
                    </Link>
                  ) : (
                    <span>Content under verification</span>
                  )}
                </article>
              ))}
            </div>
          </section>

          <section className="library-split">
            <article className="library-panel">
              <p className="eyebrow">SOURCE REGISTRY</p>
              <h2>Recognised authorities</h2>
              <div className="authority-list">
                {authorities.map((authority) => (
                  <div key={authority.name}>
                    <strong>{authority.name}</strong>
                    <small>{authority.domains.join(' · ')}</small>
                  </div>
                ))}
              </div>
            </article>
            <article className="library-panel">
              <p className="eyebrow">RECENTLY PUBLISHED</p>
              <h2>Verified papers</h2>
              {papers.length === 0 ? (
                <div className="library-empty">
                  <span>0</span>
                  <p>No paper has passed both source and final-answer-key review yet.</p>
                </div>
              ) : (
                papers.map((paper) => (
                  <a href={paper.sourceUrl} key={paper.id} rel="noreferrer" target="_blank">
                    {paper.examination} · {paper.year} · {paper.tierStage}
                    <ExternalLink size={14} />
                  </a>
                ))
              )}
            </article>
          </section>
        </>
      )}
    </div>
  );
}
