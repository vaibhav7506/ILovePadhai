<p align="center">
  <img
    width="100%"
    src="https://capsule-render.vercel.app/api?type=waving&height=230&color=0:18201E,55:7A263A,100:5C6763&text=ExamForge&fontColor=FFFFFF&fontSize=62&fontAlignY=38&desc=AI-powered%20government%20exam%20practice&descAlignY=58&descSize=18"
    alt="ExamForge"
  />
</p>

<p align="center">
  <strong>Fresh mock tests. Focused improvement. No account required.</strong>
</p>

<p align="center">
  Select an exam, generate a unique test, attempt it question by question,<br />
  and understand exactly where your preparation stands.
</p>

<br />

<p align="center">
  <a href="https://react.dev/">
    <img src="https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React" />
  </a>
  <a href="https://www.typescriptlang.org/">
    <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=FFFFFF" alt="TypeScript" />
  </a>
  <a href="https://workers.cloudflare.com/">
    <img src="https://img.shields.io/badge/Cloudflare-F38020?style=for-the-badge&logo=cloudflare&logoColor=FFFFFF" alt="Cloudflare" />
  </a>
  <a href="https://groq.com/">
    <img src="https://img.shields.io/badge/Groq-F55036?style=for-the-badge&logoColor=FFFFFF" alt="Groq" />
  </a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/No_Login-7A263A?style=flat-square" alt="No login required" />
  <img src="https://img.shields.io/badge/Mobile_First-00897B?style=flat-square" alt="Mobile first" />
  <img src="https://img.shields.io/badge/Installable_PWA-5A0FC8?style=flat-square&logo=pwa&logoColor=FFFFFF" alt="Installable PWA" />
  <img src="https://img.shields.io/badge/Server_Scored-3949AB?style=flat-square" alt="Server scored" />
</p>

<p align="center">
  <a href="https://vaibhav7506portfolio.vercel.app/">
    <img src="https://img.shields.io/badge/Explore_My_Portfolio-18201E?style=for-the-badge&logo=vercel&logoColor=FFFFFF" alt="Vaibhav Sharma's portfolio" />
  </a>
</p>

<br />

<br />

✦ The idea

ExamForge is a mobile-first preparation platform for Indian government examinations.

It replaces repetitive, fixed question sets with configurable AI-generated mock tests while keeping examination timing, scoring, negative marking, question history, and rankings under server control.

Choose an exam → Configure a test → Generate fresh questions → Attempt → Analyse → Improve

<br />

Why it feels different

<table>
  <tr>
    <td width="33%" align="center" valign="top">
      <h3>⚡ Instant practice</h3>
      <p>Start a complete test without waiting for a question-paper library or creating an account.</p>
    </td>
    <td width="33%" align="center" valign="top">
      <h3>♻️ Fresh questions</h3>
      <p>Previously seen and near-duplicate questions are detected and regenerated.</p>
    </td>
    <td width="33%" align="center" valign="top">
      <h3>📈 Useful results</h3>
      <p>See accuracy, speed, weak topics, cutoff context, rank, and attempt-to-attempt improvement.</p>
    </td>
  </tr>
</table>

<br />

<br />

✦ From selection to result

<table>
  <tr>
    <td width="8%" align="center"><strong>01</strong></td>
    <td width="22%"><strong>Choose</strong></td>
    <td>Select the examination, subject, topic, difficulty, language, and test type.</td>
  </tr>
  <tr>
    <td align="center"><strong>02</strong></td>
    <td><strong>Configure</strong></td>
    <td>Choose the number of questions and use a standard, custom, or untimed session.</td>
  </tr>
  <tr>
    <td align="center"><strong>03</strong></td>
    <td><strong>Generate</strong></td>
    <td>Groq prepares the complete set before the examination timer begins.</td>
  </tr>
  <tr>
    <td align="center"><strong>04</strong></td>
    <td><strong>Validate</strong></td>
    <td>Invalid, ambiguous, repeated, or conflicting questions are rejected and regenerated.</td>
  </tr>
  <tr>
    <td align="center"><strong>05</strong></td>
    <td><strong>Attempt</strong></td>
    <td>Answer four-option questions individually in an OMR-inspired interface.</td>
  </tr>
  <tr>
    <td align="center"><strong>06</strong></td>
    <td><strong>Improve</strong></td>
    <td>Review the score, explanations, negative marks, rank, cutoff benchmark, and weak areas.</td>
  </tr>
</table>

<br />

<br />

✦ What learners get

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>🧠 AI test builder</h3>
      <p>
        • Exam-specific generation instructions<br />
        • Subject and topic selection<br />
        • Easy, medium, hard, and mixed difficulty<br />
        • Standard and custom test lengths<br />
        • English and Hindi-ready delivery<br />
        • Separate generation and verification
      </p>
    </td>
    <td width="50%" valign="top">
      <h3>📝 Examination interface</h3>
      <p>
        • One question at a time<br />
        • Four selectable options<br />
        • Previous and Save & next<br />
        • Clear response and Mark for review<br />
        • OMR-style question palette<br />
        • Auto-submit when time expires
      </p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>📊 Performance intelligence</h3>
      <p>
        • Score, accuracy, and negative marks<br />
        • Subject and topic breakdowns<br />
        • Average response time<br />
        • Strong and weak areas<br />
        • Previous-attempt comparison<br />
        • Historical cutoff context
      </p>
    </td>
    <td width="50%" valign="top">
      <h3>🏆 Fair anonymous rankings</h3>
      <p>
        • First-attempt ranking<br />
        • Personal-best ranking<br />
        • Latest, weekly, and all-time views<br />
        • Optional anonymous nickname<br />
        • Comparable tests ranked together<br />
        • Suspicious attempts excluded
      </p>
    </td>
  </tr>
</table>

<br />

<br />

✦ Different questions on every attempt

Prompt wording alone cannot reliably prevent repetition, so ExamForge adds its own question-history layer.

<br />

flowchart LR
A["Generate candidates"] --> B["Validate structure"]
B --> C["Create fingerprints"]
C --> D{"Seen before?"}
D -- "Yes" --> E["Regenerate"]
D -- "No" --> F["Prepare test"]
E --> B

<br />

Every generated question is compared with:

The other questions in the current test

Questions previously shown to the same anonymous learner

Recently generated questions

Existing verified content

Exact matches, reordered-option duplicates, and sufficiently similar questions are rejected. Deliberate repetition is reserved for mistake revision and explicit retries.

<br />

<br />

✦ Practice that behaves like an exam

<table>
  <tr>
    <td width="25%" align="center">
      <h3>⏱️</h3>
      <strong>Server timer</strong>
      <p>The client cannot extend the official attempt window.</p>
    </td>
    <td width="25%" align="center">
      <h3>🔒</h3>
      <strong>Hidden answers</strong>
      <p>Correct options stay on the server until final submission.</p>
    </td>
    <td width="25%" align="center">
      <h3>➖</h3>
      <strong>Negative marking</strong>
      <p>Marks are calculated from the configured exam rules.</p>
    </td>
    <td width="25%" align="center">
      <h3>↻</h3>
      <strong>Recovery</strong>
      <p>An active attempt can recover safely after a refresh.</p>
    </td>
  </tr>
</table>

<br />

<br />

✦ Study plans that require understanding

ExamForge does not mark a topic complete because a learner clicked a checkbox.

<table>
  <tr>
    <td align="center"><strong>Read</strong><br /><sub>Open the lesson</sub></td>
    <td align="center">→</td>
    <td align="center"><strong>Check</strong><br /><sub>Answer a short quiz</sub></td>
    <td align="center">→</td>
    <td align="center"><strong>Pass</strong><br /><sub>Reach the required score</sub></td>
    <td align="center">→</td>
    <td align="center"><strong>Revise</strong><br /><sub>Return through spaced review</sub></td>
  </tr>
</table>

<br />

Skipped topics do not increase completion.

Failed checks return with a different question set.

Weak topics receive focused practice.

Completed topics return through spaced revision.

<br />

<br />

✦ Exam catalogue

<table>
  <tr>
    <th width="50%">🎓 10th–12th level</th>
    <th width="50%">🏛️ Graduation level</th>
  </tr>
  <tr>
    <td align="center">SSC MTS</td>
    <td align="center">SSC CGL</td>
  </tr>
  <tr>
    <td align="center">SSC GD Constable</td>
    <td align="center">SSC CPO</td>
  </tr>
  <tr>
    <td align="center">SSC CHSL</td>
    <td align="center">RRB NTPC Graduate</td>
  </tr>
</table>

<p align="center">
  <sub>The catalogue is data-driven, so more exams can be added without rebuilding the test interface.</sub>
</p>

<br />

<br />

✦ Anonymous by design

<table>
  <tr>
    <td width="60%" valign="top">
      <h3>No registration. No password. No public profile.</h3>
      <p>
        Each browser receives a random anonymous identifier used to retain attempts,
        scores, question history, study progress, and an optional leaderboard nickname.
      </p>
      <p>
        Public footfalls remain visible throughout the website, showing how many
        anonymous learners arrived before the current visitor.
      </p>
    </td>
    <td width="40%" align="center" valign="middle">
      <h2>12,846</h2>
      <strong>example display only</strong>
      <p><sub>Real deployments show the live database total—never a seeded count.</sub></p>
    </td>
  </tr>
</table>

Clearing browser data or changing devices creates a new anonymous learner. Cross-device recovery is unavailable without an account system.

<br />

<br />

✦ Built with

<p align="center">
  <img src="https://skillicons.dev/icons?i=react,typescript,vite,tailwind,cloudflare,nodejs" alt="ExamForge technology stack" />
</p>

<br />

Layer

Technology

Frontend

React, Vite, TypeScript

Interface

Tailwind CSS, React Router

API

Hono on Cloudflare Workers

Database

Cloudflare D1 with Drizzle

Cache & storage

Cloudflare KV and R2

AI generation

Groq through server-side requests

Validation

Zod

Protection

Cloudflare Turnstile

Testing

Vitest and Playwright

Deployment

Wrangler

<br />

<br />

✦ Run it locally

<details open>
  <summary><strong>Requirements and setup</strong></summary>

<br />

Requirements:

Node.js 22.22 or newer

npm

npm install
Copy-Item .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev

Open http://127.0.0.1:5173.

Local D1, KV, and R2 state is stored under .wrangler/state.

</details>

<br />

<details>
  <summary><strong>Run the complete verification suite</strong></summary>

<br />

npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
npm run deploy:dry

Install Chromium once if Playwright requests it:

npm run test:e2e:install

</details>

<details>
  <summary><strong>Deploy to Cloudflare production</strong></summary>

<br />

Production commands always select the `production` Wrangler environment:

```powershell
npx wrangler secret put GROQ_API_KEY --env production
npx wrangler secret put ATTEMPT_SIGNING_SECRET --env production
npx wrangler secret put TURNSTILE_SECRET_KEY --env production
npm run db:migrate:remote
npm run deploy:dry
npm run deploy
```

Set `VITE_TURNSTILE_SITE_KEY` in `.env.production`. Secrets must only be entered through
`wrangler secret put`; never add them to an environment file that is committed.

</details>

<br />

<details>
  <summary><strong>Deploy to Cloudflare</strong></summary>

<br />

Create the resources:

npx wrangler d1 create examforge-db
npx wrangler kv namespace create PUBLIC_CACHE
npx wrangler r2 bucket create examforge-documents

Replace the placeholder resource identifiers in wrangler.jsonc, then apply migrations:

npx wrangler d1 migrations apply examforge-db --remote

Configure server-side secrets:

npx wrangler secret put GROQ_API_KEY
npx wrangler secret put TURNSTILE_SECRET_KEY
npx wrangler secret put ATTEMPT_SIGNING_SECRET

Deploy:

npm run deploy -- --env production

Use separate Cloudflare resources for preview and production.

</details>

<br />

<br />

✦ Security principles

<table>
  <tr>
    <td>✓ No public credentials or user accounts</td>
    <td>✓ Correct answers withheld before submission</td>
  </tr>
  <tr>
    <td>✓ Server-authoritative timing and scoring</td>
    <td>✓ Signed attempt state</td>
  </tr>
  <tr>
    <td>✓ Server-only Groq and Turnstile secrets</td>
    <td>✓ Runtime request validation</td>
  </tr>
  <tr>
    <td>✓ AI generation limits and bot protection</td>
    <td>✓ Analytics consent and anonymous-data deletion</td>
  </tr>
</table>

<br />

✦ Honest limitations

Anonymous progress cannot currently sync across devices.

Clearing site data disconnects previous browser history.

Automated verification reduces AI mistakes but cannot eliminate every ambiguous question.

Similarity checks reduce repetition but cannot prove that every differently worded question tests a completely different concept.

Mock scores and historical cutoffs cannot guarantee selection.

Rankings become meaningful only when enough learners complete comparable tests.

<br />

<br />

<div align="center">

Built by Vaibhav Sharma

Full-stack developer building practical AI products, developer tools, and reliable web experiences.

<br />

<a href="https://vaibhav7506portfolio.vercel.app/">
  <img src="https://img.shields.io/badge/VIEW_MY_PORTFOLIO-7A263A?style=for-the-badge&logo=vercel&logoColor=FFFFFF" alt="View Vaibhav Sharma's portfolio" />
</a>

<br />
<br />

<sub>Focused practice · Measurable improvement · Privacy-first access</sub>

</div>

<p align="center">
  <img
    width="100%"
    src="https://capsule-render.vercel.app/api?type=waving&height=120&section=footer&color=0:5C6763,50:7A263A,100:18201E"
    alt=""
  />
</p>
